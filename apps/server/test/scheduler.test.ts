// apps/server/test/scheduler.test.ts
import { describe, expect, it } from 'vitest';
import { ScanQueue, TickGate } from '../src/engine/scheduler';

describe('ScanQueue', () => {
  it('coalesces duplicate coin×interval jobs', () => {
    const q = new ScanQueue();
    q.push({ coin: 'BTC', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    q.push({ coin: 'BTC', interval: '15m' });
    expect(q.size).toBe(2);
  });

  it('pops by volume rank (ascending) with provisional-active coins first', () => {
    const q = new ScanQueue();
    q.setVolumeRanks(new Map([['BTC', 0], ['ETH', 1], ['DOGE', 50]]));
    q.push({ coin: 'DOGE', interval: '1h' });
    q.push({ coin: 'ETH', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    q.markProvisionalActive('DOGE', true);
    expect(q.pop()).toEqual({ coin: 'DOGE', interval: '1h' }); // provisional-active jumps
    expect(q.pop()).toEqual({ coin: 'BTC', interval: '1h' });  // then rank order
    expect(q.pop()).toEqual({ coin: 'ETH', interval: '1h' });
    expect(q.pop()).toBeUndefined();
  });

  it('unranked coins sort after ranked ones', () => {
    const q = new ScanQueue();
    q.setVolumeRanks(new Map([['BTC', 0]]));
    q.push({ coin: 'NEWCOIN', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    expect(q.pop()!.coin).toBe('BTC');
    expect(q.pop()!.coin).toBe('NEWCOIN');
  });

  it('re-pushing after pop is allowed (not deduped against history)', () => {
    const q = new ScanQueue();
    q.push({ coin: 'BTC', interval: '1h' });
    q.pop();
    q.push({ coin: 'BTC', interval: '1h' });
    expect(q.size).toBe(1);
  });
});

describe('TickGate', () => {
  it('passes only when the move exceeds minMovePct since the last evaluation', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);      // first sighting
    now = 2000;
    expect(g.shouldEvaluate('BTC', 100.01)).toBe(false);  // 0.01% < 0.05%
    expect(g.shouldEvaluate('BTC', 100.2)).toBe(true);    // 0.2% move passes
  });

  it('rate-limits to one evaluation per minIntervalMs per coin', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    now = 500;
    expect(g.shouldEvaluate('BTC', 200)).toBe(false);     // huge move but inside the window
    now = 1001;
    expect(g.shouldEvaluate('BTC', 200)).toBe(true);
  });

  it('tracks coins independently', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    expect(g.shouldEvaluate('ETH', 100)).toBe(true);
  });

  it('reference price updates only on passed evaluations (no drift accumulation)', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 0, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    expect(g.shouldEvaluate('BTC', 100.03)).toBe(false); // +0.03%
    expect(g.shouldEvaluate('BTC', 100.06)).toBe(true);  // +0.06% vs 100 — tiny ticks must accumulate
  });
});
