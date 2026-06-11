import { EventEmitter } from 'node:events';
import { MIN_BACKTEST_CANDLES } from '../config';
import { qualifySetups } from '@cta/core';
import type { EngineAnalysisConfig, Interval, MaSpec } from '@cta/core';
import { DEFAULT_DETECTOR_OPTIONS, DEFAULT_BACKTEST_CONFIG } from '@cta/core';
import type { CandleStore } from '../cache/candleStore';
import type { AlertStore } from '../cache/alertStore';
import type { MaSelectionStore } from '../cache/maSelectionStore';
import type { CandleService } from '../services/candleService';
import type { MarketsService } from '../services/marketsService';
import type { MarketRow } from '../cache/marketStore';
import { CandleAggregator } from './aggregator';
import type { CloseEvent } from './aggregator';
import { AlertEngine } from './alertEngine';
import { BackfillOrchestrator } from './backfill';
import type { CoinReadyEvent } from './backfill';
import type { EngineConfig } from './config';
import type { EngineLogger } from './logger';
import { MaOptimizer } from './maOptimizer';
import type { MaOptimizeSummary } from './maOptimizer';
import { LatencyTracker, type HealthSnapshot } from './metrics';
import { ProvisionalEvaluator, makePlanAnalyzer } from './provisional';
import type { AnalyzePlansFn } from './provisional';
import { ScanQueue, TickGate } from './scheduler';
import type { HealthEvent, LiveSnapshot, ScanEvent } from './types';
import { HyperliquidWs } from './ws';
import type { WsCandleEvent } from './ws';
import { WorkerPool } from './workerPool';

export interface EngineDeps {
  config: EngineConfig;
  log: EngineLogger;
  candleService: CandleService;
  marketsService: MarketsService;
  candleStore: CandleStore;
  alertStore: AlertStore;
  maSelectionStore: MaSelectionStore;
  /**
   * sink fan-out (Task 11 dispatcher.dispatch bound); receives formatted text only —
   * alert objects are persisted by AlertEngine, and Phase 4B consumes them from the store.
   */
  dispatch: (text: string) => Promise<string[]>;
  ws?: HyperliquidWs;       // injectable for tests
  pool?: WorkerPool;        // injectable for tests
  /** test seam: overrides the tick-path analyzer (default: makePlanAnalyzer over the per-coin×timeframe config resolver) */
  provisionalAnalyze?: AnalyzePlansFn;
  now?: () => number;
}

export function buildAnalysisConfig(cfg: EngineConfig): EngineAnalysisConfig {
  return {
    detector: { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: cfg.analysis.volumeSpikeK },
    backtest: { ...DEFAULT_BACKTEST_CONFIG, confluenceWindow: cfg.analysis.confluenceWindow, minRR: cfg.analysis.minRR },
    gate: cfg.analysis.gate,
    weights: cfg.analysis.weights,
    window: cfg.analysis.window,
  };
}

export class Engine {
  private cfg: EngineConfig;
  private log: EngineLogger;
  private now: () => number;
  private analysisConfig: EngineAnalysisConfig;

  private ws: HyperliquidWs;
  private pool: WorkerPool;
  private aggregator: CandleAggregator;
  private queue = new ScanQueue();
  private metrics = new LatencyTracker();
  private alertEngine: AlertEngine;
  private provisional: ProvisionalEvaluator;
  private backfill: BackfillOrchestrator;
  private maOverrides: Map<string, { fast: MaSpec; slow: MaSpec }>;
  private maOptimizer: MaOptimizer;

  private live = new Set<string>();          // coins seeded + subscribed
  private ranks = new Map<string, number>();
  private inFlight = 0;
  private scansCompleted = 0;
  private wasDown = false;
  private lastTickAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private prevProvisionalActive = new Set<string>();

  readonly events = new EventEmitter();
  private latestScans = new Map<string, ScanEvent>();

