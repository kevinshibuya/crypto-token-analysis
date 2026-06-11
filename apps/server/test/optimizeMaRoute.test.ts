import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const summary = {
  startedAt: 1, finishedAt: 2, evaluated: 4, selected: 1, reverted: 3, skipped: 0, failed: 0, decisions: [],
};

describe('POST /engine/optimize-ma', () => {
  it('runs the optimizer for parsed coins and returns the summary', async () => {
    const calls: (string[] | undefined)[] = [];
    const app = buildApp({ optimizeMa: async (coins) => { calls.push(coins); return summary; } });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma?coins=BTC,%20eth' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summary);
    expect(calls).toEqual([['BTC', 'ETH']]); // trimmed + uppercased
  });

  it('omitting coins passes undefined (full live universe)', async () => {
    const calls: (string[] | undefined)[] = [];
    const app = buildApp({ optimizeMa: async (coins) => { calls.push(coins); return summary; } });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([undefined]);
  });

  it('rejects non-loopback callers with 403', async () => {
    const app = buildApp({ optimizeMa: async () => summary });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma', remoteAddress: '10.0.0.5' });
    expect(res.statusCode).toBe(403);
  });

  it('is absent when the engine is disabled', async () => {
    const app = buildApp({});
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma' });
    expect(res.statusCode).toBe(404);
  });
});
