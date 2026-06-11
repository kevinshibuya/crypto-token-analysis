// apps/server/src/engine/alertEngine.ts
import type { Interval, TradePlan } from '@cta/core';
import type { AlertKind, AlertStore } from '../cache/alertStore';
import type { EngineLogger } from './logger';
import type { DigestAlert, PlanAlert } from './types';

export function planIdentity(coin: string, interval: string, plan: TradePlan): string {
  const bucket = Math.round(Math.log(plan.entry) / Math.log(1.001));
  return `${coin}|${interval}|${plan.direction}|${plan.setup.join('+')}|${bucket}`;
}

export function formatAlertText(a: PlanAlert): string {
  const mark = { 'provisional-new': '⚠', 'provisional-confirmed': '✓', 'provisional-withdrawn': '✗', 'confirmed-new': '🔔', digest: '' }[a.kind];
  const head = `${mark} ${a.kind.toUpperCase()} ${a.coin} ${a.interval} ${a.direction.toUpperCase()}`;
  const body = `${a.setup.join('+')} | entry ${a.entry} stop ${a.stop} target ${a.target} | R/R ${a.rr.toFixed(2)} | conf ${Math.round(a.confidence)}`;
  return [head, body, a.note, a.link].filter(Boolean).join('\n');
}

export function formatDigestText(d: DigestAlert): string {
  const top = d.top.map((a) => `• ${a.coin} ${a.interval} ${a.direction} conf ${Math.round(a.confidence)}`).join('\n');
  return `📦 ${d.count} more alert(s) across ${d.coins.length} coin(s) in the last minute — top by confidence:\n${top}`;
}

export interface AlertEngineOptions {
  store: AlertStore;
  log: EngineLogger;
  /** delivers to all sinks; resolves with the sink names that accepted (never rejects) */
  dispatch: (text: string, alert: PlanAlert | DigestAlert) => Promise<string[]>;
  confirmedMinConfidence: number;
  provisionalMinConfidence: number;
  dedupeCooldownMs: number;
  burstLimit: number;
  burstWindowMs: number;
  digestFlushMs: number;
  webOrigin: string;
  now?: () => number;
}

