export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
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
