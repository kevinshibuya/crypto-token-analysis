import type { Candle, Interval } from '@cta/core';
import { fetchCandles, INTERVAL_MS } from '../hyperliquid/pagination';
import { MAX_CANDLES_PER_REQUEST } from '../config';
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

  async getCandles(coin: string, interval: string, lookback: number): Promise<Candle[]> {
    const step = INTERVAL_MS[interval as Interval];
    if (!step) throw new Error(`unknown interval ${interval}`);
    const end = this.now();
    const wantStart = end - lookback * step;
    const latest = this.deps.store.latestTime(coin, interval);
    const earliest = this.deps.store.earliestTime(coin, interval);
    const fetchStart = latest === null ? wantStart : Math.min(wantStart, latest + step);

    // Refetch when the cache is missing the recent head — cold, or the latest closed
    // candle is older than one step. NOTE: the `< end - step` boundary is a deliberate
    // one-step staleness window (Phase 1 is on-demand refresh, no WebSocket), so the
    // most-recently-closed candle may lag by up to one poll.
    const missingHead = latest === null || latest < end - step;
    // ...or when the cache doesn't reach back to the requested window (e.g. the caller
    // increased `lookback` on a warm cache). Without this, store.get would silently
    // return a truncated series.
    const missingTail = earliest === null || earliest > wantStart;
    if (missingHead || missingTail) {
      await this.fetchAndStore(coin, interval, fetchStart, end);
    }
    return this.deps.store.get(coin, interval, wantStart, end);
  }

  private async fetchAndStore(coin: string, interval: string, start: number, end: number): Promise<void> {
    const step = INTERVAL_MS[interval as Interval];
    const candles = await fetchCandles(
      async (s, e) => {
        const est = Math.min(MAX_CANDLES_PER_REQUEST, Math.ceil((e - s) / step) + 1);
        await this.deps.rateLimiter.acquire(Math.max(1, Math.ceil(est / 60)));
        return this.deps.client.candleSnapshot(coin, interval, s, e);
      },
      interval,
      start,
      end,
    );
    if (candles.length) this.deps.store.upsert(coin, interval, candles);
  }
}
