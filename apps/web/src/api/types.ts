import type { AnalysisResult, MaType, Interval, Signal, SignalKind, ScanResult } from '@cta/core';

export type {
  Candle, IndicatorPoint, MovingAverageResult, VolumeBar, VolumeResult, VolumeProfileRow,
  VolumeProfileResult, PivotType, PivotLevel, MaType, Interval,
  Signal, SignalKind, SignalFamily, SetupResult, SetupMetrics, ScanResult,
  TradePlan, ConfidenceBreakdown, ConfidenceWeights, SetupGate, SignalsResult,
} from '@cta/core';

export interface Market { name: string; szDecimals: number; maxLeverage: number; dayNtlVlm: number; }
export interface MarketsResponse { markets: Market[]; updatedAt: number; }

export interface MaConfig { type: MaType; period: number; color: string; }

export interface AnalysisConfig {
  coin: string;
  interval: Interval;
  lookback: number;
  rsiPeriod: number;
  movingAverages: MaConfig[];
  volumeProfileRows: number;
  pivotLookback: number;
  pivotMaxLevels: number;
}

export type AnalysisResponse = AnalysisResult & {
  signals: Signal[];
  meta: { lastUpdated: number; candleCount: number };
};

export interface BacktestRunConfig {
  lookback?: number;
  confluenceWindow: number;
  minRR: number;
  volumeSpikeK: number;
  signalKinds?: SignalKind[];
}

export type BacktestResponse = ScanResult & { cached: boolean };
