// apps/server/test/engineLive.test.ts — integration: real Engine over fake HL WS, streamed via SSE.
// Proves Tasks 6/8/9/10 compose: snapshot replays first, scan emits before its alerts, health flows.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnalyzeResult, Candle, SetupResult, TradePlan } from '@cta/core';
import { buildApp } from '../src/app';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { HyperliquidWs } from '../src/engine/ws';
import { LiveFeed } from '../src/engine/liveFeed';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';
import type { HealthEvent, ScanEvent } from '../src/engine/types';
import type { AlertRow } from '../src/cache/alertStore';
import { startFakeHlWs, type FakeHlWs } from './helpers/fakeHlWs';
import { pumpEvents, type SseEvent } from './helpers/sse';

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
const activePlan: TradePlan = {
  setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
  entry: 2.5, stop: 2, target: 3.5, rr: 2, status: 'active',
  metrics: qualifiedResult.metrics,
  confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
};

describe('engine live feed integration (fake HL WS → SSE)', () => {
  let fake: FakeHlWs;
  let engine: Engine;
  let feed: LiveFeed;
  let app: FastifyInstance | null = null;
  beforeEach(async () => { fake = await startFakeHlWs(); });
  afterEach(async () => {
    // safe teardown order: engine timers first, then end SSE responses so app.close() can't
    // hang on the open hijacked connection, then the HTTP server, then the fake WS server
    await engine?.stop();
    feed?.destroy();
    if (app) { await app.close(); app = null; }
    await fake.close();
  });

  it('streams snapshot first, then scan → alert (in that order) → health over one open stream', async () => {
    const bucket = Math.floor(Date.now() / M15) * M15;
    const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
      ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
    const candleService = {
      getCandles: async () => closed,
    };
    const marketsService = { getMarkets: async () => ({ markets: [{ name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 }], updatedAt: 0 }) };
    const db = openDb(':memory:');
    const alertStore = new AlertStore(db);
    // second and later scans return a DIFFERENT entry → distinct plan identity → the second
    // close fires a real (non-deduped) confirmed-new, so the scan-before-alert ordering
    // assertion is actually exercised
    let scanCalls = 0;
    const pool = {
      queueDepth: 0, busyCount: 0,
      run: async (job: { candles: Candle[] }): Promise<AnalyzeResult> => {
        scanCalls++;
        const plan = scanCalls === 1 ? activePlan : { ...activePlan, entry: 3 };
        return { scanResults: [qualifiedResult], plans: [plan], candleCount: job.candles.length, lastCandleT: job.candles[job.candles.length - 1].t };
      },
      destroy: async () => {},
    };
    const ws = new HyperliquidWs({ url: fake.url, log: nullLogger(), silenceMs: 600_000, pingIntervalMs: 600_000, baseBackoffMs: 20, maxBackoffMs: 50 });
    engine = new Engine({
      config: {
        ...structuredClone(DEFAULT_ENGINE_CONFIG),
        timeframes: ['15m'], lookback: 200, workerCount: 1,
        tickMinMovePct: 0, tickMinIntervalMs: 0, burstLimit: 100, closeGraceMs: 600_000,
        confirmedMinConfidence: 0,
      } as never,
      log: nullLogger(),
      candleService: candleService as never, marketsService: marketsService as never,
      candleStore: new CandleStore(db), alertStore,
      maSelectionStore: new MaSelectionStore(db),
      dispatch: async () => ['test-sink'],
      ws, pool: pool as never,
      provisionalAnalyze: () => [], // tick path inert — this test drives the close-scan path only
    });

    feed = new LiveFeed({ log: nullLogger() });
    engine.events.on('scan', (e) => feed.broadcast('scan', e));
    engine.events.on('alert', (r) => feed.broadcast('alert', r));
    engine.events.on('health', (h) => feed.broadcast('health', h));
    app = buildApp({ live: { feed, snapshot: () => ({ ...engine.liveSnapshot(), alerts: alertStore.recent(50) }) } });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });

    const firstConn = fake.nextConnection(); // register before start: the backfill/scan path can win the race against the WS handshake
    await engine.start();
    await until(() => engine.status().coinsLive === 1 && engine.status().scansCompleted >= 1);
    await firstConn; // sendCandle targets the latest connected client — wait for it
    // the boot scan's confirmed-new is persisted asynchronously after scansCompleted ticks
    await until(() => alertStore.recent(10).some((r) => r.kind === 'confirmed-new'));
    await until(() => engine.status().wsConnected); // snapshot must report a connected WS

    const res = await fetch(`${base}/live`, { headers: { accept: 'text/event-stream' } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events: SseEvent[] = [];
    const pump = pumpEvents(res.body!, events);

    // ── first frame is the snapshot, carrying rankings + persisted alerts + health ──
    await until(() => events.length >= 1, 5_000);
    expect(events[0].event).toBe('snapshot');
    const snap = events[0].data as { scans: ScanEvent[]; alerts: AlertRow[]; health: HealthEvent };
    const ranking = snap.scans.find((s) => s.coin === 'BTC' && s.interval === '15m');
    expect(ranking).toBeDefined();
    expect(ranking!.plan).toMatchObject({ entry: 2.5, confidence: activePlan.confidence.score });
    const persisted = snap.alerts.find((a) => a.kind === 'confirmed-new' && a.coin === 'BTC');
    expect(persisted).toBeDefined();
    expect(persisted!.interval).toBe('15m');
    expect(snap.health.wsConnected).toBe(true);
    expect(typeof snap.health.ts).toBe('number');

    // ── drive the fake WS to close another 15m candle (forming candle, then next bucket) ──
    fake.sendCandle('BTC', { t: bucket, o: 1, h: 1.1, l: 0.95, c: 1.05, v: 1 });
    fake.sendCandle('BTC', { t: bucket + M15, o: 1.05, h: 1.1, l: 1, c: 1.05, v: 1 });

    // scan event for BTC|15m arrives on the SAME open stream
    await until(() => events.some((e) => e.event === 'scan'), 5_000);
    const scanIdx = events.findIndex((e) => e.event === 'scan');
    const scan = events[scanIdx].data as ScanEvent;
    expect(scan).toMatchObject({ coin: 'BTC', interval: '15m' });
    expect(scan.plan).toMatchObject({ entry: 3, confidence: activePlan.confidence.score });

    // its confirmed-new alert arrives AFTER the scan event (Task 8 ordering)
    await until(() => events.some((e) => e.event === 'alert'), 5_000);
    const alertIdx = events.findIndex((e) => e.event === 'alert');
    expect(alertIdx).toBeGreaterThan(scanIdx);
    const alert = events[alertIdx].data as AlertRow;
    expect(alert).toMatchObject({ kind: 'confirmed-new', coin: 'BTC', interval: '15m' });
    expect((alert.payload as { entry: number }).entry).toBe(3);

    // a health event arrives within ~3s of the close (2s engine timer)
    await until(() => events.slice(scanIdx + 1).some((e) => e.event === 'health'), 3_500);
    const health = events.slice(scanIdx + 1).find((e) => e.event === 'health')!.data as HealthEvent;
    expect(health.wsConnected).toBe(true);
    expect(typeof health.ts).toBe('number');

    await pump.stop(); // release the client side before afterEach closes the server
  }, 15_000);
});
