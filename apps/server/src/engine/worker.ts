import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
import type { Candle, EngineAnalysisConfig } from '@cta/core';

export interface WorkerJob {
  id: number;
  candles: Candle[];
  config: EngineAnalysisConfig;
  /** test hook: makes the worker throw (unit-testing respawn) */
  poison?: boolean;
}

if (!parentPort) throw new Error('worker.ts must run as a worker thread');

// tsx's `--import tsx` entry refuses to register ESM hooks inside worker threads on
// Node < 24.11.1, so when the parent is NOT running under tsx (e.g. vitest) the
// worker can't resolve @cta/core's extensionless TS imports. Register explicitly via
// the programmatic API, then load the kernel. (This file itself parses via Node's
// native type stripping, or via tsx hooks when the parent runs under `tsx`.)
register();
const { analyzeCoin } = await import('@cta/core');

parentPort.on('message', (job: WorkerJob) => {
  if (job.poison) throw new Error('poisoned job');
  const result = analyzeCoin(job.candles, job.config);
  parentPort!.postMessage({ id: job.id, result });
});
