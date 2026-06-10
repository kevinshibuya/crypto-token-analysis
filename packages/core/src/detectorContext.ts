import type { Candle, IndicatorPoint, MaType, PivotLevel, Signal } from './types';
import { sma } from './sma';
import { ema } from './ema';
import { rsi } from './rsi';
import { volume } from './volume';
import { atr } from './atr';
import { pivots, type PivotOptions } from './pivots';

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
  pivots: PivotLevel[];
  opts: DetectorOptions;
}

export type Detector = (candles: Candle[], ctx: DetectorContext) => Signal[];

export function alignToCandles(candles: Candle[], points: IndicatorPoint[]): number[] {
  const byT = new Map(points.map((p) => [p.t, p.value]));
  return candles.map((c) => byT.get(c.t) ?? NaN);
}

const maPoints = (candles: Candle[], spec: MaSpec): IndicatorPoint[] =>
  spec.type === 'SMA' ? sma(candles, spec.period) : ema(candles, spec.period);

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
    opts,
  };
}
