import { sma, ema, rsi, volume, volumeProfile, pivots } from '@cta/core';
import type { AnalysisResult, MovingAverageResult } from '@cta/core';
import type { CandleService } from './candleService';
import { DEFAULTS } from '../config';

export interface AnalysisRequest {
  coin: string;
  interval: string;
  lookback: number;
  rsi: { period: number };
  movingAverages: { type: 'SMA' | 'EMA'; period: number }[];
  volumeProfile: { rows: number };
  pivots: { lookback: number; maxLevels: number };
}

export type AnalysisResponse = AnalysisResult & {
  meta: { lastUpdated: number; candleCount: number };
};

export class AnalysisService {
  constructor(private candleService: CandleService) {}

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback);
    const movingAverages: MovingAverageResult[] = req.movingAverages.map((ma) => ({
      type: ma.type,
      period: ma.period,
      points: ma.type === 'SMA' ? sma(candles, ma.period) : ema(candles, ma.period),
    }));
    return {
      coin: req.coin,
      interval: req.interval,
      candles,
      rsi: rsi(candles, req.rsi.period),
      movingAverages,
      volume: volume(candles, DEFAULTS.volumeSmaPeriod),
      volumeProfile: volumeProfile(candles, req.volumeProfile.rows),
      pivots: pivots(candles, {
        lookback: req.pivots.lookback,
        maxLevels: req.pivots.maxLevels,
        mergeTolerance: DEFAULTS.pivotMergeTolerance,
      }),
      meta: {
        lastUpdated: candles.length ? candles[candles.length - 1].t : 0,
        candleCount: candles.length,
      },
    };
  }
}
