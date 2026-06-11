import type { Candle, Interval } from '@cta/core';
import { fetchCandles, INTERVAL_MS } from '../hyperliquid/pagination';
import { MAX_CANDLES_PER_REQUEST, CANDLE_SNAPSHOT_BASE_WEIGHT } from '../config';
import type { CandleStore } from '../cache/candleStore';
import type { HyperliquidClient } from '../hyperliquid/client';
import type { RateLimiter } from '../hyperliquid/rateLimiter';

export interface CandleServiceDeps {
  client: HyperliquidClient;
  store: CandleStore;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export class CandleService {
  private now: () => number;
  constructor(private deps: CandleServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async getCandles(
    coin: string,
    interval: string,
    lookback: number,
    opts: { force?: boolean } = {},
  ): Promise<Candle[]> {
    const step = INTERVAL_MS[interval as keyof typeof INTERVAL_MS];
    if (!step) throw new Error(`unknown interval ${interval}`);
    const force = opts.force ?? false;
    const end = this.now();
    const wantStart = end - lookback * step;
    const latest = this.deps.store.latestTime(coin, interval);
    const earliest = this.deps.store.earliestTime(coin, interval);

    if (latest === null || earliest === null) {
      await this.fetchAndStore(coin, interval as Interval, wantStart, end);
    } else {
      // Tail: fetch only the missing older range (the cached middle is never refetched).
      if (earliest > wantStart) await this.fetchAndStore(coin, interval as Interval, wantStart, earliest - step);
      // Head: one-step staleness window as before; `force` refetches the latest
      // stored candle too, since it may have been cached while still open.
      const missingHead = latest < end - step;
      if (missingHead || force) {
        await this.fetchAndStore(coin, interval as Interval, force ? latest : latest + step, end);
      }
    }
    return this.deps.store.get(coin, interval, wantStart, end);
  }

  private async fetchAndStore(coin: string, interval: Interval, start: number, end: number): Promise<void> {
    const step = INTERVAL_MS[interval];
    const candles = await fetchCandles(
      async (s, e) => {
        const est = Math.min(MAX_CANDLES_PER_REQUEST, Math.ceil((e - s) / step) + 1);
        await this.deps.rateLimiter.acquire(CANDLE_SNAPSHOT_BASE_WEIGHT + Math.max(1, Math.ceil(est / 60)));
        return this.deps.client.candleSnapshot(coin, interval, s, e);
      },
      interval,
      start,
      end,
    );
    if (candles.length) this.deps.store.upsert(coin, interval, candles);
  }
}
