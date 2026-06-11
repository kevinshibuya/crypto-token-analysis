import { describe, expect, it } from 'vitest';
import { CandleAggregator } from '../src/engine/aggregator';
import type { Candle } from '@cta/core';

const M15 = 900_000, H1 = 3_600_000;
const c = (t: number, o = 1, h = 2, l = 0.5, cl = 1.5, v = 1, n = 1): Candle => ({ t, o, h, l, c: cl, v, n });

const mk = (now: () => number, timeframes: ('15m' | '1h' | '4h' | '1d')[] = ['15m', '1h']) => {
  const agg = new CandleAggregator({ timeframes, lookback: 50, closeGraceMs: 2_000, now });
  const closes: { coin: string; interval: string; candle: Candle }[] = [];
  agg.on('close', (e) => closes.push(e));
  return { agg, closes };
};

describe('CandleAggregator', () => {
  it('seed splits closed history from the still-open bucket', () => {
    let t = M15 * 2 + 1; // inside the third 15m bucket
    const { agg } = mk(() => t);
    agg.seed('BTC', '15m', [c(0), c(M15), c(M15 * 2)]); // last one is the open bucket
    expect(agg.series('BTC', '15m')).toEqual([c(0), c(M15)]);
    expect(agg.forming('BTC', '15m')).toEqual(c(M15 * 2));
    expect(agg.withForming('BTC', '15m')).toEqual([c(0), c(M15), c(M15 * 2)]);
  });

  it('ws candle for the forming bucket replaces it authoritatively; newer t closes the old one', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    agg.onWsCandle('BTC', c(0, 1, 3, 1, 2));          // same bucket → replace
    expect(agg.forming('BTC', '15m')).toEqual(c(0, 1, 3, 1, 2));
    now = M15 + 1;
    agg.onWsCandle('BTC', c(M15, 2, 2, 2, 2));         // next bucket → close previous
    expect(closes).toEqual([{ coin: 'BTC', interval: '15m', candle: c(0, 1, 3, 1, 2) }]);
    expect(agg.series('BTC', '15m')).toEqual([c(0, 1, 3, 1, 2)]);
    expect(agg.forming('BTC', '15m')).toEqual(c(M15, 2, 2, 2, 2));
  });

  it('builds the 1h forming from closed 15m candles and closes it on the 4th close', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    for (let i = 0; i < 5; i++) {
      now = i * M15 + 1;
      agg.onWsCandle('BTC', c(i * M15, 10 + i, 20 + i, 5 + i, 15 + i, 2, 1));
    }
    // candles 0..3 closed (arrival of #4 closed #3) → 1h bucket [0,4×15m) complete
    const h1Closes = closes.filter((e) => e.interval === '1h');
    expect(h1Closes).toHaveLength(1);
    expect(h1Closes[0].candle).toEqual({ t: 0, o: 10, h: 23, l: 5, c: 18, v: 8, n: 4 });
    expect(agg.series('BTC', '1h')).toEqual([h1Closes[0].candle]);
  });

  it('applies mids to every forming timeframe', () => {
    let now = 1;
    const { agg } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 10, 11, 9, 10));
    agg.onMid('BTC', 12, 5);
    expect(agg.forming('BTC', '15m')).toEqual({ t: 0, o: 10, h: 12, l: 9, c: 12, v: 1, n: 1 });
    expect(agg.forming('BTC', '1h')!.c).toBe(12);
    expect(agg.forming('BTC', '1h')!.h).toBe(12);
  });

  it('a mid with no forming candle starts one per timeframe at the bucket boundary with zero volume', () => {
    const { agg } = mk(() => M15 + 7);
    agg.onMid('BTC', 100, M15 + 5);
    expect(agg.forming('BTC', '15m')).toEqual({ t: M15, o: 100, h: 100, l: 100, c: 100, v: 0, n: 0 });
    expect(agg.forming('BTC', '1h')).toEqual({ t: 0, o: 100, h: 100, l: 100, c: 100, v: 0, n: 0 });
  });

  it('closeDue closes a sparse-coin forming candle after boundary + grace', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    now = M15 + 1_000;            // inside grace
    agg.closeDue();
    expect(closes).toHaveLength(0);
    now = M15 + 2_500;            // past grace
    agg.closeDue();
    expect(closes).toEqual([{ coin: 'BTC', interval: '15m', candle: c(0, 1, 1, 1, 1) }]);
    expect(agg.forming('BTC', '15m')).toBeUndefined();
  });

  it('caps each closed series at lookback', () => {
    let now = 1;
    const { agg } = mk(() => now);
    for (let i = 0; i < 60; i++) {
      now = i * M15 + 1;
      agg.onWsCandle('BTC', c(i * M15));
    }
    expect(agg.series('BTC', '15m')).toHaveLength(50); // lookback cap
    expect(agg.series('BTC', '15m')[0].t).toBe(9 * M15);
  });

  it('a late candle for an already-closed bucket corrects the series without re-emitting', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    now = M15 + 1;
    agg.onWsCandle('BTC', c(M15));
    closes.length = 0;
    agg.onWsCandle('BTC', c(0, 1, 9, 1, 8)); // late correction for bucket 0
    expect(closes).toEqual([]);
    expect(agg.series('BTC', '15m')[0]).toEqual(c(0, 1, 9, 1, 8));
  });
});
