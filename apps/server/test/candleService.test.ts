import { describe, it, expect, vi } from 'vitest';
import { CandleService } from '../src/services/candleService';
import { CandleStore } from '../src/cache/candleStore';
import { openDb } from '../src/cache/db';
import { INTERVAL_MS } from '../src/hyperliquid/pagination';
import type { Candle } from '@cta/core';

const noopLimiter = { acquire: async () => {}, available: 0 } as any;

function makeClient(source: Candle[]) {
  return {
    candleSnapshot: vi.fn(async (_c: string, _i: string, s: number, e: number) =>
      source.filter((c) => c.t >= s && c.t <= e).slice(0, 5000),
    ),
  } as any;
}

const STEP = 60_000; // '1m'
const mk = (t: number): Candle => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 });

function fakes(stored: Candle[]) {
  const calls: { start: number; end: number }[] = [];
  const store = {
    rows: [...stored],
    upsert(_c: string, _i: string, cs: Candle[]) { this.rows.push(...cs); },
    get(_c: string, _i: string, from: number, to: number) {
      return this.rows.filter((r) => r.t >= from && r.t <= to).sort((a, b) => a.t - b.t);
    },
    latestTime() { return this.rows.length ? Math.max(...this.rows.map((r) => r.t)) : null; },
    earliestTime() { return this.rows.length ? Math.min(...this.rows.map((r) => r.t)) : null; },
  };
  const client = {
    candleSnapshot: async (_coin: string, _int: string, s: number, e: number) => {
      calls.push({ start: s, end: e });
      const out: Candle[] = [];
      for (let t = Math.ceil(s / STEP) * STEP; t <= e; t += STEP) out.push(mk(t));
      return out;
    },
  };
  const rateLimiter = { acquire: async () => {} };
  return { calls, store, client, rateLimiter };
}

describe('candleService force + tail-only backfill', () => {
  const end = 100 * STEP;

  it('force refetches the head even when the cache is fresh', async () => {
    const stored = [mk(end - 2 * STEP), mk(end - STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 2, { force: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - STEP); // re-fetches the latest stored candle
    expect(f.calls[0].end).toBe(end);
  });

  it('fresh cache without force fetches nothing', async () => {
    const f = fakes([mk(end - 2 * STEP), mk(end - STEP)]);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 2);
    expect(f.calls).toHaveLength(0);
  });

  it('extending lookback backfills only the missing tail', async () => {
    // cache holds the head; only the older range should be fetched
    const stored = [mk(end - 3 * STEP), mk(end - 2 * STEP), mk(end - STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 10);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - 10 * STEP);
    expect(f.calls[0].end).toBe(end - 4 * STEP); // earliest - step, NOT `end`
  });

  it('stale head fetches only the missing head range', async () => {
    const stored = [mk(end - 5 * STEP), mk(end - 4 * STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 5);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - 3 * STEP); // latest + step
    expect(f.calls[0].end).toBe(end);
  });
});

describe('CandleService', () => {
  it('fetches on a cold cache, then serves from cache when fresh', async () => {
    const step = INTERVAL_MS['1h'];
    const now = 100 * step;
    const source: Candle[] = [];
    for (let t = 0; t <= now; t += step) source.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });

    const client = makeClient(source);
    const store = new CandleStore(openDb(':memory:'));
    const svc = new CandleService({ client, store, rateLimiter: noopLimiter, now: () => now });

    const first = await svc.getCandles('BTC', '1h', 10);
    expect(client.candleSnapshot).toHaveBeenCalled();
    expect(first).toHaveLength(11); // last 10 + inclusive boundary

    client.candleSnapshot.mockClear();
    const second = await svc.getCandles('BTC', '1h', 10);
    expect(client.candleSnapshot).not.toHaveBeenCalled();
    expect(second).toHaveLength(first.length);
  });

  it('backfills when lookback grows beyond the warm cache window', async () => {
    const step = INTERVAL_MS['1h'];
    const now = 100 * step;
    const source: Candle[] = [];
    for (let t = 0; t <= now; t += step) source.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });

    const client = makeClient(source);
    const store = new CandleStore(openDb(':memory:'));
    const svc = new CandleService({ client, store, rateLimiter: noopLimiter, now: () => now });

    const small = await svc.getCandles('BTC', '1h', 10);
    expect(small).toHaveLength(11); // [90*step .. 100*step]

    client.candleSnapshot.mockClear();
    const big = await svc.getCandles('BTC', '1h', 50);
    expect(client.candleSnapshot).toHaveBeenCalled(); // must refetch to backfill 50..89
    expect(big).toHaveLength(51); // [50*step .. 100*step] inclusive
  });
});
