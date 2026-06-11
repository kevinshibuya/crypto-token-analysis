// apps/server/test/alertEngine.test.ts
import { describe, expect, it } from 'vitest';
import type { TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { AlertStore } from '../src/cache/alertStore';
import { AlertEngine, planIdentity } from '../src/engine/alertEngine';
import { nullLogger } from '../src/engine/logger';
import type { DigestAlert, PlanAlert } from '../src/engine/types';

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status: 'active',
  metrics: {
    trades: 30, wins: 18, winRate: 0.6, avgR: 0.4, profitFactor: 1.8,
    expectancy: 0.4, maxDrawdownR: 2, filtered: 0, longTrades: 30, shortTrades: 0,
  },
  confidence: { edge: 0.8, sample: 0.5, confluence: 0, bracket: 0.6, score: 80 },
  ...over,
});

interface Sent { text: string; alert: PlanAlert | DigestAlert }

const mk = (over: Partial<ConstructorParameters<typeof AlertEngine>[0]> = {}) => {
  const db = openDb(':memory:');
  const store = new AlertStore(db);
  const sent: Sent[] = [];
  let now = 1_000_000;
  const engine = new AlertEngine({
    store, log: nullLogger(),
    dispatch: async (text, alert) => { sent.push({ text, alert }); return ['telegram']; },
    confirmedMinConfidence: 65, provisionalMinConfidence: 75,
    dedupeCooldownMs: 6 * 3_600_000, burstLimit: 10, burstWindowMs: 60_000, digestFlushMs: 5_000,
    webOrigin: 'http://localhost:5173',
    now: () => now,
    ...over,
  });
  return { engine, store, sent, setNow: (t: number) => { now = t; }, db };
};