  constructor(private deps: EngineDeps) {
    this.cfg = deps.config;
    this.log = deps.log;
    this.now = deps.now ?? (() => Date.now());
    this.analysisConfig = buildAnalysisConfig(this.cfg);

    this.ws = deps.ws ?? new HyperliquidWs({
      log: this.log, silenceMs: this.cfg.wsSilenceMs, now: this.now,
    });
    this.pool = deps.pool ?? new WorkerPool({ size: this.cfg.workerCount, log: this.log });
    this.aggregator = new CandleAggregator({
      timeframes: this.cfg.timeframes, lookback: this.cfg.lookback, closeGraceMs: this.cfg.closeGraceMs, now: this.now,
    });
    this.alertEngine = new AlertEngine({
      store: deps.alertStore, log: this.log, dispatch: deps.dispatch,
      confirmedMinConfidence: this.cfg.confirmedMinConfidence,
      provisionalMinConfidence: this.cfg.provisionalMinConfidence,
      dedupeCooldownMs: this.cfg.dedupeCooldownMs,
      burstLimit: this.cfg.burstLimit, burstWindowMs: this.cfg.burstWindowMs, digestFlushMs: 5_000,
      webOrigin: this.cfg.webOrigin, now: this.now,
      onRecord: (row) => this.events.emit('alert', row),
    });
    this.provisional = new ProvisionalEvaluator({
      aggregator: this.aggregator,
      tickGate: new TickGate({ minMovePct: this.cfg.tickMinMovePct, minIntervalMs: this.cfg.tickMinIntervalMs, now: this.now }),
      timeframes: this.cfg.timeframes, minCandles: MIN_BACKTEST_CANDLES,
      metrics: this.metrics, log: this.log, now: this.now,
      analyze: deps.provisionalAnalyze ?? makePlanAnalyzer((coin, interval) => this.analysisConfigFor(coin, interval)),
      alert: async (coin, interval, plans) => {
        const t0 = this.now();
        await this.alertEngine.onProvisionalPlans(coin, interval, plans);
        this.metrics.record('tick-alert', this.now() - t0);
        this.syncProvisionalActive();
      },
    });
    this.backfill = new BackfillOrchestrator({
      candleService: deps.candleService, marketsService: deps.marketsService, log: this.log,
      timeframes: this.cfg.timeframes, lookback: this.cfg.lookback, universeCap: this.cfg.universeCap,
    });
    this.maOverrides = new Map(
      deps.maSelectionStore.all().map((r) => [`${r.coin}|${r.interval}`, { fast: r.fast, slow: r.slow }]),
    );
    this.maOptimizer = new MaOptimizer({
      pool: this.pool,
      store: deps.maSelectionStore,
      log: this.log,
      detector: this.analysisConfig.detector,
      backtest: this.analysisConfig.backtest,
      gates: {
        minTrainTrades: this.cfg.optimizer.minTrainTrades,
        minValidationTrades: this.cfg.optimizer.minValidationTrades,
        validationFraction: this.cfg.optimizer.validationFraction,
      },
      timeframes: this.cfg.timeframes,
      liveCoins: () => [...this.live],
      series: (coin, interval) => this.aggregator.series(coin, interval),
      scanBacklog: () => this.queue.size + this.inFlight,
      onSelection: (coin, interval, sel) => {
        const key = `${coin}|${interval}`;
        if (sel) this.maOverrides.set(key, sel); else this.maOverrides.delete(key);
      },
      now: this.now,
    });

    this.aggregator.on('close', (e: CloseEvent) => {
      this.deps.candleStore.upsert(e.coin, e.interval, [e.candle]);
      this.queue.push({ coin: e.coin, interval: e.interval });
      this.pumpScans();
    });
    this.backfill.on('coin-ready', (e: CoinReadyEvent) => {
      for (const [tf, candles] of e.series) this.aggregator.seed(e.coin, tf, candles);
      this.live.add(e.coin);
      this.ws.setCoins([...this.live]);
      for (const tf of this.cfg.timeframes) this.queue.push({ coin: e.coin, interval: tf });
      this.pumpScans();
    });
    this.ws.on('candle', (e: WsCandleEvent) => this.aggregator.onWsCandle(e.coin, e.candle));
    this.ws.on('mids', (mids: Record<string, number>) => {
      const t = this.now();
      this.lastTickAt = t;
      for (const [coin, mid] of Object.entries(mids)) {
        if (this.live.has(coin)) this.aggregator.onMid(coin, mid, t);
      }
      void this.provisional.onMids(Object.fromEntries(Object.entries(mids).filter(([c]) => this.live.has(c))));
    });
    this.ws.on('down', () => { this.wasDown = true; });
    this.ws.on('open', () => { if (this.wasDown) { this.wasDown = false; void this.gapFill(); } });
  }

  async start(): Promise<void> {
    const universe = await this.backfill.loadUniverse();
    this.ranks = universe.ranks;
    this.queue.setVolumeRanks(this.ranks);
    this.ws.start();
    void this.backfill.run(universe.coins); // per-coin readiness — deliberately not awaited
    this.timers.push(setInterval(() => this.aggregator.closeDue(), 1_000));
    this.timers.push(setInterval(() => this.log.info({ latencies: this.metrics.snapshot(), ...this.counts() }, 'engine metrics'), 5 * 60_000));
    this.timers.push(setInterval(() => { void this.hourlyRefresh(); }, 3_600_000));
    this.timers.push(setInterval(() => { void this.backfill.retryDegraded(); }, 5 * 60_000));
    this.timers.push(setInterval(() => {
      this.events.emit('health', { ...this.status(), ts: this.now() } satisfies HealthEvent);
    }, 2_000));
    for (const t of this.timers) t.unref?.();
    if (this.cfg.optimizer.enabled) this.maOptimizer.start();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.maOptimizer.stop();
    this.ws.stop();
    await this.alertEngine.stop();
    await this.pool.destroy();
  }

  /** Manual optimizer trigger (Task 7's route); works regardless of optimizer.enabled. */
  runMaOptimization(coins?: string[]): Promise<MaOptimizeSummary> {
    return this.maOptimizer.run(coins);
  }

