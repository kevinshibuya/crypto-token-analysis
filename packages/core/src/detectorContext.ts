import type { Candle, IndicatorPoint, MaType, PivotLevel, Signal } from './types';
import { sma } from './sma';
import { ema } from './ema';
import { rsi } from './rsi';
import { volume } from './volume';
import { atr } from './atr';
import { pivots, collectRawPivots, mergeRankSlice, type PivotOptions } from './pivots';

export interface MaSpec { type: MaType; period: number }

export interface DetectorOptions {
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  divergenceSwing: number;     // bars each side defining a swing point
  divergenceLookback: number;  // max bars between compared swings
  maFast: MaSpec;
  maSlow: MaSpec;
  volumeSmaPeriod: number;
  volumeSpikeK: number;        // spike when v > k * volumeSma
  atrPeriod: number;
  srTolAtrMult: number;        // S/R touch tolerance in ATRs
  pivots: PivotOptions;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  divergenceSwing: 3, divergenceLookback: 60,
  maFast: { type: 'EMA', period: 50 }, maSlow: { type: 'SMA', period: 200 },
  volumeSmaPeriod: 20, volumeSpikeK: 2, atrPeriod: 14, srTolAtrMult: 0.25,
  pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003 },
};

export interface DetectorContext {
  rsi: number[];       // all aligned to candles, NaN where undefined
  maFast: number[];
  maSlow: number[];
  volumeSma: number[];
  atr: number[];
  pivots: PivotLevel[];                    // full-history levels (current state, chart display)
  pivotPricesAt: (i: number) => number[];  // level prices knowable at the close of candle i (walk-forward)
  opts: DetectorOptions;
}

export type Detector = (candles: Candle[], ctx: DetectorContext) => Signal[];

export function alignToCandles(candles: Candle[], points: IndicatorPoint[]): number[] {
  const byT = new Map(points.map((p) => [p.t, p.value]));
  return candles.map((c) => byT.get(c.t) ?? NaN);
}

const maPoints = (candles: Candle[], spec: MaSpec): IndicatorPoint[] =>
  spec.type === 'SMA' ? sma(candles, spec.period) : ema(candles, spec.period);

/** Walk-forward pivot prices at candle i. Fast path (vWin <= lookback): collect raw pivots once,
 *  then merge only the prefix confirmed by i, memoized by confirmed-pivot count. Fallback
 *  (vWin > lookback): legacy per-slice recomputation, memoized per index. */
function makePivotPricesAt(candles: Candle[], pivotOpts: PivotOptions): (i: number) => number[] {
  const lookback = pivotOpts.lookback;
  const vWin = pivotOpts.volumeWindow ?? lookback;
  const clamp = (i: number): number => Math.max(0, Math.min(i, candles.length - 1));

  if (vWin > lookback) {
    const memo = new Map<number, number[]>();
    return (i: number): number[] => {
      const key = clamp(i);
      const hit = memo.get(key);
      if (hit) return hit;
      const prices = pivots(candles.slice(0, key + 1), pivotOpts).map((p) => p.price);
      memo.set(key, prices);
      return prices;
    };
  }

  const raw = collectRawPivots(candles, pivotOpts); // confirmIdx-ascending
  const byCount = new Map<number, number[]>();
  const confirmedCount = (i: number): number => {
    let lo = 0;
    let hi = raw.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (raw[mid].confirmIdx <= i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (i: number): number[] => {
    const key = clamp(i);
    const k = confirmedCount(key);
    const hit = byCount.get(k);
    if (hit) return hit;
    const current = candles.length ? candles[key].c : 0;
    const prices = mergeRankSlice(raw.slice(0, k), pivotOpts, current).map((p) => p.price);
    byCount.set(k, prices);
    return prices;
  };
}

export function buildDetectorContext(
  candles: Candle[],
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): DetectorContext {
  return {
    rsi: alignToCandles(candles, rsi(candles, opts.rsiPeriod)),
    maFast: alignToCandles(candles, maPoints(candles, opts.maFast)),
    maSlow: alignToCandles(candles, maPoints(candles, opts.maSlow)),
    volumeSma: alignToCandles(candles, volume(candles, opts.volumeSmaPeriod).sma),
    atr: alignToCandles(candles, atr(candles, opts.atrPeriod)),
    pivots: pivots(candles, opts.pivots),
    pivotPricesAt: makePivotPricesAt(candles, opts.pivots),
    opts,
  };
}
