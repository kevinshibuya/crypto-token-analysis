import { describe, it, expect } from 'vitest';
import { buildDetectorContext, alignToCandles, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { pivots } from '../src/pivots';
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

describe('pivotPricesAt (walk-forward)', () => {
  const flat = (t: number): Candle => ({ t, o: 10, h: 10.05, l: 9.95, c: 10, v: 1 });
  const peak = (t: number, h: number): Candle => ({ t, o: 10, h, l: 9.95, c: 10, v: 1 });
  // peak at index 3; with lookback 2 it is confirmed once index 5 exists
  const candles = [flat(1), flat(2), flat(3), peak(4, 100), flat(5), flat(6), flat(7), flat(8)];
  const opts = { ...DEFAULT_DETECTOR_OPTIONS, pivots: { lookback: 2, maxLevels: 3, mergeTolerance: 0.003 } };

  it('excludes pivots not yet confirmed at index i', () => {
    const ctx = buildDetectorContext(candles, opts);
    expect(ctx.pivotPricesAt(4)).toEqual([]);
    expect(ctx.pivotPricesAt(5)).toEqual([100]);
  });

  it('memoizes per index and clamps out-of-range indices', () => {
    const ctx = buildDetectorContext(candles, opts);
    expect(ctx.pivotPricesAt(5)).toBe(ctx.pivotPricesAt(5));
    expect(ctx.pivotPricesAt(999)).toEqual(ctx.pivots.map((p) => p.price));
  });

  it('pivotPricesAt returns [] for empty candles without throwing (clamp invariant)', () => {
    const ctx = buildDetectorContext([], DEFAULT_DETECTOR_OPTIONS);
    expect(() => ctx.pivotPricesAt(0)).not.toThrow();
    expect(ctx.pivotPricesAt(0)).toEqual([]);
    expect(ctx.pivotPricesAt(5)).toEqual([]); // clamps, still []
    expect(ctx.pivotPricesAt(0)).toBe(ctx.pivotPricesAt(0)); // reference stable
  });
});

describe('pivotPricesAt fast-path equivalence', () => {
  const series: Candle[] = Array.from({ length: 80 }, (_, i) => {
    const base = 100 + Math.sin(i / 4) * 8 + Math.cos(i / 9) * 4;
    const h = base + 1 + (i % 5 === 0 ? 3 : 0);
    const l = base - 1 - (i % 7 === 0 ? 3 : 0);
    return { t: i * 60000, o: base, h, l, c: base, v: 1 + (i % 6) };
  });
  const opts = {
    ...DEFAULT_DETECTOR_OPTIONS,
    pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003 },
  };

  it('matches the legacy per-slice computation for every index', () => {
    const ctx = buildDetectorContext(series, opts);
    for (let i = 0; i < series.length; i++) {
      const legacy = pivots(series.slice(0, i + 1), opts.pivots).map((p) => p.price);
      expect(ctx.pivotPricesAt(i)).toEqual(legacy);
    }
  });

  it('falls back to the legacy path (still correct) when volumeWindow > lookback', () => {
    const opts2 = {
      ...DEFAULT_DETECTOR_OPTIONS,
      pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003, volumeWindow: 12 },
    };
    const ctx = buildDetectorContext(series, opts2);
    for (let i = 0; i < series.length; i += 3) {
      const legacy = pivots(series.slice(0, i + 1), opts2.pivots).map((p) => p.price);
      expect(ctx.pivotPricesAt(i)).toEqual(legacy);
    }
  });
});
