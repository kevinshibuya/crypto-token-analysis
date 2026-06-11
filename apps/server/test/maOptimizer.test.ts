import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, MaOptimizationResult, SetupMetrics } from '@cta/core';
import { MaOptimizer, nextRunDelayMs, MIN_OPTIMIZE_CANDLES } from '../src/engine/maOptimizer';
import type { MaSelectionRow } from '../src/cache/maSelectionStore';
import { nullLogger } from '../src/engine/logger';
import { DEFAULT_DETECTOR_OPTIONS, DEFAULT_BACKTEST_CONFIG } from '@cta/core';

const metrics = (expectancy: number, trades: number): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: expectancy, profitFactor: 1, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: trades, shortTrades: 0,
});

const challengerResult: MaOptimizationResult = {
  decision: 'challenger',
  selection: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } },
  best: {
    combo: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } },
    kinds: ['ma-golden-cross'], train: metrics(0.5, 30), validation: metrics(0.4, 10),
  },
  baseline: { kinds: ['ma-golden-cross'], train: metrics(0.2, 25), validation: metrics(0.1, 9) },
  splitIndex: 1400, candleCount: 2000,
};

const baselineResult: MaOptimizationResult = {
  ...challengerResult, decision: 'baseline', selection: null,
};

const series: Candle[] = Array.from({ length: MIN_OPTIMIZE_CANDLES }, (_, i) =>
  ({ t: i * 900_000, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 }));

function makeDeps(results: MaOptimizationResult[] | Error[]) {
  const jobs: unknown[] = [];
  let i = 0;
  const upserts: MaSelectionRow[] = [];
  const removals: string[] = [];
  const selections: { coin: string; interval: string; sel: unknown }[] = [];
  return {
    jobs, upserts, removals, selections,
    deps: {
      pool: {
        run: async (job: unknown) => {
          jobs.push(job);
          const r = results[Math.min(i++, results.length - 1)];
          if (r instanceof Error) throw r;
          return r;
        },
      },
      store: {
        upsert: (row: MaSelectionRow) => { upserts.push(row); },
        remove: (coin: string, interval: string) => { removals.push(`${coin}|${interval}`); return true; },
        get: () => null, all: () => [],
      },
      log: nullLogger(),
      detector: DEFAULT_DETECTOR_OPTIONS,
      backtest: DEFAULT_BACKTEST_CONFIG,
      gates: { minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 },
      timeframes: ['15m', '1h'] as const,
      liveCoins: () => ['BTC'],
      series: () => series,
      scanBacklog: () => 0,
      onSelection: (coin: string, interval: string, sel: unknown) => { selections.push({ coin, interval, sel }); },
      sleepMs: async () => {},
    },
  };
}

describe('nextRunDelayMs', () => {
  it('targets the next 00:10 UTC', () => {
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 23, 0, 0))).toBe(70 * 60_000);
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 0, 5, 0))).toBe(5 * 60_000);
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 0, 10, 0))).toBe(86_400_000); // exactly 00:10 → tomorrow
  });
});

describe('MaOptimizer.run', () => {
  it('upserts and notifies on challenger, removes and notifies null on baseline', async () => {
    const { deps, upserts, removals, selections } = makeDeps([challengerResult, baselineResult]);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(summary.evaluated).toBe(2);
    expect(summary.selected).toBe(1);
    expect(summary.reverted).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      coin: 'BTC', interval: '15m',
      fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 },
      setupKinds: ['ma-golden-cross'],
    });
    expect(removals).toEqual(['BTC|1h']);
    expect(selections).toEqual([
      { coin: 'BTC', interval: '15m', sel: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } } },
      { coin: 'BTC', interval: '1h', sel: null },
    ]);
  });

  it('skips thin series without running a job', async () => {
    const { deps, jobs } = makeDeps([challengerResult]);
    deps.series = () => series.slice(0, 10);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(jobs).toHaveLength(0);
    expect(summary.skipped).toBe(2);
  });

  it('a failing job is logged and counted, and the sweep continues', async () => {
    const { deps, upserts } = makeDeps([new Error('boom'), challengerResult] as never);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(summary.failed).toBe(1);
    expect(summary.evaluated).toBe(1);
    expect(upserts).toHaveLength(1); // second coin×tf still processed
  });

  it('explicit coins argument overrides liveCoins', async () => {
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    await opt.run(['ETH', 'SOL']);
    expect(jobs).toHaveLength(4); // 2 coins × 2 timeframes
  });

  it('yields to a busy scan queue before each job', async () => {
    const { deps, jobs } = makeDeps([baselineResult]);
    const backlog = [3, 2, 0, 0, 0, 0, 0, 0];
    let calls = 0;
    deps.scanBacklog = () => backlog[Math.min(calls++, backlog.length - 1)];
    const sleeps: number[] = [];
    deps.sleepMs = async (ms: number) => { sleeps.push(ms); };
    const opt = new MaOptimizer(deps as never);
    await opt.run(['BTC']);
    expect(sleeps.length).toBeGreaterThanOrEqual(2); // waited while backlog > 0
    expect(jobs).toHaveLength(2);
  });
});

describe('MaOptimizer schedule', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('start() schedules a run at the next 00:10 UTC and reschedules after it completes', async () => {
    vi.setSystemTime(Date.UTC(2026, 5, 11, 23, 0, 0));
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    opt.start();
    expect(jobs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(70 * 60_000 + 5);
    expect(jobs).toHaveLength(2); // 1 coin × 2 tfs ran
    opt.stop();
  });

  it('stop() cancels the pending schedule', async () => {
    vi.setSystemTime(Date.UTC(2026, 5, 11, 23, 0, 0));
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    opt.start();
    opt.stop();
    await vi.advanceTimersByTimeAsync(2 * 86_400_000);
    expect(jobs).toHaveLength(0);
  });
});
