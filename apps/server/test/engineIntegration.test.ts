// apps/server/test/engineIntegration.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle, SetupResult, TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { HyperliquidWs } from '../src/engine/ws';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';
import { startFakeHlWs, type FakeHlWs } from './helpers/fakeHlWs';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

// metrics pass DEFAULT_GATE (minTrades: 20, minExpectancy: 0.1): trades 30 ≥ 20, expectancy 0.4 ≥ 0.1
const qualifiedResult: SetupResult = {
  kinds: ['rsi-oversold-exit'],
  metrics: {
    trades: 30, wins: 18, winRate: 0.6, avgR: 0.4, profitFactor: 2.5,
    expectancy: 0.4, maxDrawdownR: 1.2, filtered: 0, longTrades: 30, shortTrades: 0,
  },
};
const provisionalPlan: TradePlan = {
  setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
  entry: 2.5, stop: 2, target: 3.5, rr: 2, status: 'active',
  metrics: qualifiedResult.metrics,
  confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
};

describe('engine integration over fake HL WS', () => {
  let fake: FakeHlWs;
  let engine: Engine;
  afterEach(async () => { await engine?.stop(); await fake.close(); });
  beforeEach(async () => { fake = await startFakeHlWs(); });

  it('provisional-new → provisional-withdrawn → reconnect gap-fill, with exact persisted alerts', async () => {
    const bucket = Math.floor(Date.now() / M15) * M15;
    const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
      ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
    const gapFills: { coin: string; interval: string }[] = [];
    const candleService = {
      getCandles: async (coin: string, interval: string, _lb: number, opts: { force?: boolean } = {}) => {
        if (opts.force) gapFills.push({ coin, interval });
        return closed;
      },
    };
    const marketsService = { getMarkets: async () => ({ markets: [{ name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 }], updatedAt: 0 }) };
    const db = openDb(':memory:');
    const alertStore = new AlertStore(db);
    const dispatched: string[] = [];
    const pool = {
      queueDepth: 0, busyCount: 0,
      run: async (job: { candles: Candle[] }): Promise<AnalyzeResult> =>
        ({ scanResults: [qualifiedResult], plans: [], candleCount: job.candles.length, lastCandleT: job.candles[job.candles.length - 1].t }),
      destroy: async () => {},
    };
    const ws = new HyperliquidWs({ url: fake.url, log: nullLogger(), silenceMs: 600_000, pingIntervalMs: 600_000, baseBackoffMs: 20, maxBackoffMs: 50 });
    engine = new Engine({
      config: {
        ...structuredClone(DEFAULT_ENGINE_CONFIG),
        timeframes: ['15m'], lookback: 200, workerCount: 1,
        tickMinMovePct: 0, tickMinIntervalMs: 0, burstLimit: 100, closeGraceMs: 600_000,
      } as never,
      log: nullLogger(),
      candleService: candleService as never, marketsService: marketsService as never,
      candleStore: new CandleStore(db), alertStore,
      maSelectionStore: new MaSelectionStore(db),
      dispatch: async (text) => { dispatched.push(text); return ['test-sink']; },
      ws, pool: pool as never,
      provisionalAnalyze: (_coin, _interval, candles) => (candles[candles.length - 1].c >= 2 ? [provisionalPlan] : []),
    });

    const firstConn = fake.nextConnection(); // register before start: the backfill/scan path can win the race against the WS handshake
    await engine.start();
    await until(() => engine.status().coinsLive === 1 && engine.status().scansCompleted >= 1);
    await firstConn; // sendCandle/sendMids target the latest connected client — wait for it

    // forming candle arrives, then a mid spike triggers the provisional path
    fake.sendCandle('BTC', { t: bucket, o: 1, h: 1.1, l: 0.95, c: 1.05, v: 1 });
    fake.sendMids({ BTC: 2.5 });
    await until(() => dispatched.length >= 1);
    expect(dispatched[0]).toContain('PROVISIONAL-NEW');
    expect(dispatched[0]).toContain('coin=BTC');

    // next bucket's candle closes the forming one → close scan (plans: []) → withdrawn
    fake.sendCandle('BTC', { t: bucket + M15, o: 2.5, h: 2.5, l: 2.4, c: 2.45, v: 1 });
    await until(() => dispatched.length >= 2);
    expect(dispatched[1]).toContain('PROVISIONAL-WITHDRAWN');
    expect(dispatched[1].toLowerCase()).toContain('did not exist');

    const kinds = alertStore.recent(10).map((r) => r.kind);
    expect(kinds).toEqual(['provisional-withdrawn', 'provisional-new']); // newest first
    // dedupe persisted for both events
    expect(alertStore.lastFired(alertStore.recent(10)[1].identity, 'provisional-new')).not.toBeNull();

    // network drop → reconnect → forced gap-fill for every live coin×timeframe
    fake.dropClients();
    await until(() => gapFills.length >= 1, 5_000);
    expect(gapFills).toEqual(expect.arrayContaining([{ coin: 'BTC', interval: '15m' }]));
    // the candle store still has a contiguous closed series (gap-fill re-seeded from REST stub)
    const stored = new CandleStore(db).get('BTC', '15m', bucket - 100 * M15, bucket + M15);
    expect(stored.length).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
