import { afterEach, describe, expect, it } from 'vitest';
import { defaultEngineAnalysisConfig, DEFAULT_DETECTOR_OPTIONS, DEFAULT_BACKTEST_CONFIG } from '@cta/core';
import type { Candle } from '@cta/core';
import { WorkerPool } from '../src/engine/workerPool';
import { nullLogger } from '../src/engine/logger';

// deterministic trending series long enough for the pipeline to not throw
const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
  const o = 100 + i + Math.sin(i / 5) * 3;
  const c = 100 + i + 1 + Math.sin((i + 1) / 5) * 3;
  return { t: i * 900_000, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 10 + (i % 7), n: 5 };
});

describe('WorkerPool', () => {
  let pool: WorkerPool;
  afterEach(async () => { await pool?.destroy(); });

  it('runs analyzeCoin in a worker and resolves the result', async () => {
    pool = new WorkerPool({ size: 2, log: nullLogger() });
    const out = await pool.run({ candles, config: defaultEngineAnalysisConfig() });
    expect(out.candleCount).toBe(300);
    expect(out.lastCandleT).toBe(candles[299].t);
  }, 30_000);

  it('runs jobs in parallel across workers', async () => {
    pool = new WorkerPool({ size: 2, log: nullLogger() });
    const outs = await Promise.all([
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
    ]);
    expect(outs).toHaveLength(3);
    for (const o of outs) expect(o.candleCount).toBe(300);
  }, 30_000);

  it('respawns a crashed worker, retries the job once, and keeps serving', async () => {
    pool = new WorkerPool({ size: 1, log: nullLogger() });
    // poisoned job crashes the worker; the retry re-poisons (same payload) → rejects after the single retry
    await expect(pool.run({ candles, config: defaultEngineAnalysisConfig(), poison: true }))
      .rejects.toThrow(/worker|poisoned/i);
    // the pool must have respawned: a normal job still completes
    const out = await pool.run({ candles, config: defaultEngineAnalysisConfig() });
    expect(out.candleCount).toBe(300);
  }, 30_000);

  it('runs an optimize-ma job in a worker and returns a MaOptimizationResult', async () => {
    const pool = new WorkerPool({ size: 1, log: nullLogger() });
    try {
      const candles = Array.from({ length: 300 }, (_, i) => {
        const c = 100 + Math.sin(i / 25) * 10 + (i % 7) * 0.3;
        return { t: i * 900_000, o: c - 0.2, h: c + 0.6, l: c - 0.6, c, v: 50 + (i % 11) * 10, n: 5 };
      });
      const result = await pool.run({
        kind: 'optimize-ma',
        candles,
        detector: DEFAULT_DETECTOR_OPTIONS,
        backtest: DEFAULT_BACKTEST_CONFIG,
        gates: { minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.3 },
      });
      expect(['challenger', 'baseline']).toContain(result.decision);
      expect(result.candleCount).toBe(300);
      expect(result.splitIndex).toBe(210);
    } finally {
      await pool.destroy();
    }
  }, 30_000);

  it('rejects in-flight and queued jobs on destroy instead of leaving them hanging', async () => {
    pool = new WorkerPool({ size: 1, log: nullLogger() });
    // attach rejection expectations before destroy so the rejections are handled synchronously
    const inflight = expect(pool.run({ candles, config: defaultEngineAnalysisConfig() }))
      .rejects.toThrow('pool destroyed');
    const queued = expect(pool.run({ candles, config: defaultEngineAnalysisConfig() }))
      .rejects.toThrow('pool destroyed');
    await pool.destroy();
    await inflight;
    await queued;
  }, 30_000);
});
