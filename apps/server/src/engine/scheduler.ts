// apps/server/src/engine/scheduler.ts
import type { Interval } from '@cta/core';

export interface ScanJob { coin: string; interval: Interval }

/** Coalescing priority queue: provisional-active coins first, then 24h-volume rank, then FIFO. */
export class ScanQueue {
  private jobs = new Map<string, ScanJob>(); // key coin|interval — Map preserves insertion order (FIFO tiebreak)
  private ranks = new Map<string, number>();
  private provisionalActive = new Set<string>();

  get size(): number { return this.jobs.size; }

  setVolumeRanks(ranks: Map<string, number>): void { this.ranks = ranks; }
  markProvisionalActive(coin: string, active: boolean): void {
    if (active) this.provisionalActive.add(coin); else this.provisionalActive.delete(coin);
  }

  push(job: ScanJob): void {
    this.jobs.set(`${job.coin}|${job.interval}`, job);
  }

  pop(): ScanJob | undefined {
    let bestKey: string | undefined;
    let best: ScanJob | undefined;
    let bestScore = Infinity;
    for (const [key, job] of this.jobs) {
      const rank = this.ranks.get(job.coin) ?? Number.MAX_SAFE_INTEGER - 1;
      const score = this.provisionalActive.has(job.coin) ? rank - 1e9 : rank;
      if (score < bestScore) { bestScore = score; bestKey = key; best = job; }
    }
    if (bestKey) this.jobs.delete(bestKey);
    return best;
  }
}

export interface TickGateOptions { minMovePct: number; minIntervalMs: number; now?: () => number }

/** Per-coin throttle for provisional evaluations: both a min move and a min interval must pass. */
export class TickGate {
  private minMovePct: number;
  private minIntervalMs: number;
  private now: () => number;
  private last = new Map<string, { price: number; t: number }>();

  constructor(opts: TickGateOptions) {
    this.minMovePct = opts.minMovePct;
    this.minIntervalMs = opts.minIntervalMs;
    this.now = opts.now ?? (() => Date.now());
  }

  shouldEvaluate(coin: string, mid: number): boolean {
    const t = this.now();
    const prev = this.last.get(coin);
    if (!prev) { this.last.set(coin, { price: mid, t }); return true; }
    if (t - prev.t < this.minIntervalMs) return false;
    const movePct = Math.abs(mid - prev.price) / prev.price * 100;
    if (movePct < this.minMovePct) return false;
    this.last.set(coin, { price: mid, t });
    return true;
  }
}
