import {
  buildDetectorContext, detectAll, qualifySetups, buildTradePlans,
  DEFAULT_BACKTEST_CONFIG, DEFAULT_DETECTOR_OPTIONS,
} from '@cta/core';
import type { ConfidenceWeights, DecideConfig, DetectorOptions, SetupGate, SignalsResult } from '@cta/core';
import type { CandleService } from './candleService';
import type { BacktestService } from './backtestService';
import { httpError } from '../errors';
import { MIN_BACKTEST_CANDLES } from '../config';

export interface SignalsRequest {
  coin: string;
  interval: string;
  lookback: number;
  config: {
    confluenceWindow: number;
    minRR: number;
    volumeSpikeK: number;
    gate: SetupGate;
    weights: ConfidenceWeights;
    window: number;
    force: boolean;
  };
}

export class SignalsService {
  constructor(private candleService: CandleService, private backtestService: BacktestService) {}

  async run(req: SignalsRequest): Promise<SignalsResult> {
    const { coin, interval, lookback, config } = req;
    // force-fetch first so the backtest's own (non-force) candle read sees a fresh head
    const candles = await this.candleService.getCandles(coin, interval, lookback, { force: config.force });
    if (candles.length === 0) throw httpError(404, `no candles for coin ${coin}`);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      throw httpError(422, `signals need at least ${MIN_BACKTEST_CANDLES} candles; got ${candles.length} for ${coin} ${interval}`);
    }

    // only the scan-relevant subset reaches the backtest cache key — gate/weights/window never invalidate it
    const scan = await this.backtestService.run({
      coin, interval, lookback,
      config: { confluenceWindow: config.confluenceWindow, minRR: config.minRR, volumeSpikeK: config.volumeSpikeK },
    });

    const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: config.volumeSpikeK };
    const ctx = buildDetectorContext(candles, opts);
    const signals = detectAll(candles, ctx);
    const qualified = qualifySetups(scan.results, config.gate);
    const cfg: DecideConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      confluenceWindow: config.confluenceWindow,
      minRR: config.minRR,
      window: config.window,
      weights: config.weights,
    };
    const plans = buildTradePlans(candles, ctx, signals, qualified, cfg);
    return {
      coin, interval, plans,
      qualifiedCount: qualified.length,
      candleCount: candles.length,
      lastCandleT: candles[candles.length - 1].t,
    };
  }
}
