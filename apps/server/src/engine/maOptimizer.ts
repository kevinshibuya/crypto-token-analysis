import type {
  BacktestConfig, Candle, DetectorOptions, Interval, MaGridGates, MaOptimizationResult, MaSpec,
} from '@cta/core';
import type { MaSelectionStore } from '../cache/maSelectionStore';
import type { EngineLogger } from './logger';
import type { OptimizeMaPoolJob } from './workerPool';

export const OPTIMIZE_RUN_UTC = { hour: 0, minute: 10 } as const;
/** slow MA needs 200 candles of warmup and the holdout needs room for ≥8 trades */
export const MIN_OPTIMIZE_CANDLES = 600;
const YIELD_POLL_MS = 250;
const YIELD_MAX_WAIT_MS = 120_000;
const DAY_MS = 86_400_000;

/** ms from `now` to the next 00:10:00.000 UTC, strictly in the future. */
export function nextRunDelayMs(now: number): number {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), OPTIMIZE_RUN_UTC.hour, OPTIMIZE_RUN_UTC.minute, 0, 0);
  return today > now ? today - now : today + DAY_MS - now;
}

export interface MaDecision {
  coin: string;
  interval: Interval;
  decision: 'challenger' | 'baseline' | 'skipped' | 'failed';
  fast?: MaSpec;
  slow?: MaSpec;
}

export interface MaOptimizeSummary {
  startedAt: number;
  finishedAt: number;
  evaluated: number;
  selected: number;
  reverted: number;
  skipped: number;
  failed: number;
  decisions: MaDecision[];
}

export interface MaOptimizerDeps {
  pool: { run(job: OptimizeMaPoolJob): Promise<MaOptimizationResult> };
  store: Pick<MaSelectionStore, 'upsert' | 'remove'>;
  log: EngineLogger;
  detector: DetectorOptions;   // baseline detector opts (maFast/maSlow = engine defaults)
  backtest: BacktestConfig;
  gates: MaGridGates;
  timeframes: readonly Interval[];
  liveCoins: () => string[];
  series: (coin: string, interval: Interval) => Candle[];
  /** scan-queue depth + in-flight scans; the optimizer waits until this is 0 before each job */
  scanBacklog: () => number;
  onSelection: (coin: string, interval: Interval, sel: { fast: MaSpec; slow: MaSpec } | null) => void;
  now?: () => number;
  sleepMs?: (ms: number) => Promise<void>; // test seam
}

export class MaOptimizer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private deps: MaOptimizerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleepMs ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  }

  start(): void {
    this.stopped = false;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private schedule(): void {
    const delay = nextRunDelayMs(this.now());
    this.timer = setTimeout(() => {
      void this.run().finally(() => { if (!this.stopped) this.schedule(); });
    }, delay);
    this.timer.unref?.();
    this.deps.log.info({ delayMs: delay }, 'ma-optimizer scheduled');
  }

  /** Serial sweep — at most one worker is ever occupied by optimization. */
  async run(coins?: string[]): Promise<MaOptimizeSummary> {
    const summary: MaOptimizeSummary = {
      startedAt: this.now(), finishedAt: 0,
      evaluated: 0, selected: 0, reverted: 0, skipped: 0, failed: 0, decisions: [],
    };
    if (this.running) { summary.finishedAt = this.now(); return summary; } // one run at a time
    this.running = true;
    try {
      const targets = coins ?? this.deps.liveCoins();
      for (const coin of targets) {
        for (const interval of this.deps.timeframes) {
          if (this.stopped && !coins) break; // nightly run aborts on stop; manual runs finish
          await this.yieldToScans();
          const candles = this.deps.series(coin, interval);
          if (candles.length < MIN_OPTIMIZE_CANDLES) {
            summary.skipped++;
            summary.decisions.push({ coin, interval, decision: 'skipped' });
            continue;
          }
          try {
            const result = await this.deps.pool.run({
              kind: 'optimize-ma', candles,
              detector: this.deps.detector, backtest: this.deps.backtest, gates: this.deps.gates,
            });
            summary.evaluated++;
            if (result.decision === 'challenger' && result.selection && result.best) {
              this.deps.store.upsert({
                coin, interval,
                fast: result.selection.fast, slow: result.selection.slow,
                setupKinds: result.best.kinds,
                train: result.best.train, validation: result.best.validation,
                baselineSetupKinds: result.baseline?.kinds ?? null,
                baselineTrain: result.baseline?.train ?? null,
                baselineValidation: result.baseline?.validation ?? null,
                candleCount: result.candleCount, splitIndex: result.splitIndex,
                selectedAt: this.now(),
              });
              this.deps.onSelection(coin, interval, { fast: result.selection.fast, slow: result.selection.slow });
              summary.selected++;
              summary.decisions.push({ coin, interval, decision: 'challenger', fast: result.selection.fast, slow: result.selection.slow });
              this.deps.log.info({
                coin, interval, fast: result.selection.fast, slow: result.selection.slow,
                valExpectancy: result.best.validation.expectancy,
                baselineValExpectancy: result.baseline?.validation.expectancy ?? 0,
              }, 'ma-optimizer: challenger selected');
            } else {
              if (this.deps.store.remove(coin, interval)) summary.reverted++;
              this.deps.onSelection(coin, interval, null);
              summary.decisions.push({ coin, interval, decision: 'baseline' });
            }
          } catch (err) {
            summary.failed++;
            summary.decisions.push({ coin, interval, decision: 'failed' });
            this.deps.log.warn({ coin, interval, err: (err as Error).message }, 'ma-optimizer job failed — baseline retained');
          }
        }
      }
    } finally {
      this.running = false;
    }
    summary.finishedAt = this.now();
    this.deps.log.info({
      evaluated: summary.evaluated, selected: summary.selected, reverted: summary.reverted,
      skipped: summary.skipped, failed: summary.failed, ms: summary.finishedAt - summary.startedAt,
    }, 'ma-optimizer run complete');
    return summary;
  }

  private async yieldToScans(): Promise<void> {
    const t0 = this.now();
    while (!this.stopped && this.deps.scanBacklog() > 0 && this.now() - t0 < YIELD_MAX_WAIT_MS) {
      await this.sleep(YIELD_POLL_MS);
    }
  }
}
