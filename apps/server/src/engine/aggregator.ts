import { EventEmitter } from 'node:events';
import { applyMid, bucketStart } from '@cta/core';
import type { Candle, Interval } from '@cta/core';
import { INTERVAL_MS } from '../hyperliquid/pagination';

export interface AggregatorOptions {
  timeframes: Interval[];     // includes '15m'
  lookback: number;           // closed-series cap per coin×timeframe
  closeGraceMs: number;
  now?: () => number;
}

export interface CloseEvent { coin: string; interval: Interval; candle: Candle }

interface CoinState {
  series: Map<Interval, Candle[]>;
  forming: Map<Interval, Candle | undefined>;
}

/**
 * Stateful candle book per coin: 15m authoritative from WS, higher timeframes aggregated locally.
 * Emits 'close' (CloseEvent) exactly once per completed coin×timeframe candle.
 */
export class CandleAggregator extends EventEmitter {
  private timeframes: Interval[];
  private lookback: number;
  private closeGraceMs: number;
  private now: () => number;
  private coins = new Map<string, CoinState>();
  private base: Interval = '15m';

  constructor(opts: AggregatorOptions) {
    super();
    this.timeframes = opts.timeframes;
    this.lookback = opts.lookback;
    this.closeGraceMs = opts.closeGraceMs;
    this.now = opts.now ?? (() => Date.now());
  }

  private state(coin: string): CoinState {
    let s = this.coins.get(coin);
    if (!s) {
      s = { series: new Map(), forming: new Map() };
      for (const tf of this.timeframes) { s.series.set(tf, []); s.forming.set(tf, undefined); }
      this.coins.set(coin, s);
    }
    return s;
  }

  /** Backfilled history per coin×timeframe; the candle in the currently-open bucket becomes forming. */
  seed(coin: string, interval: Interval, candles: Candle[]): void {
    const s = this.state(coin);
    const step = INTERVAL_MS[interval];
    const openBucket = bucketStart(this.now(), step);
    const closed = candles.filter((c) => c.t < openBucket).slice(-this.lookback);
    const open = candles.find((c) => c.t === openBucket);
    s.series.set(interval, closed);
    s.forming.set(interval, open ? { ...open } : undefined);
  }

  series(coin: string, interval: Interval): Candle[] { return this.state(coin).series.get(interval) ?? []; }
  forming(coin: string, interval: Interval): Candle | undefined { return this.state(coin).forming.get(interval); }
  withForming(coin: string, interval: Interval): Candle[] {
    const f = this.forming(coin, interval);
    const base = this.series(coin, interval);
    return f ? [...base, f] : [...base];
  }
  trackedCoins(): string[] { return [...this.coins.keys()]; }

  /** Authoritative 15m candle from WS. */
  onWsCandle(coin: string, candle: Candle): void {
    const s = this.state(coin);
    const cur = s.forming.get(this.base);
    if (!cur || candle.t === cur.t) {
      s.forming.set(this.base, { ...candle });
      return;
    }
    if (candle.t > cur.t) {
      this.closeBase(coin, cur);
      s.forming.set(this.base, { ...candle });
      return;
    }
    // late correction for an already-closed bucket: fix the series in place, no re-emit
    const series = s.series.get(this.base)!;
    const idx = series.findIndex((x) => x.t === candle.t);
    if (idx >= 0) series[idx] = { ...candle };
  }

  onMid(coin: string, mid: number, t: number): void {
    const s = this.state(coin);
    for (const tf of this.timeframes) {
      const step = INTERVAL_MS[tf];
      const f = s.forming.get(tf);
      if (f) {
        s.forming.set(tf, applyMid(f, mid));
      } else {
        // start a forming candle from the mid (any timeframe): provisional checks need a forming
        // candle on 1h/4h/1d too, and mids are real prices. Accepted approximation: a candle
        // started this way carries a mid-based open until warm reseed corrects it.
        s.forming.set(tf, { t: bucketStart(t, step), o: mid, h: mid, l: mid, c: mid, v: 0, n: 0 });
      }
    }
  }

  /** Timer hook: close any base forming candle past its boundary + grace (sparse coins). */
  closeDue(): void {
    const t = this.now();
    const step = INTERVAL_MS[this.base];
    for (const [coin, s] of this.coins) {
      const f = s.forming.get(this.base);
      if (f && t >= f.t + step + this.closeGraceMs) {
        this.closeBase(coin, f);
        s.forming.set(this.base, undefined);
      }
    }
  }

  private closeBase(coin: string, candle: Candle): void {
    this.appendClosed(coin, this.base, candle);
    this.emit('close', { coin, interval: this.base, candle } satisfies CloseEvent);
    for (const tf of this.timeframes) {
      if (tf === this.base) continue;
      this.rollUp(coin, tf, candle);
    }
  }

  private rollUp(coin: string, tf: Interval, c15: Candle): void {
    const s = this.state(coin);
    const step = INTERVAL_MS[tf];
    const baseStep = INTERVAL_MS[this.base];
    const bucket = bucketStart(c15.t, step);
    let f = s.forming.get(tf);
    if (f && f.t !== bucket) {
      // base candle belongs to a newer bucket → the old forming is complete
      this.appendClosed(coin, tf, f);
      this.emit('close', { coin, interval: tf, candle: f } satisfies CloseEvent);
      f = undefined;
    }
    f = f
      ? { ...f, h: Math.max(f.h, c15.h), l: Math.min(f.l, c15.l), c: c15.c, v: f.v + c15.v, n: (f.n ?? 0) + (c15.n ?? 0) }
      : { t: bucket, o: c15.o, h: c15.h, l: c15.l, c: c15.c, v: c15.v, n: c15.n ?? 0 };
    if (c15.t + baseStep === bucket + step) {
      // this base candle completes the bucket → close immediately
      this.appendClosed(coin, tf, f);
      this.emit('close', { coin, interval: tf, candle: f } satisfies CloseEvent);
      s.forming.set(tf, undefined);
    } else {
      s.forming.set(tf, f);
    }
  }

  private appendClosed(coin: string, tf: Interval, candle: Candle): void {
    const series = this.state(coin).series.get(tf)!;
    series.push({ ...candle });
    if (series.length > this.lookback) series.splice(0, series.length - this.lookback);
  }
}
