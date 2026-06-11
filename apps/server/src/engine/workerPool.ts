import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { AnalyzeResult, Candle, EngineAnalysisConfig } from '@cta/core';
import type { EngineLogger } from './logger';
import type { WorkerJob } from './worker';

export interface PoolJob {
  candles: Candle[];
  config: EngineAnalysisConfig;
  poison?: boolean; // test hook
}

interface Pending {
  job: PoolJob;
  retried: boolean;
  resolve: (r: AnalyzeResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
}

/**
 * Fixed-size worker_threads pool for analyzeCoin jobs.
 * tsx quirk: workers must be spawned with execArgv ['--import','tsx'] so Node can load the TS entry.
 */
export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  private destroyed = false;
  private log: EngineLogger;

  constructor(opts: { size: number; log: EngineLogger }) {
    this.log = opts.log;
    for (let i = 0; i < opts.size; i++) this.slots.push(this.spawn());
  }

  get queueDepth(): number { return this.queue.length; }
  get busyCount(): number { return this.slots.filter((s) => s.busy).length; }

  run(job: PoolJob): Promise<AnalyzeResult> {
    if (this.destroyed) return Promise.reject(new Error('pool destroyed'));
    return new Promise<AnalyzeResult>((resolve, reject) => {
      this.queue.push({ job, retried: false, resolve, reject });
      this.pump();
    });
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const p of this.queue.splice(0)) p.reject(new Error('pool destroyed'));
    for (const slot of this.slots) {
      const pending = slot.busy;
      slot.busy = null;
      pending?.reject(new Error('pool destroyed'));
    }
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }

  private spawn(): Slot {
    const worker = new Worker(fileURLToPath(new URL('./worker.ts', import.meta.url)), {
      execArgv: ['--import', 'tsx'],
    });
    const slot: Slot = { worker, busy: null };
    worker.on('message', (msg: { id: number; result: AnalyzeResult }) => {
      const pending = slot.busy;
      slot.busy = null;
      pending?.resolve(msg.result);
      this.pump();
    });
    worker.on('error', (err) => this.onWorkerGone(slot, err));
    worker.on('exit', (code) => {
      if (code !== 0 && !this.destroyed) this.onWorkerGone(slot, new Error(`worker exited ${code}`));
    });
    return slot;
  }

  private onWorkerGone(slot: Slot, err: Error): void {
    if (this.destroyed) return;
    const pending = slot.busy;
    slot.busy = null;
    this.log.error({ err: err.message }, 'engine worker crashed — respawning');
    const i = this.slots.indexOf(slot);
    void slot.worker.terminate();
    if (i >= 0) this.slots[i] = this.spawn();
    if (pending) {
      if (pending.retried) {
        pending.reject(new Error(`worker job failed twice: ${err.message}`));
      } else {
        pending.retried = true;
        this.queue.unshift(pending); // re-queue once, at the front
      }
    }
    this.pump();
  }

  private pump(): void {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const pending = this.queue.shift()!;
      slot.busy = pending;
      const payload: WorkerJob = {
        id: this.nextId++, candles: pending.job.candles, config: pending.job.config, poison: pending.job.poison,
      };
      slot.worker.postMessage(payload);
    }
  }
}
