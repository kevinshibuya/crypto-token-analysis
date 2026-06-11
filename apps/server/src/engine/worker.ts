import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
import type {
  BacktestConfig, Candle, DetectorOptions, EngineAnalysisConfig, MaGridGates,
} from '@cta/core';

export interface AnalyzeWorkerJob {
  id: number;
  kind?: 'analyze'; // absent = analyze (backward compatible)
  candles: Candle[];
  config: EngineAnalysisConfig;
  /** test hook: makes the worker throw (unit-testing respawn) */
  poison?: boolean;
}

export interface OptimizeMaWorkerJob {
  id: number;
  kind: 'optimize-ma';
  candles: Candle[];
  detector: DetectorOptions;
  backtest: BacktestConfig;
  gates: MaGridGates;
}

export type WorkerJob = AnalyzeWorkerJob | OptimizeMaWorkerJob;

if (!parentPort) throw new Error('worker.ts must run as a worker thread');

// tsx's `--import tsx` entry refuses to register ESM hooks inside worker threads on
// Node < 24.11.1, so when the parent is NOT running under tsx (e.g. vitest) the
// worker can't resolve @cta/core's extensionless TS imports. Register explicitly via
// the programmatic API, then load the kernel. (This file itself parses via Node's
// native type stripping, or via tsx hooks when the parent runs under `tsx`.)
register();
const { analyzeCoin, optimizeMaForSeries } = await import('@cta/core');

parentPort.on('message', (job: WorkerJob) => {
  if (job.kind === 'optimize-ma') {
    const result = optimizeMaForSeries(job.candles, {
      detector: job.detector, backtest: job.backtest, gates: job.gates,
    });
    parentPort!.postMessage({ id: job.id, result });
    return;
  }
  if (job.poison) throw new Error('poisoned job');
  const result = analyzeCoin(job.candles, job.config);
  parentPort!.postMessage({ id: job.id, result });
});
