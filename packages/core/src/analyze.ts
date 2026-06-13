import type { Candle } from './types';
import { buildDetectorContext, DEFAULT_DETECTOR_OPTIONS } from './detectorContext';
import type { DetectorOptions } from './detectorContext';
import { detectAll } from './detectors';
import { runScan, DEFAULT_BACKTEST_CONFIG } from './backtest/scan';
import type { BacktestConfig, SetupResult } from './backtest/scan';
import { qualifySetups } from './decide/qualify';
import { buildTradePlans } from './decide/plans';
import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from './decide/constants';
import type { ConfidenceWeights, SetupGate, TradePlan } from './decide/types';

/**
 * The engine compute kernel — the single boundary all continuous analysis flows through.
 * Keep this function pure and its signature stable: it is the documented Rust-port seam.
 */
export interface EngineAnalysisConfig {
  detector: DetectorOptions;   // includes the maFast/maSlow override (Phase 4B optimizer injects here)
  backtest: BacktestConfig;
  gate: SetupGate;
  weights: ConfidenceWeights;
  window: number;
}

export interface AnalyzeResult {
  scanResults: SetupResult[];
  plans: TradePlan[];
  candleCount: number;
  lastCandleT: number;
}

export function defaultEngineAnalysisConfig(): EngineAnalysisConfig {
  return {
    detector: { ...DEFAULT_DETECTOR_OPTIONS },
    backtest: { ...DEFAULT_BACKTEST_CONFIG },
    gate: { ...DEFAULT_GATE },
    weights: { ...DEFAULT_WEIGHTS },
    window: DEFAULT_WINDOW,
  };
}

export function analyzeCoin(candles: Candle[], cfg: EngineAnalysisConfig): AnalyzeResult {
  const ctx = buildDetectorContext(candles, cfg.detector);
  const signals = detectAll(candles, ctx);
  const scan = runScan(candles, ctx, cfg.backtest, signals);
  const qualified = qualifySetups(scan.results, cfg.gate);
  const plans = buildTradePlans(candles, ctx, signals, qualified, {
    ...cfg.backtest, window: cfg.window, weights: cfg.weights,
  });
  return {
    scanResults: scan.results,
    plans,
    candleCount: scan.candleCount,
    lastCandleT: scan.lastCandleT,
  };
}
