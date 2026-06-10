export * from './types';
export { sma } from './sma';
export { ema } from './ema';
export { rsi } from './rsi';
export { volume } from './volume';
export { volumeProfile } from './volumeProfile';
export { pivots } from './pivots';
export { atr } from './atr';
export type { PivotOptions } from './pivots';
export { SUPPORTED_INTERVALS } from './intervals';
export type { Interval } from './intervals';
export {
  buildDetectorContext, alignToCandles, DEFAULT_DETECTOR_OPTIONS,
} from './detectorContext';
export type { DetectorContext, DetectorOptions, Detector, MaSpec } from './detectorContext';
export { DETECTOR_REGISTRY, SIGNAL_KINDS, signalFamily, detectAll } from './detectors';
export type { SignalFamily } from './detectors';
export { computeBracket, BRACKET_PAD_ATR } from './backtest/bracket';
export type { Bracket, BracketConfig } from './backtest/bracket';
export { simulate } from './backtest/simulate';
export type { SimConfig, TradeRecord, ExitReason, SimResult } from './backtest/simulate';
export { computeMetrics } from './backtest/metrics';
export type { SetupMetrics } from './backtest/metrics';
export { runScan, runSetup, pairEntries, DEFAULT_BACKTEST_CONFIG } from './backtest/scan';
export type { BacktestConfig, SetupResult, ScanResult } from './backtest/scan';
export { qualifySetups } from './decide/qualify';
export { scoreConfidence } from './decide/confidence';
export {
  EDGE_SCALE, SAMPLE_HALF, CONFLUENCE_SAT, RR_SAT,
  DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW,
} from './decide/constants';
export type {
  SetupGate, ConfidenceWeights, ConfidenceBreakdown, TradePlan, DecideConfig, SignalsResult,
} from './decide/types';
