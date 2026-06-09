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
});
