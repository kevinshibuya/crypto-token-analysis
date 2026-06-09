/**
 * Weight-aware token bucket guarding the Hyperliquid weight budget.
 * Not concurrency-safe: callers must serialize acquire() (it is designed for a
 * single sequential fetch pipeline). Concurrently awaited acquire() calls can
 * both wake from sleep and over-spend the budget.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

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

  async acquire(weight: number): Promise<void> {
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
