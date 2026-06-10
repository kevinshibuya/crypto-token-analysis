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

  it('throws on non-positive capacity or refill rate', () => {
    expect(() => new RateLimiter(0, 20)).toThrow();
    expect(() => new RateLimiter(100, 0)).toThrow();
  });

  it('serializes concurrent acquires without overspending', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(10, 1, () => t, async (ms) => { sleeps.push(ms); t += ms; });
    const order: string[] = [];
    await Promise.all([
      rl.acquire(8).then(() => order.push('a')),
      rl.acquire(8).then(() => order.push('b')),
    ]);
    expect(order).toEqual(['a', 'b']);
    expect(sleeps.length).toBeGreaterThan(0);          // second waited for refill
    expect(rl.available).toBeGreaterThanOrEqual(0);    // never overspent
  });

  it('queues a later light acquire behind an earlier heavy waiter (no queue jumping)', async () => {
    let t = 0;
    let release: (() => void) | undefined;
    const rl = new RateLimiter(10, 1, () => t,
      (ms) => new Promise<void>((r) => { release = () => { t += ms; r(); }; }));
    const order: string[] = [];
    const a = rl.acquire(8).then(() => order.push('a'));
    const b = rl.acquire(8).then(() => order.push('b'));
    const c = rl.acquire(2).then(() => order.push('c'));
    await a;
    // b is parked waiting for refill; c must queue behind it,
    // not be served from the 2 tokens b is waiting on
    expect(order).toEqual(['a']);
    release!();
    await b;
    release!(); // c always needs a sleep here (0 tokens remain after b drains them)
    await c;
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
