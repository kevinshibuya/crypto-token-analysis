/**
 * Weight-aware token bucket guarding the Hyperliquid weight budget.
 * Concurrency-safe: concurrent acquire() calls are serialized via a
 * promise-chain mutex so the budget is never over-spent.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (capacity <= 0 || refillPerSec <= 0) {
      throw new Error('RateLimiter: capacity and refillPerSec must be > 0');
    }
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = t;
  }

  acquire(weight: number): Promise<void> {
    const run = this.queue.then(() => this.acquireSequential(weight));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async acquireSequential(weight: number): Promise<void> {
    const w = Math.min(weight, this.capacity);
    for (;;) {
      this.refill();
      if (this.tokens >= w) {
        this.tokens -= w;
        return;
      }
      const needed = w - this.tokens;
      await this.sleep((needed / this.refillPerSec) * 1000);
    }
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}
