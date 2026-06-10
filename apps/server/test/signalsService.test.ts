import { describe, it, expect } from 'vitest';
import type { Candle } from '@cta/core';
import { SignalsService, type SignalsRequest } from '../src/services/signalsService';
import { BacktestService } from '../src/services/backtestService';
import type { CandleService } from '../src/services/candleService';
import type { BacktestStore } from '../src/cache/backtestStore';

// deterministic wavy fixture: enough candles for ATR/RSI, produces some signals
const fixture = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const base = 100 + 10 * Math.sin(i / 5) + (i % 7 === 0 ? 5 : 0);
    return { t: (i + 1) * 60_000, o: base, h: base + 2, l: base - 2, c: base + (i % 2 ? 1 : -1), v: i % 11 === 0 ? 50 : 10 };
  });

const fakeCandles = (candles: Candle[]) => {
  const calls: { force: boolean }[] = [];
  const svc = {
    getCandles: async (_c: string, _i: string, _l: number, opts: { force?: boolean } = {}) => {
      calls.push({ force: opts.force ?? false });
      return candles;
    },
  } as unknown as CandleService;
  return { svc, calls };
};

const memStore = () => {
  const m = new Map<string, unknown>();
  let sets = 0;
  const store = {
    get: (c: string, i: string, h: string, t: number) => m.get(`${c}|${i}|${h}|${t}`) ?? null,
    set: (c: string, i: string, h: string, t: number, p: unknown) => { sets++; m.set(`${c}|${i}|${h}|${t}`, p); },
  } as unknown as BacktestStore;
  return { store, setCount: () => sets };
};

const req = (over: Partial<SignalsRequest['config']> = {}): SignalsRequest => ({
  coin: 'BTC', interval: '1h', lookback: 300,
  config: {
    confluenceWindow: 3, minRR: 1.5, volumeSpikeK: 2,
    gate: { minTrades: 0, minExpectancy: -100, topN: 5 },
    weights: { edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 },
    window: 3, force: false, ...over,
  },
});

describe('SignalsService', () => {
  it('returns plans + qualifiedCount and basic envelope fields', async () => {
    const { svc: candleSvc } = fakeCandles(fixture(300));
    const { store } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    const r = await signals.run(req());
    expect(r.coin).toBe('BTC');
    expect(r.candleCount).toBe(300);
    expect(r.lastCandleT).toBe(300 * 60_000);
    expect(r.qualifiedCount).toBeLessThanOrEqual(5);
    expect(Array.isArray(r.plans)).toBe(true);
    for (const p of r.plans) expect(['active', 'expired']).toContain(p.status);
  });

  it('reuses the cached scan when only gate/weights/window change', async () => {
    const { svc: candleSvc } = fakeCandles(fixture(300));
    const { store, setCount } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    await signals.run(req());
    await signals.run(req({ weights: { edge: 1, sample: 0, confluence: 0, bracket: 0 }, window: 10, gate: { minTrades: 1, minExpectancy: 0, topN: 2 } }));
    expect(setCount()).toBe(1); // second run hit the scan cache
  });

  it('passes force to the candle fetch', async () => {
    const { svc: candleSvc, calls } = fakeCandles(fixture(300));
    const { store } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    await signals.run(req({ force: true }));
    expect(calls[0].force).toBe(true);
  });

  it('404s on unknown coin and 422s under 50 candles', async () => {
    const { store } = memStore();
    const empty = new SignalsService(fakeCandles([]).svc, new BacktestService(fakeCandles([]).svc, store));
    await expect(empty.run(req())).rejects.toMatchObject({ statusCode: 404 });
    const thinFake = fakeCandles(fixture(30)).svc;
    const thin = new SignalsService(thinFake, new BacktestService(thinFake, store));
    await expect(thin.run(req())).rejects.toMatchObject({ statusCode: 422 });
  });
});
