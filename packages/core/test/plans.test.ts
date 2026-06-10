import { describe, it, expect } from 'vitest';
import { buildTradePlans } from '../src/decide/plans';
import { DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import { DEFAULT_WEIGHTS } from '../src/decide/constants';
import { DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import type { DetectorContext } from '../src/detectorContext';
import type { Candle, Signal, SignalKind, SignalDirection } from '../src/types';
import type { SetupResult } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';
import type { DecideConfig } from '../src/decide/types';

// 10 flat candles closing at 100; entry price = last close = 100
const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
  t: (i + 1) * 1000, o: 100, h: 101, l: 99, c: 100, v: 1,
}));
const last = candles.length - 1;

const ctx = (pivotPrices: number[], atrVal = 2): DetectorContext => ({
  rsi: [], maFast: [], maSlow: [], volumeSma: [],
  atr: candles.map(() => atrVal),
  pivots: [], pivotPricesAt: () => pivotPrices,
  opts: DEFAULT_DETECTOR_OPTIONS,
});

const sig = (kind: SignalKind, index: number, direction: SignalDirection = 'bullish'): Signal =>
  ({ kind, direction, index, t: candles[index].t });

const metrics = (expectancy = 0.3, trades = 40): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0,
});
const setup = (kinds: SignalKind[], e?: number, n?: number): SetupResult =>
  ({ kinds, metrics: metrics(e, n) }) as SetupResult;

const cfg: DecideConfig = { ...DEFAULT_BACKTEST_CONFIG, window: 3, weights: DEFAULT_WEIGHTS };

describe('buildTradePlans', () => {
  // pivots [97, 110], atr 2: stopDist = 100-(97-0.2)=3.2, targetDist = clamp(10)→cap 6, rr = 1.875 ≥ 1.5
  it('builds an active plan from a signal on the last candle', () => {
    const plans = buildTradePlans(candles, ctx([97, 110]), [sig('hammer', last)], [setup(['hammer'])], cfg);
    expect(plans).toHaveLength(1);
    const p = plans[0];
    expect(p.status).toBe('active');
    expect(p.entry).toBe(100);
    expect(p.stop).toBeCloseTo(96.8, 10);
    expect(p.target).toBeCloseTo(106, 10);
    expect(p.rr).toBeCloseTo(1.875, 10);
    expect(p.ageCandles).toBe(0);
    expect(p.confidence.score).toBeGreaterThan(0);
  });

  // pivots [90, 110]: stopDist = clamp(10.2)→cap 6, targetDist = clamp(10)→6, rr = 1 < 1.5 → expired
  it('marks plans below minRR as expired (still returned and scored)', () => {
    const plans = buildTradePlans(candles, ctx([90, 110]), [sig('hammer', last)], [setup(['hammer'])], cfg);
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('expired');
    expect(plans[0].rr).toBeCloseTo(1, 10);
    expect(plans[0].confidence.score).toBeGreaterThan(0);
  });

  it('includes age window-1 and excludes age window', () => {
    const c = ctx([97, 110]);
    const inWin = buildTradePlans(candles, c, [sig('hammer', last - 2)], [setup(['hammer'])], cfg);
    expect(inWin).toHaveLength(1);
    expect(inWin[0].ageCandles).toBe(2);
    const outWin = buildTradePlans(candles, c, [sig('hammer', last - 3)], [setup(['hammer'])], cfg);
    expect(outWin).toEqual([]);
  });

  it('uses only the most recent occurrence per setup', () => {
    const plans = buildTradePlans(
      candles, ctx([97, 110]),
      [sig('hammer', last - 1), sig('hammer', last)], [setup(['hammer'])], cfg,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].ageCandles).toBe(0);
  });

  it('pairs at the live edge via confluence pairing', () => {
    const plans = buildTradePlans(
      candles, ctx([97, 110]),
      [sig('hammer', last - 1), sig('volume-spike-up', last)],
      [setup(['hammer', 'volume-spike-up'])], cfg,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].setup).toEqual(['hammer', 'volume-spike-up']);
    expect(plans[0].ageCandles).toBe(0);
  });

  it('confluence: two active same-direction plans see each other; bearish sees none', () => {
    const signals = [sig('hammer', last), sig('volume-spike-up', last), sig('doji', last, 'bearish')];
    const plans = buildTradePlans(
      candles, ctx([97, 110]), signals,
      [setup(['hammer']), setup(['volume-spike-up']), setup(['doji'])], cfg,
    );
    const bulls = plans.filter((p) => p.direction === 'bullish');
    const bear = plans.find((p) => p.direction === 'bearish');
    expect(bulls).toHaveLength(2);
    for (const b of bulls) expect(b.confidence.confluence).toBeCloseTo(1 / 3, 10);
    // bearish with pivots [97,110]: stopDist = 110.2-100 = 10.2→cap 6, target 100-97=3 → rr .5 → expired
    expect(bear?.status).toBe('expired');
    expect(bear?.confidence.confluence).toBe(0); // active bulls are opposite direction
  });

  it('is deterministic and sorted by score desc', () => {
    const signals = [sig('hammer', last), sig('volume-spike-up', last)];
    const qualified = [setup(['hammer'], 0.5, 100), setup(['volume-spike-up'], 0.15, 25)];
    const a = buildTradePlans(candles, ctx([97, 110]), signals, qualified, cfg);
    const b = buildTradePlans(candles, ctx([97, 110]), signals, qualified, cfg);
    expect(a).toEqual(b);
    expect(a[0].setup).toEqual(['hammer']);
    expect(a[0].confidence.score).toBeGreaterThanOrEqual(a[1].confidence.score);
  });

  it('returns [] when ATR is unusable or candles are empty', () => {
    expect(buildTradePlans(candles, ctx([97, 110], NaN), [sig('hammer', last)], [setup(['hammer'])], cfg)).toEqual([]);
    expect(buildTradePlans([], ctx([97, 110]), [], [setup(['hammer'])], cfg)).toEqual([]);
  });
});
