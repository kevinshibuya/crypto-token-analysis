import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app';
import { MarketsService } from '../src/services/marketsService';
import { MarketStore } from '../src/cache/marketStore';
import { openDb } from '../src/cache/db';

const noopLimiter = { acquire: async () => {}, available: 0 } as any;

describe('MarketsService', () => {
  it('fetches once then serves cache within TTL', async () => {
    const client = {
      metaAndAssetCtxs: vi.fn(async () => ({
        universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }],
        assetCtxs: [{ dayNtlVlm: 100 }],
      })),
    } as any;
    const store = new MarketStore(openDb(':memory:'));
    let now = 0;
    const svc = new MarketsService({ client, store, rateLimiter: noopLimiter, now: () => now });
    const a = await svc.getMarkets();
    expect(a.markets[0].name).toBe('BTC');
    expect(client.metaAndAssetCtxs).toHaveBeenCalledTimes(1);
    now += 1000;
    await svc.getMarkets();
    expect(client.metaAndAssetCtxs).toHaveBeenCalledTimes(1);
  });

  it('market rows carry dayNtlVlm aligned by index', async () => {
    const client = {
      metaAndAssetCtxs: vi.fn(async () => ({
        universe: [
          { name: 'BTC', szDecimals: 5, maxLeverage: 50 },
          { name: 'ETH', szDecimals: 4, maxLeverage: 50 },
        ],
        assetCtxs: [{ dayNtlVlm: 100 }, { dayNtlVlm: 50 }],
      })),
    } as any;
    const store = new MarketStore(openDb(':memory:'));
    const svc = new MarketsService({ client, store, rateLimiter: noopLimiter, now: () => 0 });
    const { markets } = await svc.getMarkets();
    expect(markets[0]).toMatchObject({ name: 'BTC', dayNtlVlm: 100 });
    expect(markets[1]).toMatchObject({ name: 'ETH', dayNtlVlm: 50 });
  });

  it('store normalizes legacy rows without dayNtlVlm to 0', () => {
    const store = new MarketStore(openDb(':memory:'));
    store.set([{ name: 'BTC', szDecimals: 5, maxLeverage: 50 } as any], 0);
    expect(store.get()!.markets[0].dayNtlVlm).toBe(0);
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
