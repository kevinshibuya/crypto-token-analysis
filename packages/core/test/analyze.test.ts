import { describe, expect, it } from 'vitest';
import { analyzeCoin, defaultEngineAnalysisConfig } from '../src/analyze';
import { candle } from './fixtures';

/**
 * A deterministic series long enough to warm up real indicators (EMA50, SMA200).
 * Generates a sustained uptrend so MA crosses and RSI exits both fire.
 */
function trendingCandles(n: number) {
  const out = [];
  let price = 50;
  for (let i = 0; i < n; i++) {
    const drift = 0.5 + Math.sin(i / 20) * 0.3; // steady uptrend with gentle oscillation
    const o = price;
    const c = Math.max(1, price + drift);
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.8;
    out.push(candle(i + 1, o, h, l, c, i % 17 === 0 ? 50 : 5));
    price = c;
  }
  return out;
}

/**
 * Up-then-down series: first half trends up, second half trends down.
 * Forces MA golden cross + death cross within the same series so that
 * different fast/slow MA period configs yield visibly different scan results.
 */
function upthendownCandles(n: number) {
  const half = Math.floor(n / 2);
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = i < half ? 0.6 : -0.6;
    const o = price;
    const c = Math.max(1, price + drift);
    const h = Math.max(o, c) + 0.5;
    const l = Math.min(o, c) - 0.5;
    out.push(candle(i + 1, o, h, l, c, i % 19 === 0 ? 40 : 4));
    price = c;
  }
  return out;
}

describe('analyzeCoin', () => {
  it('returns scan results, plans sorted by confidence desc, and head metadata', () => {
    const candles = trendingCandles(400);
    const out = analyzeCoin(candles, defaultEngineAnalysisConfig());
    expect(out.candleCount).toBe(400);
    expect(out.lastCandleT).toBe(candles[399].t);
    expect(Array.isArray(out.scanResults)).toBe(true);
    for (let i = 1; i < out.plans.length; i++) {
      expect(out.plans[i - 1].confidence.score).toBeGreaterThanOrEqual(out.plans[i].confidence.score);
    }
  });

  it('honors the MA override in config (different maFast changes the detector context)', () => {
    // Use up-then-down series: forces MA golden cross + death cross so that
    // EMA50/SMA200 and SMA9/SMA21 produce different MA cross timings.
    const candles = upthendownCandles(500);
    const cfg = defaultEngineAnalysisConfig();
    const out1 = analyzeCoin(candles, cfg);
    const out2 = analyzeCoin(candles, {
      ...cfg,
      detector: { ...cfg.detector, maFast: { type: 'SMA', period: 9 }, maSlow: { type: 'SMA', period: 21 } },
    });
    // not asserting specific plans (fixture-dependent) — assert the configs are actually independent
    expect(out2).not.toEqual(out1); // different MA specs must produce different output
  });

  it('is pure: same input twice gives deeply equal output', () => {
    const candles = trendingCandles(300);
    const cfg = defaultEngineAnalysisConfig();
    expect(analyzeCoin(candles, cfg)).toEqual(analyzeCoin(candles, cfg));
  });
});
