import { EventEmitter } from 'node:events';
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
/** n candles per step, all CLOSED relative to `now` (anchored at now's bucket, counting backwards). */
const mkCandles = (n: number, step: number, now: number): Candle[] => {
  const anchor = Math.floor(now / step) * step;
  return Array.from({ length: n }, (_, i) => ({ t: anchor - (n - i) * step, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));
};

class FakeWs extends EventEmitter {
  coins: string[] = [];
  started = false;
  lastMessageAt = 0;
  connected = true;
  start() { this.started = true; }
  stop() {}
  setCoins(c: string[]) { this.coins = [...c]; }
}

class FakePool {
  jobs: { candleCount: number }[] = [];
  queueDepth = 0; busyCount = 0;
  result: AnalyzeResult = { scanResults: [], plans: [], candleCount: 0, lastCandleT: 0 };
  async run(job: { candles: Candle[] }): Promise<AnalyzeResult> {
    this.jobs.push({ candleCount: job.candles.length });
    return { ...this.result, candleCount: job.candles.length, lastCandleT: job.candles[job.candles.length - 1]?.t ?? 0 };
  }
  async destroy() {}
}

const mkEngine = async (over: { universe?: { name: string; dayNtlVlm: number }[] } = {}) => {
  const db = openDb(':memory:');
  let now = 100 * M15 + 1;
  const universe = over.universe ?? [{ name: 'BTC', dayNtlVlm: 100 }];
  const gapFills: { coin: string; interval: string; force: boolean }[] = [];
  const candleService = {
    getCandles: async (coin: string, interval: string, _lb: number, opts: { force?: boolean } = {}) => {
      if (opts.force) gapFills.push({ coin, interval, force: true });
      return mkCandles(100, interval === '15m' ? M15 : M15 * 4, now); // 100 closed candles per timeframe
    },
  };
  const marketsService = { getMarkets: async () => ({ markets: universe.map((u) => ({ ...u, szDecimals: 2, maxLeverage: 10 })), updatedAt: 0 }) };
  const ws = new FakeWs();
  const pool = new FakePool();
  const config = {
    ...structuredClone(DEFAULT_ENGINE_CONFIG),
    timeframes: ['15m', '1h'] as const, lookback: 200, workerCount: 2,
  };
  const engine = new Engine({
    config: config as never, log: nullLogger(),
    candleService: candleService as never, marketsService: marketsService as never,
    candleStore: new CandleStore(db), alertStore: new AlertStore(db),
    maSelectionStore: new MaSelectionStore(db),
    dispatch: async () => ['telegram'],
    ws: ws as never, pool: pool as never,
    now: () => now,
  });
  await engine.start();
  await new Promise((r) => setTimeout(r, 20)); // let async coin-ready handlers settle
  return { engine, ws, pool, db, gapFills, setNow: (t: number) => { now = t; } };
};

describe('Engine wiring', () => {
  it('on start: loads the universe, starts WS, subscribes ready coins, runs initial scans', async () => {
    const { engine, ws, pool } = await mkEngine();
    expect(ws.started).toBe(true);
    expect(ws.coins).toEqual(['BTC']);
    expect(pool.jobs.length).toBe(2); // initial scan per timeframe
    expect(engine.status().coinsLive).toBe(1);
    expect(engine.status().scansCompleted).toBeGreaterThanOrEqual(2);
    await engine.stop();
  });

  it('a WS candle close persists the candle, enqueues a scan, and completes it', async () => {
    const { engine, ws, pool, db } = await mkEngine();
    const before = pool.jobs.length;
    ws.emit('candle', { coin: 'BTC', interval: '15m', candle: { t: 100 * M15, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 } });
    ws.emit('candle', { coin: 'BTC', interval: '15m', candle: { t: 101 * M15, o: 1, h: 2, l: 0.5, c: 1.6, v: 1, n: 1 } }); // closes the first
    await new Promise((r) => setTimeout(r, 20));
    expect(pool.jobs.length).toBeGreaterThan(before);
    const stored = new CandleStore(db).get('BTC', '15m', 100 * M15, 100 * M15);
    expect(stored).toHaveLength(1);
    await engine.stop();
  });

  it('reconnect after down gap-fills with force and reseeds', async () => {
    const { engine, ws, gapFills } = await mkEngine();
    ws.emit('down', 'silence');
    ws.emit('open');
    await new Promise((r) => setTimeout(r, 20));
    expect(gapFills).toEqual(expect.arrayContaining([
      { coin: 'BTC', interval: '15m', force: true },
      { coin: 'BTC', interval: '1h', force: true },
    ]));
    await engine.stop();
  });

  it('universe refresh diff adds and removes subscriptions', async () => {
    const { engine, ws } = await mkEngine({ universe: [{ name: 'BTC', dayNtlVlm: 100 }] });
    expect(ws.coins).toEqual(['BTC']);
    await engine.refreshUniverse([{ name: 'ETH', dayNtlVlm: 200 }, { name: 'BTC', dayNtlVlm: 100 }]
      .map((u) => ({ ...u, szDecimals: 2, maxLeverage: 10 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(ws.coins.sort()).toEqual(['BTC', 'ETH']);
    await engine.refreshUniverse([{ name: 'ETH', dayNtlVlm: 200, szDecimals: 2, maxLeverage: 10 }]);
    expect(ws.coins).toEqual(['ETH']); // BTC delisted → unsubscribed and dropped
    expect(engine.status().coinsTracked).toBe(1);
    await engine.stop();
  });

  it('status() reports ws/queue/worker/latency state', async () => {
    const { engine } = await mkEngine();
    const s = engine.status();
    expect(s.wsConnected).toBe(true);
    expect(typeof s.queueDepth).toBe('number');
    expect(typeof s.scansCompleted).toBe('number');
    expect(s.latencies).toBeDefined();
    await engine.stop();
  });
});
