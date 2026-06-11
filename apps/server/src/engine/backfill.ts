import { EventEmitter } from 'node:events';
import type { Candle, Interval } from '@cta/core';
import type { CandleService } from '../services/candleService';
import type { MarketsService } from '../services/marketsService';
import type { EngineLogger } from './logger';

export interface BackfillOptions {
  candleService: CandleService;
  marketsService: MarketsService;
  log: EngineLogger;
  timeframes: Interval[];
  lookback: number;
  universeCap: number;   // 0 = all
  concurrency?: number;  // parallel coins (the rate limiter is the real throttle); default 2
}

export interface UniverseSnapshot { coins: string[]; ranks: Map<string, number> }
export interface CoinReadyEvent { coin: string; series: Map<Interval, Candle[]> }

/**
 * Volume-ordered history loader. Emits 'coin-ready' (CoinReadyEvent) per coin as its data lands —
 * the engine seeds the aggregator and starts analysis per coin, never behind a global barrier.
 */
export class BackfillOrchestrator extends EventEmitter {
  private degraded = new Set<string>();
  constructor(private o: BackfillOptions) { super(); }

  get degradedCoins(): string[] { return [...this.degraded]; }

  async loadUniverse(): Promise<UniverseSnapshot> {
    const { markets } = await this.o.marketsService.getMarkets();
    const sorted = [...markets].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
    const capped = this.o.universeCap > 0 ? sorted.slice(0, this.o.universeCap) : sorted;
    const coins = capped.map((m) => m.name);
    return { coins, ranks: new Map(coins.map((c, i) => [c, i])) };
  }

  /** Fetch history for the given coins (already in priority order). Resolves when all settle. */
  async run(coins: string[]): Promise<void> {
    const queue = [...coins];
    const workers = Array.from({ length: Math.min(this.o.concurrency ?? 2, Math.max(1, queue.length)) }, async () => {
      for (;;) {
        const coin = queue.shift();
        if (!coin) return;
        await this.fetchCoin(coin);
      }
    });
    await Promise.all(workers);
  }

  async retryDegraded(): Promise<void> {
    const coins = [...this.degraded];
    for (const coin of coins) await this.fetchCoin(coin);
  }

  private async fetchCoin(coin: string): Promise<void> {
    try {
      const series = new Map<Interval, Candle[]>();
      for (const tf of this.o.timeframes) {
        series.set(tf, await this.o.candleService.getCandles(coin, tf, this.o.lookback));
      }
      this.degraded.delete(coin);
      this.emit('coin-ready', { coin, series } satisfies CoinReadyEvent);
    } catch (err) {
      this.degraded.add(coin);
      this.o.log.warn({ coin, err: (err as Error).message }, 'backfill failed — coin degraded');
    }
  }
}
