import { describe, it, expect } from 'vitest';
import { buildDetectorContext, alignToCandles, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import type { Candle } from '../src/types';

const k = (t: number, c: number): Candle => ({ t, o: c, h: c + 1, l: c - 1, c, v: 5 });

describe('alignToCandles', () => {
  it('pads missing leading values with NaN and aligns by t', () => {
    const candles = [k(1, 10), k(2, 11), k(3, 12)];
    const out = alignToCandles(candles, [{ t: 2, value: 7 }, { t: 3, value: 8 }]);
    expect(out).toHaveLength(3);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(7);
    expect(out[2]).toBe(8);
  });
});

describe('buildDetectorContext', () => {
  it('produces candle-aligned arrays for every indicator', () => {
    const candles = Array.from({ length: 30 }, (_, i) => k(i + 1, 100 + Math.sin(i) * 5));
    const ctx = buildDetectorContext(candles, {
      ...DEFAULT_DETECTOR_OPTIONS,
      maFast: { type: 'EMA', period: 3 },
      maSlow: { type: 'SMA', period: 5 },
      rsiPeriod: 3,
      atrPeriod: 3,
      volumeSmaPeriod: 3,
    });
    for (const arr of [ctx.rsi, ctx.maFast, ctx.maSlow, ctx.volumeSma, ctx.atr]) {
      expect(arr).toHaveLength(30);
      expect(Number.isNaN(arr[0])).toBe(true);          // warmup gap
      expect(Number.isFinite(arr[29])).toBe(true);      // tail filled
    }
    expect(ctx.opts.rsiPeriod).toBe(3);
  });
});
