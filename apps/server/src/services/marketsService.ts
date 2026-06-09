import type { HyperliquidClient } from '../hyperliquid/client';
import type { RateLimiter } from '../hyperliquid/rateLimiter';
import type { MarketRow, MarketStore } from '../cache/marketStore';

const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface MarketsServiceDeps {
  client: HyperliquidClient;
  store: MarketStore;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export class MarketsService {
  private now: () => number;
  constructor(private deps: MarketsServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async getMarkets(): Promise<{ markets: MarketRow[]; updatedAt: number }> {
    const cached = this.deps.store.get();
    const t = this.now();
    if (cached && t - cached.updatedAt < TTL_MS) return cached;
    await this.deps.rateLimiter.acquire(20);
    const meta = await this.deps.client.meta();
    const markets: MarketRow[] = meta.universe.map((u) => ({
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
    }));
    this.deps.store.set(markets, t);
    return { markets, updatedAt: t };
  }
}
