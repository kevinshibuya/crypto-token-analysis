export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number; // trade count
}

export interface IndicatorPoint {
  t: number;
  value: number;
}

export type MaType = 'SMA' | 'EMA';

export interface MovingAverageResult {
  type: MaType;
  period: number;
  points: IndicatorPoint[];
}

export interface VolumeBar {
  t: number;
  value: number;
  up: boolean; // close >= open
}

export interface VolumeResult {
  bars: VolumeBar[];
  sma: IndicatorPoint[];
}

export interface VolumeProfileRow {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

export interface VolumeProfileResult {
  rows: VolumeProfileRow[];
  poc: number; // price at point of control
  valueArea: { low: number; high: number };
}

export type PivotType = 'support' | 'resistance';

export interface PivotLevel {
  price: number;
  type: PivotType;
  strength: number; // summed volume around the pivot
  touches: number;
}

export interface AnalysisResult {
  coin: string;
  interval: string;
  candles: Candle[];
  rsi: IndicatorPoint[];
  movingAverages: MovingAverageResult[];
  volume: VolumeResult;
  volumeProfile: VolumeProfileResult;
  pivots: PivotLevel[];
}

export type SignalDirection = 'bullish' | 'bearish';

export type CandlePatternKind =
  | 'bullish-engulfing' | 'bearish-engulfing'
  | 'hammer' | 'shooting-star' | 'doji'
  | 'morning-star' | 'evening-star'
  | 'three-white-soldiers' | 'three-black-crows'
  | 'bullish-harami' | 'bearish-harami';

export type IndicatorSignalKind =
  | 'rsi-oversold-exit' | 'rsi-overbought-exit'
  | 'rsi-bullish-divergence' | 'rsi-bearish-divergence'
  | 'ma-golden-cross' | 'ma-death-cross'
  | 'price-cross-ma-up' | 'price-cross-ma-down'
  | 'volume-spike-up' | 'volume-spike-down'
  | 'sr-bounce-support' | 'sr-bounce-resistance'
  | 'sr-break-up' | 'sr-break-down';

export type SignalKind = CandlePatternKind | IndicatorSignalKind;

export interface Signal {
  kind: SignalKind;
  direction: SignalDirection;
  index: number; // candle index where the signal completes
  t: number;     // open time of that candle, ms
  meta?: Record<string, number>;
}
