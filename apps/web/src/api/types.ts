import type { AnalysisResult, MaType } from '@cta/core';

export type {
  Candle, IndicatorPoint, MovingAverageResult, VolumeBar, VolumeResult, VolumeProfileRow, VolumeProfileResult, PivotType, PivotLevel, MaType,
} from '@cta/core';

export interface Market { name: string; szDecimals: number; maxLeverage: number; }
export interface MarketsResponse { markets: Market[]; updatedAt: number; }

export interface MaConfig { type: MaType; period: number; color: string; }

export interface AnalysisConfig {
  coin: string;
  interval: string;
  lookback: number;
  rsiPeriod: number;
  movingAverages: MaConfig[];
  volumeProfileRows: number;
  pivotLookback: number;
  pivotMaxLevels: number;
}

export type AnalysisResponse = AnalysisResult & { meta: { lastUpdated: number; candleCount: number } };
