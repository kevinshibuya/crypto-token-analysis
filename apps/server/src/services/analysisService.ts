import {
  sma, ema, rsi, volume, volumeProfile,
  buildDetectorContext, detectAll, DEFAULT_DETECTOR_OPTIONS,
} from '@cta/core';
import type { AnalysisResult, MovingAverageResult, Signal } from '@cta/core';
import type { CandleService } from './candleService';
import { DEFAULTS } from '../config';
import { httpError } from '../errors';

export interface AnalysisRequest {
  coin: string;
  interval: string;
  lookback: number;
  force: boolean;
  rsi: { period: number };
  movingAverages: { type: 'SMA' | 'EMA'; period: number }[];
  volumeProfile: { rows: number };
  pivots: { lookback: number; maxLevels: number };
}

export type AnalysisResponse = AnalysisResult & {
  signals: Signal[];
  meta: { lastUpdated: number; candleCount: number };
};

export class AnalysisService {
  constructor(private candleService: CandleService) {}

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback, { force: req.force });
    if (candles.length === 0) throw httpError(404, `no candles for coin ${req.coin}`);

    const movingAverages: MovingAverageResult[] = req.movingAverages.map((ma) => ({
      type: ma.type,
      period: ma.period,
      points: ma.type === 'SMA' ? sma(candles, ma.period) : ema(candles, ma.period),
    }));
    const ctx = buildDetectorContext(candles, {
      ...DEFAULT_DETECTOR_OPTIONS,
      rsiPeriod: req.rsi.period,
      volumeSmaPeriod: DEFAULTS.volumeSmaPeriod,
      pivots: {
        lookback: req.pivots.lookback,
        maxLevels: req.pivots.maxLevels,
        mergeTolerance: DEFAULTS.pivotMergeTolerance,
      },
    });
    return {
      coin: req.coin,
      interval: req.interval,
      candles,
      rsi: rsi(candles, req.rsi.period),
      movingAverages,
      volume: volume(candles, DEFAULTS.volumeSmaPeriod),
      volumeProfile: volumeProfile(candles, req.volumeProfile.rows),
      pivots: ctx.pivots,
      signals: detectAll(candles, ctx),
      meta: {
        lastUpdated: candles[candles.length - 1].t,
        candleCount: candles.length,
      },
    };
  }
}
