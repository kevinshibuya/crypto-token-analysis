import type { SignalDirection, SignalKind } from '../types';
import type { SetupMetrics } from '../backtest/metrics';
import type { BacktestConfig } from '../backtest/scan';

export interface SetupGate {
  minTrades: number;
  minExpectancy: number; // in R units
  topN: number;
}

export interface ConfidenceWeights {
  edge: number;
  sample: number;
  confluence: number;
  bracket: number;
}

export interface ConfidenceBreakdown {
  edge: number;       // each component normalized 0..1
  sample: number;
  confluence: number;
  bracket: number;
  score: number;      // 0..100 weighted blend
}

export interface TradePlan {
  setup: SignalKind[];            // 1–2 kinds, sorted (scan convention)
  direction: SignalDirection;
  signalT: number;                // open time of the triggering candle, ms
  ageCandles: number;             // lastIndex − signalIndex
  entry: number;                  // latest close (live proxy for next-open)
  stop: number;
  target: number;
  rr: number;
  status: 'active' | 'expired';   // expired = recomputed R/R below minRR
  metrics: SetupMetrics;          // the setup's backtest aggregates
  confidence: ConfidenceBreakdown;
}

export interface DecideConfig extends BacktestConfig {
  window: number;                 // freshness window in closed candles
  weights: ConfidenceWeights;
}

export interface SignalsResult {
  coin: string;
  interval: string;
  plans: TradePlan[];
  qualifiedCount: number;
  candleCount: number;
  lastCandleT: number;
}