  /** Public for tests; the hourly timer calls this with fresh market rows. */
  async refreshUniverse(markets?: MarketRow[]): Promise<void> {
    const rows = markets ?? (await this.deps.marketsService.getMarkets()).markets;
    const sorted = [...rows].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
    const capped = this.cfg.universeCap > 0 ? sorted.slice(0, this.cfg.universeCap) : sorted;
    const next = new Set(capped.map((m) => m.name));
    this.ranks = new Map([...next].map((c, i) => [c, i]));
    this.queue.setVolumeRanks(this.ranks);
    const added = [...next].filter((c) => !this.live.has(c) && !this.backfill.degradedCoins.includes(c));
    const removed = [...this.live].filter((c) => !next.has(c));
    for (const c of removed) this.live.delete(c);
    if (removed.length) this.ws.setCoins([...this.live]);
    if (added.length) void this.backfill.run(added);
    if (added.length || removed.length) this.log.info({ added, removed }, 'universe refreshed');
  }

  status(): HealthSnapshot {
    return {
      wsConnected: this.ws.connected,
      lastTickAgeMs: this.lastTickAt ? this.now() - this.lastTickAt : -1,
      queueDepth: this.queue.size,
      busyWorkers: this.inFlight,
      coinsTracked: this.live.size + this.backfill.degradedCoins.length,
      coinsLive: this.live.size,
      scansCompleted: this.scansCompleted,
      latencies: this.metrics.snapshot(),
    };
  }

  /** Live snapshot for a fresh dashboard connection; the route appends `alerts` from the AlertStore. */
  liveSnapshot(): Omit<LiveSnapshot, 'alerts'> {
    const scans = [...this.latestScans.values()]
      .sort((a, b) => (b.plan?.confidence ?? -1) - (a.plan?.confidence ?? -1));
    return { scans, health: { ...this.status(), ts: this.now() } };
  }

  get wsLastMessageAt(): number { return this.ws.lastMessageAt; }

  private counts(): Record<string, number> {
    return { queueDepth: this.queue.size, inFlight: this.inFlight, live: this.live.size, scansCompleted: this.scansCompleted };
  }

  private async hourlyRefresh(): Promise<void> {
    try { await this.refreshUniverse(); } catch (err) { this.log.warn({ err: (err as Error).message }, 'universe refresh failed'); }
  }

  private async gapFill(): Promise<void> {
    this.log.info({ coins: this.live.size }, 'ws reconnected — gap-filling');
    for (const coin of this.live) {
      for (const tf of this.cfg.timeframes) {
        try {
          const candles = await this.deps.candleService.getCandles(coin, tf, this.cfg.lookback, { force: true });
          this.aggregator.seed(coin, tf, candles);
        } catch (err) {
          this.log.warn({ coin, tf, err: (err as Error).message }, 'gap-fill failed');
        }
      }
      for (const tf of this.cfg.timeframes) this.queue.push({ coin, interval: tf });
    }
    this.pumpScans();
  }

  private syncProvisionalActive(): void {
    const active = this.alertEngine.provisionalActiveCoins();
    for (const c of active) if (!this.prevProvisionalActive.has(c)) this.queue.markProvisionalActive(c, true);
    for (const c of this.prevProvisionalActive) if (!active.has(c)) this.queue.markProvisionalActive(c, false);
    this.prevProvisionalActive = active;
  }

  /** analyzeCoin config with the stored MA selection injected, falling back to EMA50/SMA200 defaults. */
  private analysisConfigFor(coin: string, interval: Interval): EngineAnalysisConfig {
    const o = this.maOverrides.get(`${coin}|${interval}`);
    if (!o) return this.analysisConfig;
    return {
      ...this.analysisConfig,
      detector: { ...this.analysisConfig.detector, maFast: o.fast, maSlow: o.slow },
    };
  }

  private pumpScans(): void {
    while (this.inFlight < this.cfg.workerCount) {
      const job = this.queue.pop();
      if (!job) return;
      const candles = this.aggregator.series(job.coin, job.interval);
      if (candles.length < MIN_BACKTEST_CANDLES) continue;
      this.inFlight++;
      const started = this.now();
      void this.pool.run({ candles, config: this.analysisConfigFor(job.coin, job.interval) })
        .then(async (result) => {
          this.metrics.record('close-scan', this.now() - started);
          this.scansCompleted++;
          const best = result.plans.find((p) => p.status === 'active') ?? null;
          const scanEvent: ScanEvent = {
            coin: job.coin, interval: job.interval, ts: this.now(), candleCount: result.candleCount,
            plan: best && {
              direction: best.direction, setup: best.setup, entry: best.entry,
              stop: best.stop, target: best.target, rr: best.rr, confidence: best.confidence.score,
            },
          };
          this.latestScans.set(`${job.coin}|${job.interval}`, scanEvent);
          this.events.emit('scan', scanEvent);
          const qualified = qualifySetups(result.scanResults, this.cfg.analysis.gate);
          this.provisional.setQualified(job.coin, job.interval, qualified);
          await this.alertEngine.onCloseScan(job.coin, job.interval, result.plans);
          this.syncProvisionalActive();
        })
        .catch((err) => this.log.error({ ...job, err: (err as Error).message }, 'scan job failed'))
        .finally(() => { this.inFlight--; this.pumpScans(); });
    }
  }
}
