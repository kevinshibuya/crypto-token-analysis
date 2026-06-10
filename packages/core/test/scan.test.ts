import { describe, it, expect } from 'vitest';
import { pairEntries, runScan, runSetup, DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import { buildDetectorContext, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { candle } from './fixtures';
import type { Signal } from '../src/types';

const s = (kind: Signal['kind'], index: number, direction: Signal['direction']): Signal =>
  ({ kind, direction, index, t: index + 1 });

describe('pairEntries', () => {
  it('triggers at the later signal of a same-direction pair within the window', () => {
    const sigs = [s('hammer', 2, 'bullish'), s('rsi-oversold-exit', 4, 'bullish')];
    const out = pairEntries(sigs, 'hammer', 'rsi-oversold-exit', 3);
    expect(out.map((x) => x.index)).toEqual([4]);
  });
  it('ignores opposite directions and out-of-window pairs', () => {
    expect(pairEntries([s('hammer', 2, 'bullish'), s('doji', 3, 'bearish')], 'hammer', 'doji', 3)).toEqual([]);
    expect(pairEntries([s('hammer', 2, 'bullish'), s('doji', 9, 'bullish')], 'hammer', 'doji', 3)).toEqual([]);
  });
  it('dedupes triggers landing on the same candle', () => {
    const sigs = [s('hammer', 2, 'bullish'), s('hammer', 4, 'bullish'), s('doji', 4, 'bullish')];
    expect(pairEntries(sigs, 'hammer', 'doji', 3).map((x) => x.index)).toEqual([4]);
  });
});

// A deterministic synthetic series long enough for warmup with small periods.
function syntheticCandles(n: number) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 11 === 0 ? -3 : 0.3);
    const o = price;
    const c = Math.max(5, price + drift);
    const h = Math.max(o, c) + 1.5;
    const l = Math.min(o, c) - 1.5;
    out.push(candle(i + 1, o, h, l, c, i % 13 === 0 ? 30 : 5));
    price = c;
  }
  return out;
}

const opts = {
  ...DEFAULT_DETECTOR_OPTIONS,
  rsiPeriod: 5, atrPeriod: 5, volumeSmaPeriod: 5,
  maFast: { type: 'EMA' as const, period: 5 }, maSlow: { type: 'SMA' as const, period: 13 },
};

describe('runScan', () => {
  const candles = syntheticCandles(300);
  const ctx = buildDetectorContext(candles, opts);

  it('returns ranked results with full metrics', () => {
    const scan = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(scan.candleCount).toBe(300);
    expect(scan.lastCandleT).toBe(300);
    expect(scan.results.length).toBeGreaterThan(0);
    const m = scan.results[0].metrics;
    for (const key of ['trades', 'wins', 'winRate', 'avgR', 'profitFactor', 'expectancy', 'maxDrawdownR', 'filtered', 'longTrades', 'shortTrades']) {
      expect(m).toHaveProperty(key);
    }
    for (let i = 1; i < scan.results.length; i++) {
      expect(scan.results[i].metrics.expectancy).toBeLessThanOrEqual(scan.results[i - 1].metrics.expectancy);
    }
  });

  it('includes single and pair setups', () => {
    const scan = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(scan.results.some((r) => r.kinds.length === 1)).toBe(true);
    expect(scan.results.some((r) => r.kinds.length === 2)).toBe(true);
  });

  it('is deterministic', () => {
    const a = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    const b = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('runSetup backtests one custom set', () => {
    const r = runSetup(candles, ctx, DEFAULT_BACKTEST_CONFIG, ['volume-spike-up']);
    expect(r.kinds).toEqual(['volume-spike-up']);
    expect(r.metrics.trades + r.metrics.filtered).toBeGreaterThanOrEqual(0);
  });
});
