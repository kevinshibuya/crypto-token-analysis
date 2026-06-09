import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/hyperliquid/rateLimiter';

describe('RateLimiter', () => {
  it('acquires immediately while tokens remain', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(1200, 20, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    await rl.acquire(84);
    expect(sleeps).toEqual([]);
    expect(rl.available).toBeCloseTo(1116, 0);
  });

  it('waits for refill when exhausted', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(100, 20, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    await rl.acquire(100); // drain
    await rl.acquire(20);  // need 20 tokens at 20/s -> ~1000ms
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeCloseTo(1000, -1);
  });
});