describe('AlertEngine', () => {
  it('fires provisional-new for an active age-0 plan at/above the provisional bar, exactly once', async () => {
    const { engine, sent, store } = mk();
    await engine.onProvisionalPlans('BTC', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 76 } })]);
    await engine.onProvisionalPlans('BTC', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 76 } })]);
    expect(sent).toHaveLength(1);
    expect((sent[0].alert as PlanAlert).kind).toBe('provisional-new');
    expect(sent[0].text).toContain('BTC');
    expect(sent[0].text).toContain('coin=BTC');           // deep link params
    expect(sent[0].text).toContain('interval=1h');
    expect(store.recent(10)).toHaveLength(1);
    expect(engine.provisionalActiveCoins().has('BTC')).toBe(true);
  });

  it('ignores provisional plans below the provisional bar and stale (age>0) plans', async () => {
    const { engine, sent } = mk();
    await engine.onProvisionalPlans('BTC', '1h', [
      plan({ confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score: 74 } }),
      plan({ ageCandles: 1, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
      plan({ status: 'expired', confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
    ]);
    expect(sent).toHaveLength(0);
  });

  it('settles a pending provisional as confirmed when the close scan agrees — and does NOT also fire confirmed-new', async () => {
    const { engine, sent } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 80 } });
    await engine.onProvisionalPlans('BTC', '1h', [p]);
    await engine.onCloseScan('BTC', '1h', [p]); // same identity, active, 80 ≥ 65
    const kinds = sent.map((s) => (s.alert as PlanAlert).kind);
    expect(kinds).toEqual(['provisional-new', 'provisional-confirmed']);
    expect(engine.provisionalActiveCoins().has('BTC')).toBe(false);
  });

  it('settles as withdrawn when the close scan lost the setup, noting an under-bar survivor', async () => {
    const { engine, sent } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 80 } });
    await engine.onProvisionalPlans('BTC', '1h', [p]);
    await engine.onCloseScan('BTC', '1h', [
      { ...p, confidence: { ...p.confidence, score: 60 } }, // same identity, under the confirmed bar
    ]);
    const last = sent[sent.length - 1].alert as PlanAlert;
    expect(last.kind).toBe('provisional-withdrawn');
    expect(last.note).toMatch(/below/i);
  });

  it('fires confirmed-new for a fresh close-scan plan that was never provisional', async () => {
    const { engine, sent } = mk();
    await engine.onCloseScan('ETH', '4h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 66 } })]);
    expect(sent).toHaveLength(1);
    expect((sent[0].alert as PlanAlert).kind).toBe('confirmed-new');
  });

  it('skips confirmed-new below the bar or with age > 0', async () => {
    const { engine, sent } = mk();
    await engine.onCloseScan('ETH', '4h', [
      plan({ confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score: 64 } }),
      plan({ ageCandles: 2, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
    ]);
    expect(sent).toHaveLength(0);
  });

  it('dedupes (identity, kind) within the cooldown and refires after it', async () => {
    const { engine, sent, setNow } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } });
    await engine.onCloseScan('BTC', '1h', [p]);
    setNow(1_000_000 + 3_600_000);
    await engine.onCloseScan('BTC', '1h', [p]); // 1h later: inside 6h cooldown
    expect(sent).toHaveLength(1);
    setNow(1_000_000 + 7 * 3_600_000);
    await engine.onCloseScan('BTC', '1h', [{ ...p, ageCandles: 0 }]); // past cooldown
    expect(sent).toHaveLength(2);
  });

  it('dedupe survives restart via the store', async () => {
    const { engine, sent, db } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } });
    await engine.onCloseScan('BTC', '1h', [p]);
    expect(sent).toHaveLength(1);
    // "restart": fresh AlertEngine over the same db
    const sent2: Sent[] = [];
    const engine2 = new AlertEngine({
      store: new AlertStore(db), log: nullLogger(),
      dispatch: async (text, alert) => { sent2.push({ text, alert }); return ['telegram']; },
      confirmedMinConfidence: 65, provisionalMinConfidence: 75,
      dedupeCooldownMs: 6 * 3_600_000, burstLimit: 10, burstWindowMs: 60_000, digestFlushMs: 5_000,
      webOrigin: 'http://localhost:5173', now: () => 1_000_000 + 60_000,
    });
    await engine2.onCloseScan('BTC', '1h', [p]);
    expect(sent2).toHaveLength(0);
  });

  it('collapses overflow beyond burstLimit/window into one digest, persisting every alert', async () => {
    const { engine, sent, store } = mk({ burstLimit: 3, digestFlushMs: 10 });
    for (let i = 0; i < 5; i++) {
      await engine.onCloseScan(`COIN${i}`, '1h', [plan({ entry: 100 + i, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 + i } })]);
    }
    await new Promise((r) => setTimeout(r, 50)); // let the digest flush
    const digests = sent.filter((s) => (s.alert as DigestAlert).kind === 'digest');
    expect(sent.length - digests.length).toBe(3);          // individual dispatches stopped at the limit
    expect(digests).toHaveLength(1);
    expect((digests[0].alert as DigestAlert).count).toBe(2);
    expect(store.recent(20).filter((r) => r.kind !== 'digest')).toHaveLength(5); // all persisted individually
    expect(store.recent(20).some((r) => r.kind === 'digest')).toBe(true);
  });

  it('calls onRecord for every persisted row, including digest-buffered ones', async () => {
    const records: { kind: string; identity: string }[] = [];
    const { engine } = mk({
      burstLimit: 1, digestFlushMs: 10,
      onRecord: (row) => records.push({ kind: row.kind, identity: row.identity }),
    });
    // two confirmed-new alerts with distinct identities; the second overflows burstLimit 1 → digest buffer
    await engine.onCloseScan('AAA', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } })]);
    await engine.onCloseScan('BBB', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 71 } })]);
    // both rows persisted immediately (one delivered, one digest-routed) — onRecord fired for both
    expect(records.filter((r) => r.kind === 'confirmed-new')).toHaveLength(2);
    expect(records.some((r) => r.kind === 'digest')).toBe(false);
    await new Promise((r) => setTimeout(r, 50)); // let the digest flush
    expect(records.filter((r) => r.kind === 'digest')).toHaveLength(1);
  });

  it('stop() flushes a pending digest buffer instead of dropping it', async () => {
    const { engine, sent, store } = mk({ burstLimit: 1, digestFlushMs: 60_000 }); // timer won't fire on its own
    await engine.onCloseScan('AAA', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } })]);
    await engine.onCloseScan('BBB', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 71 } })]); // → buffer
    expect(sent.filter((s) => (s.alert as DigestAlert).kind === 'digest')).toHaveLength(0);
    await engine.stop();
    const digests = sent.filter((s) => (s.alert as DigestAlert).kind === 'digest');
    expect(digests).toHaveLength(1); // dispatched exactly once
    expect((digests[0].alert as DigestAlert).count).toBe(1);
    expect(store.recent(20).filter((r) => r.kind === 'digest')).toHaveLength(1); // persisted exactly once
    await engine.stop(); // idempotent — no second flush, no throw
    expect(sent.filter((s) => (s.alert as DigestAlert).kind === 'digest')).toHaveLength(1);
  });
});

describe('planIdentity', () => {
  it('buckets entry at 0.1% and is stable across tiny moves', () => {
    const a = planIdentity('BTC', '1h', plan({ entry: 99.95 }));
    const b = planIdentity('BTC', '1h', plan({ entry: 99.99 })); // +0.04% → same bucket
    const c = planIdentity('BTC', '1h', plan({ entry: 101.5 })); // +1.5% → different bucket
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('BTC|1h|bullish|rsi-oversold-exit|');
  });
});
