import { describe, expect, it } from 'vitest';
import type { Candle } from '@cta/core';
import { BackfillOrchestrator } from '../src/engine/backfill';
import { nullLogger } from '../src/engine/logger';

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * 900_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));

const fakeMarkets = (rows: { name: string; dayNtlVlm: number }[]) => ({
  getMarkets: async () => ({ markets: rows.map((r) => ({ ...r, szDecimals: 2, maxLeverage: 10 })), updatedAt: 0 }),
});

const mk = (opts: {
  markets: { name: string; dayNtlVlm: number }[];
  failFor?: Set<string>;
  universeCap?: number;
}) => {
  const calls: { coin: string; interval: string }[] = [];
  const failFor = opts.failFor ?? new Set<string>();
  const candleService = {
    getCandles: async (coin: string, interval: string) => {
      calls.push({ coin, interval });
      if (failFor.has(coin)) throw new Error(`boom ${coin}`);
      return candles(100);
    },
  };
  const bf = new BackfillOrchestrator({
    candleService: candleService as never,
    marketsService: fakeMarkets(opts.markets) as never,
    log: nullLogger(),
    timeframes: ['15m', '1h'], lookback: 100,
    universeCap: opts.universeCap ?? 0, concurrency: 1,
  });
  const ready: string[] = [];
  bf.on('coin-ready', (e: { coin: string }) => ready.push(e.coin));
  return { bf, calls, ready, failFor };
};

describe('BackfillOrchestrator', () => {
  it('loads the universe sorted by 24h volume desc with rank map, honoring the cap', async () => {
    const { bf } = mk({ markets: [{ name: 'DOGE', dayNtlVlm: 5 }, { name: 'BTC', dayNtlVlm: 100 }, { name: 'ETH', dayNtlVlm: 50 }], universeCap: 2 });
    const u = await bf.loadUniverse();
    expect(u.coins).toEqual(['BTC', 'ETH']); // capped at 2, DOGE excluded
    expect(u.ranks.get('BTC')).toBe(0);
    expect(u.ranks.get('ETH')).toBe(1);
  });

  it('backfills every timeframe per coin in volume order and emits coin-ready per coin', async () => {
    const { bf, calls, ready } = mk({ markets: [{ name: 'ETH', dayNtlVlm: 50 }, { name: 'BTC', dayNtlVlm: 100 }] });
    const u = await bf.loadUniverse();
    await bf.run(u.coins);
    expect(ready).toEqual(['BTC', 'ETH']); // volume order, each ready as soon as its own data landed
    expect(calls).toEqual([
      { coin: 'BTC', interval: '15m' }, { coin: 'BTC', interval: '1h' },
      { coin: 'ETH', interval: '15m' }, { coin: 'ETH', interval: '1h' },
    ]);
  });

  it('coin-ready carries the fetched series per timeframe', async () => {
    const { bf } = mk({ markets: [{ name: 'BTC', dayNtlVlm: 1 }] });
    const events: { coin: string; series: Map<string, Candle[]> }[] = [];
    bf.on('coin-ready', (e) => events.push(e));
    await bf.run(['BTC']);
    expect(events[0].coin).toBe('BTC');
    expect(events[0].series.get('15m')).toHaveLength(100);
    expect(events[0].series.get('1h')).toHaveLength(100);
  });

  it('a failing coin lands in degraded and does not block the rest', async () => {
    const { bf, ready } = mk({ markets: [{ name: 'BTC', dayNtlVlm: 100 }, { name: 'BAD', dayNtlVlm: 90 }, { name: 'ETH', dayNtlVlm: 50 }], failFor: new Set(['BAD']) });
    const u = await bf.loadUniverse();
    await bf.run(u.coins);
    expect(ready).toEqual(['BTC', 'ETH']);
    expect(bf.degradedCoins).toEqual(['BAD']);
  });

  it('retryDegraded re-attempts and promotes recovered coins', async () => {
    const { bf, ready, failFor } = mk({ markets: [{ name: 'BAD', dayNtlVlm: 1 }], failFor: new Set(['BAD']) });
    await bf.run(['BAD']);
    expect(bf.degradedCoins).toEqual(['BAD']);
    failFor.delete('BAD'); // the API recovered
    await bf.retryDegraded();
    expect(ready).toEqual(['BAD']);
    expect(bf.degradedCoins).toEqual([]);
  });
});
