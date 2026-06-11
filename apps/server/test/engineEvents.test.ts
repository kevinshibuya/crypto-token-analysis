// apps/server/test/engineEvents.test.ts
import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle, TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';
import type { ScanEvent } from '../src/engine/types';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

const plan: TradePlan = {
  setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
  entry: 2.5, stop: 2, target: 3.5, rr: 2, status: 'active',
  metrics: { trades: 30, wins: 18, winRate: 0.6, avgR: 0.4, profitFactor: 2.5, expectancy: 0.4, maxDrawdownR: 1.2, filtered: 0, longTrades: 30, shortTrades: 0 },
  confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
};
const result: AnalyzeResult = { scanResults: [], plans: [plan], candleCount: 100, lastCandleT: 99 };

describe('engine events', () => {
  it('emits scan (before its alerts), alert, and health; liveSnapshot ranks by confidence', async () => {
    const db = openDb(':memory:');
    const bucket = Math.floor(Date.now() / M15) * M15;
    const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
      ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
    const fakeWs = {
      connected: true, lastMessageAt: Date.now(),
      start: () => {}, stop: () => {}, setCoins: () => {}, on: () => fakeWs,
    };
    const engine = new Engine({
      config: { ...DEFAULT_ENGINE_CONFIG, timeframes: ['15m'], universeCap: 1, workerCount: 1, confirmedMinConfidence: 0 },
      log: nullLogger(),
      candleService: { getCandles: async () => closed } as never,
      marketsService: { getMarkets: async () => ({ markets: [{ name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 }], updatedAt: 0 }) } as never,
      candleStore: new CandleStore(db),
      alertStore: new AlertStore(db),
      maSelectionStore: new MaSelectionStore(db),
      dispatch: async () => ['telegram'],
      ws: fakeWs as never,
      pool: { queueDepth: 0, busyCount: 0, run: async () => result, destroy: async () => {} } as never,
    });
    const order: string[] = [];
    const scans: ScanEvent[] = [];
    engine.events.on('scan', (e: ScanEvent) => { order.push('scan'); scans.push(e); });
    engine.events.on('alert', () => order.push('alert'));
    engine.events.on('health', () => order.push('health'));
    await engine.start();
    await until(() => order.includes('scan') && order.includes('alert'));
    expect(order.indexOf('scan')).toBeLessThan(order.indexOf('alert')); // scan precedes its own alerts
    expect(scans[0]).toMatchObject({
      coin: 'BTC', interval: '15m', candleCount: 100,
      plan: { direction: 'bullish', setup: ['rsi-oversold-exit'], entry: 2.5, stop: 2, target: 3.5, rr: 2, confidence: 80 },
    });
    const snap = engine.liveSnapshot();
    expect(snap.scans).toHaveLength(1);
    expect(snap.health.wsConnected).toBe(true);
    expect(typeof snap.health.ts).toBe('number');
    await until(() => order.includes('health'), 4_000); // 2s health timer
    await engine.stop();
  });
});
