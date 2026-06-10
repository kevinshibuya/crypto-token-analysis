import { createHash } from 'node:crypto';
import {
  buildDetectorContext, runScan, runSetup,
  DEFAULT_BACKTEST_CONFIG, DEFAULT_DETECTOR_OPTIONS, SIGNAL_KINDS,
} from '@cta/core';
import type { BacktestConfig, DetectorOptions, ScanResult, SignalKind } from '@cta/core';
import type { CandleService } from './candleService';
import type { BacktestStore } from '../cache/backtestStore';
import { httpError } from '../errors';
import { MIN_BACKTEST_CANDLES } from '../config';

export interface BacktestRequest {
  coin: string;
  interval: string;
  lookback: number;
  config: {
    confluenceWindow: number;
    minRR: number;
    volumeSpikeK: number;
    signalKinds?: string[];
  };
}

export type BacktestResponse = ScanResult & { cached: boolean };

export class BacktestService {
  constructor(private candleService: CandleService, private store: BacktestStore) {}

  async run(req: BacktestRequest): Promise<BacktestResponse> {
    const kinds = req.config.signalKinds as SignalKind[] | undefined;
    if (kinds) {
      const bad = kinds.filter((k) => !SIGNAL_KINDS.includes(k));
      if (bad.length) throw httpError(400, `unknown signal kinds: ${bad.join(', ')}`);
    }

    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback);
    if (candles.length === 0) throw httpError(404, `no candles for coin ${req.coin}`);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      throw httpError(422, `backtest needs at least ${MIN_BACKTEST_CANDLES} candles; got ${candles.length} for ${req.coin} ${req.interval}`);
    }

    const cfg: BacktestConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      confluenceWindow: req.config.confluenceWindow,
      minRR: req.config.minRR,
    };
    const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: req.config.volumeSpikeK };
    const lastCandleT = candles[candles.length - 1].t;
    const hashKinds = kinds ? [...kinds].sort() : null;
    const configHash = createHash('sha256')
      .update(JSON.stringify({ cfg, opts, kinds: hashKinds, lookback: req.lookback }))
      .digest('hex');

    const cached = this.store.get(req.coin, req.interval, configHash, lastCandleT) as BacktestResponse | null;
    if (cached) return { ...cached, cached: true };

    const ctx = buildDetectorContext(candles, opts);
    const scan: ScanResult = kinds
      ? { results: [runSetup(candles, ctx, cfg, kinds)], candleCount: candles.length, lastCandleT }
      : runScan(candles, ctx, cfg);
    const payload: BacktestResponse = { ...scan, cached: false };
    this.store.set(req.coin, req.interval, configHash, lastCandleT, payload);
    return payload;
  }
}