export class AlertEngine {
  private o: Required<Omit<AlertEngineOptions, 'now'>>;
  private now: () => number;
  private fired: Map<string, number>;                       // `${identity}|${kind}` → ts (memory mirror of alert_dedupe)
  private pending = new Map<string, Map<string, PlanAlert>>(); // `${coin}|${interval}` → identity → provisional alert
  private dispatchTimes: number[] = [];
  private digestBuffer: PlanAlert[] = [];
  private digestTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AlertEngineOptions) {
    this.o = opts;
    this.now = opts.now ?? (() => Date.now());
    this.fired = opts.store.allFired();
  }

  provisionalActiveCoins(): Set<string> {
    const out = new Set<string>();
    for (const [key, m] of this.pending) if (m.size) out.add(key.split('|')[0]);
    return out;
  }

  /** Candidate plans from a forming-candle evaluation. */
  async onProvisionalPlans(coin: string, interval: Interval, plans: TradePlan[]): Promise<void> {
    const key = `${coin}|${interval}`;
    for (const p of plans) {
      if (p.status !== 'active' || p.ageCandles !== 0) continue;
      if (p.confidence.score < this.o.provisionalMinConfidence) continue;
      const identity = planIdentity(coin, interval, p);
      const bucket = this.pending.get(key) ?? new Map<string, PlanAlert>();
      this.pending.set(key, bucket);
      if (bucket.has(identity)) continue;
      if (this.inCooldown(identity, 'provisional-new')) continue;
      const alert = this.toAlert('provisional-new', identity, coin, interval, p);
      bucket.set(identity, alert);
      await this.fire(alert);
    }
  }

  /** Authoritative close-scan plans: settle pending provisionals, then fresh confirmed-new. */
  async onCloseScan(coin: string, interval: Interval, plans: TradePlan[]): Promise<void> {
    const key = `${coin}|${interval}`;
    const byIdentity = new Map(plans.map((p) => [planIdentity(coin, interval, p), p]));
    const settledConfirmed = new Set<string>();

    const bucket = this.pending.get(key);
    if (bucket) {
      for (const [identity, prov] of bucket) {
        const match = byIdentity.get(identity);
        if (match && match.status === 'active' && match.confidence.score >= this.o.confirmedMinConfidence) {
          settledConfirmed.add(identity);
          await this.fire(this.toAlert('provisional-confirmed', identity, coin, interval, match));
        } else {
          const note = match
            ? `setup survived the close but scored below the confirmed bar (${Math.round(match.confidence.score)} < ${this.o.confirmedMinConfidence})`
            : 'setup did not exist on the closed candle';
          await this.fire({ ...prov, kind: 'provisional-withdrawn', note, ts: this.now() });
        }
      }
      bucket.clear();
    }

    for (const p of plans) {
      if (p.status !== 'active' || p.ageCandles !== 0) continue;
      if (p.confidence.score < this.o.confirmedMinConfidence) continue;
      const identity = planIdentity(coin, interval, p);
      if (settledConfirmed.has(identity)) continue;
      if (this.inCooldown(identity, 'confirmed-new')) continue;
      await this.fire(this.toAlert('confirmed-new', identity, coin, interval, p));
    }
  }

  private toAlert(kind: AlertKind, identity: string, coin: string, interval: Interval, p: TradePlan): PlanAlert {
    return {
      kind, identity, coin, interval,
      direction: p.direction, setup: p.setup,
      entry: p.entry, stop: p.stop, target: p.target, rr: p.rr,
      confidence: p.confidence.score, ts: this.now(),
      link: `${this.o.webOrigin}/?coin=${encodeURIComponent(coin)}&interval=${interval}`,
    };
  }

  private inCooldown(identity: string, kind: AlertKind): boolean {
    const last = this.fired.get(`${identity}|${kind}`);
    return last !== undefined && this.now() - last < this.o.dedupeCooldownMs;
  }

  private markFired(identity: string, kind: AlertKind): void {
    const t = this.now();
    this.fired.set(`${identity}|${kind}`, t);
    this.o.store.markFired(identity, kind, t);
  }

  private async fire(alert: PlanAlert): Promise<void> {
    this.markFired(alert.identity, alert.kind);
    const t = this.now();
    this.dispatchTimes = this.dispatchTimes.filter((x) => t - x < this.o.burstWindowMs);
    if (this.dispatchTimes.length >= this.o.burstLimit) {
      this.digestBuffer.push(alert);
      this.o.store.insert({ ts: t, kind: alert.kind, identity: alert.identity, coin: alert.coin, interval: alert.interval, payload: alert, delivered: ['digest'] });
      if (!this.digestTimer) {
        this.digestTimer = setTimeout(() => { void this.flushDigest(); }, this.o.digestFlushMs);
        this.digestTimer.unref?.();
      }
      return;
    }
    this.dispatchTimes.push(t);
    const delivered = await this.o.dispatch(formatAlertText(alert), alert);
    this.o.store.insert({ ts: t, kind: alert.kind, identity: alert.identity, coin: alert.coin, interval: alert.interval, payload: alert, delivered });
  }

  private async flushDigest(): Promise<void> {
    this.digestTimer = null;
    const buf = this.digestBuffer.splice(0);
    if (!buf.length) return;
    const digest: DigestAlert = {
      kind: 'digest', ts: this.now(), count: buf.length,
      coins: [...new Set(buf.map((a) => a.coin))],
      top: [...buf].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
    const delivered = await this.o.dispatch(formatDigestText(digest), digest);
    this.o.store.insert({ ts: digest.ts, kind: 'digest', identity: 'digest', coin: '*', interval: '*', payload: digest, delivered });
  }
}
