import type { AnalysisResult, MaType, Interval, Signal, SignalKind, SignalDirection, ScanResult } from '@cta/core';

export type {
  Candle, IndicatorPoint, MovingAverageResult, VolumeBar, VolumeResult, VolumeProfileRow,
  VolumeProfileResult, PivotType, PivotLevel, MaType, Interval,
  Signal, SignalKind, SignalFamily, SignalDirection, SetupResult, SetupMetrics, ScanResult,
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

// ---- live feed (SSE /live) ----

export type AlertKind = 'provisional-new' | 'provisional-confirmed' | 'provisional-withdrawn' | 'confirmed-new' | 'digest';

export interface AlertPayload {
  kind: AlertKind;
  identity: string;
  coin: string;
  interval: string;
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
  ts: number;
  note?: string;
  link: string;
}

export interface LiveAlert {
  ts: number;
  kind: AlertKind;
  coin: string;
  interval: string;
  payload: AlertPayload;
}

export interface ScanPlanSummary {
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
}

export interface LiveScanRow {
  coin: string;
  interval: Interval;
  ts: number;
  candleCount: number;
  plan: ScanPlanSummary | null;
}

export interface LiveHealth {
  wsConnected: boolean;
  lastTickAgeMs: number;
  queueDepth: number;
  busyWorkers: number;
  coinsTracked: number;
  coinsLive: number;
  scansCompleted: number;
  ts: number;
}

export interface LiveSnapshot {
  scans: LiveScanRow[];
  alerts: LiveAlert[];
  health: LiveHealth;
}
