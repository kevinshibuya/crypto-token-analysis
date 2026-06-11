import { describe, expect, it } from 'vitest';
import { LatencyTracker } from '../src/engine/metrics';

describe('LatencyTracker', () => {
  it('reports p50/p95/count per metric', () => {
    const m = new LatencyTracker();
    for (let i = 1; i <= 100; i++) m.record('scan', i);
    const p = m.percentiles('scan')!;
    expect(p.count).toBe(100);
    expect(p.p50).toBeGreaterThanOrEqual(50);
    expect(p.p50).toBeLessThanOrEqual(51);
    expect(p.p95).toBeGreaterThanOrEqual(95);
    expect(p.p95).toBeLessThanOrEqual(96);
  });

  it('returns null for unknown metrics and caps the ring buffer', () => {
    const m = new LatencyTracker(10);
    expect(m.percentiles('nope')).toBeNull();
    for (let i = 0; i < 25; i++) m.record('x', i);
    expect(m.percentiles('x')!.count).toBe(10); // only the newest 10 retained
    expect(m.percentiles('x')!.p50).toBeGreaterThanOrEqual(19); // old values evicted
  });

  it('snapshot lists every tracked metric', () => {
    const m = new LatencyTracker();
    m.record('a', 1);
    m.record('b', 2);
    expect(Object.keys(m.snapshot()).sort()).toEqual(['a', 'b']);
  });
});
