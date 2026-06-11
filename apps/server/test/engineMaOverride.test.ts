import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

const emptyResult: AnalyzeResult = { scanResults: [], plans: [], candleCount: 100, lastCandleT: 0 };

function makeEngine(db: ReturnType<typeof openDb>) {
  const bucket = Math.floor(Date.now() / M15) * M15;
  const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
    ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
  const jobs: { config: { detector: { maFast: unknown; maSlow: unknown } } }[] = [];
  const pool = {
    queueDepth: 0, busyCount: 0,
    run: async (job: never) => { jobs.push(job); return emptyResult; },
    destroy: async () => {},
  };
  const fakeWs = {
    connected: true, lastMessageAt: Date.now(),
    start: () => {}, stop: () => {}, setCoins: () => {}, on: () => fakeWs,
  };
  const engine = new Engine({
    config: { ...DEFAULT_ENGINE_CONFIG, timeframes: ['15m'], universeCap: 2, workerCount: 1 },
    log: nullLogger(),
    candleService: { getCandles: async () => closed } as never,
    marketsService: {
      getMarkets: async () => ({
        markets: [
          { name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 },
          { name: 'ETH', dayNtlVlm: 50, szDecimals: 2, maxLeverage: 10 },
        ],
        updatedAt: 0,
      }),
    } as never,
    candleStore: new CandleStore(db),
    alertStore: new AlertStore(db),
    maSelectionStore: new MaSelectionStore(db),
    dispatch: async () => [],
    ws: fakeWs as never,
    pool: pool as never,
  });
  return { engine, jobs };
}

describe('engine MA selection overrides', () => {
  it('close scans use the stored selection for that coin×timeframe and defaults elsewhere', async () => {
    const db = openDb(':memory:');
    const store = new MaSelectionStore(db);
    store.upsert({
      coin: 'BTC', interval: '15m',
      fast: { type: 'SMA', period: 9 }, slow: { type: 'EMA', period: 150 },
      setupKinds: ['ma-golden-cross'],
      train: { trades: 30, wins: 15, winRate: 0.5, avgR: 0.3, profitFactor: 1.5, expectancy: 0.3, maxDrawdownR: 1, filtered: 0, longTrades: 30, shortTrades: 0 },
      validation: { trades: 10, wins: 5, winRate: 0.5, avgR: 0.2, profitFactor: 1.2, expectancy: 0.2, maxDrawdownR: 1, filtered: 0, longTrades: 10, shortTrades: 0 },
      baselineSetupKinds: null, baselineTrain: null, baselineValidation: null,
      candleCount: 2000, splitIndex: 1400, selectedAt: 1,
    });
    const { engine, jobs } = makeEngine(db);
    await engine.start();
    await until(() => jobs.length >= 2); // BTC + ETH initial scans
    await engine.stop();
    const btcJob = jobs.find((j) => j.config.detector.maFast && (j.config.detector.maFast as { period: number }).period === 9);
    expect(btcJob).toBeDefined();
    expect(btcJob!.config.detector.maSlow).toEqual({ type: 'EMA', period: 150 });
    const ethJob = jobs.find((j) => (j.config.detector.maFast as { period: number }).period === 50);
    expect(ethJob).toBeDefined(); // default EMA50/SMA200 fallback
    expect(ethJob!.config.detector.maSlow).toEqual({ type: 'SMA', period: 200 });
  });
});
