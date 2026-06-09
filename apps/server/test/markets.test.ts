import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app';
import { MarketsService } from '../src/services/marketsService';
import { MarketStore } from '../src/cache/marketStore';
import { openDb } from '../src/cache/db';

const noopLimiter = { acquire: async () => {}, available: 0 } as any;

describe('MarketsService', () => {
  it('fetches once then serves cache within TTL', async () => {
    const client = { meta: vi.fn(async () => ({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }] })) } as any;
    const store = new MarketStore(openDb(':memory:'));
    let now = 0;
    const svc = new MarketsService({ client, store, rateLimiter: noopLimiter, now: () => now });
    const a = await svc.getMarkets();
    expect(a.markets[0].name).toBe('BTC');
    expect(client.meta).toHaveBeenCalledTimes(1);
    now += 1000;
    await svc.getMarkets();
    expect(client.meta).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/markets', () => {
  it('returns markets from the service', async () => {
    const marketsService = {
      getMarkets: async () => ({ markets: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }], updatedAt: 123 }),
    } as any;
    const app = buildApp({ marketsService });
    const res = await app.inject({ method: 'GET', url: '/api/markets' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ markets: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }], updatedAt: 123 });
  });
});
