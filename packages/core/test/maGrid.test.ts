import { describe, expect, it } from 'vitest';
import {
  buildMaGrid, decideChallenger, optimizeMaForSeries, evaluateMaSetups, DEFAULT_MA_GRID_GATES,
} from '../src/index';
import type { Candle, SplitEvaluation } from '../src/index';
import { signalFamily } from '../src/detectors';
import { DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';

const metrics = (over: Partial<SetupMetrics>): SetupMetrics => ({
  trades: 0, wins: 0, winRate: 0, avgR: 0, profitFactor: 0, expectancy: 0,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0, ...over,
});
const evaln = (train: Partial<SetupMetrics>, validation: Partial<SetupMetrics>): SplitEvaluation => ({
  kinds: ['ma-golden-cross'], train: metrics(train), validation: metrics(validation),
});

// deterministic PRNG so the synthetic series is identical across runs
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticCandles(n: number): Candle[] {
  const rnd = mulberry32(42);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    // regime waves force MA crosses at several scales; noise adds patterns/volume spikes
    const drift = Math.sin(i / 60) * 0.6 + Math.sin(i / 17) * 0.25;
    const noise = (rnd() - 0.5) * 1.2;
    const o = price;
    const c = Math.max(1, price + drift + noise);
    const h = Math.max(o, c) + rnd() * 0.5;
    const l = Math.min(o, c) - rnd() * 0.5;
    const v = 100 + rnd() * 100 + (rnd() > 0.95 ? 400 : 0);
    out.push({ t: i * 900_000, o, h, l, c, v, n: 10 });
    price = c;
  }
  return out;
}

describe('buildMaGrid', () => {
  it('builds 76 combos, all with fast period < slow period', () => {
    const grid = buildMaGrid();
    expect(grid).toHaveLength(76);
    for (const g of grid) expect(g.fast.period).toBeLessThan(g.slow.period);
    // both type axes present
    expect(grid.some((g) => g.fast.type === 'SMA' && g.slow.type === 'EMA')).toBe(true);
    expect(grid.some((g) => g.fast.type === 'EMA' && g.slow.type === 'SMA')).toBe(true);
  });
});

describe('decideChallenger', () => {
  const gates = DEFAULT_MA_GRID_GATES; // { minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 }
  it('accepts when all gates pass and validation expectancy beats baseline', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 10, expectancy: 0.4 });
    const base = evaln({ trades: 30, expectancy: 0.3 }, { trades: 12, expectancy: 0.2 });
    expect(decideChallenger(best, base, gates)).toBe(true);
  });
  it('rejects when validation expectancy does not beat baseline', () => {
    const best = evaln({ trades: 25, expectancy: 0.9 }, { trades: 10, expectancy: 0.1 });
    const base = evaln({ trades: 30, expectancy: 0.3 }, { trades: 12, expectancy: 0.2 });
    expect(decideChallenger(best, base, gates)).toBe(false);
  });
  it('rejects on too few train trades', () => {
    const best = evaln({ trades: 19, expectancy: 0.5 }, { trades: 10, expectancy: 0.4 });
    expect(decideChallenger(best, null, gates)).toBe(false);
  });
  it('rejects on too few validation trades', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 7, expectancy: 0.4 });
    expect(decideChallenger(best, null, gates)).toBe(false);
  });
  it('treats a null baseline as zero validation expectancy', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 10, expectancy: 0.01 });
    expect(decideChallenger(best, null, gates)).toBe(true);
    expect(decideChallenger(null, null, gates)).toBe(false);
  });
});

describe('optimizeMaForSeries', () => {
  const input = { detector: DEFAULT_DETECTOR_OPTIONS, backtest: DEFAULT_BACKTEST_CONFIG };

  it('produces a structurally complete, deterministic result on a synthetic series', () => {
    const candles = syntheticCandles(1200);
    const r1 = optimizeMaForSeries(candles, input);
    const r2 = optimizeMaForSeries(candles, input);
    expect(r2).toEqual(r1); // pure
    expect(r1.candleCount).toBe(1200);
    expect(r1.splitIndex).toBe(Math.floor(1200 * 0.7));
    expect(['challenger', 'baseline']).toContain(r1.decision);
    if (r1.decision === 'challenger') {
      expect(r1.selection).toEqual(r1.best!.combo);
      expect(r1.best!.train.trades).toBeGreaterThanOrEqual(DEFAULT_MA_GRID_GATES.minTrainTrades);
      expect(r1.best!.validation.trades).toBeGreaterThanOrEqual(DEFAULT_MA_GRID_GATES.minValidationTrades);
    } else {
      expect(r1.selection).toBeNull();
    }
    // every evaluated setup is MA-involved
    if (r1.best) expect(r1.best.kinds.some((k) => signalFamily(k) === 'ma')).toBe(true);
    if (r1.baseline) expect(r1.baseline.kinds.some((k) => signalFamily(k) === 'ma')).toBe(true);
  });

  it('returns baseline decision with null best on a series too flat for MA signals', () => {
    const flat: Candle[] = Array.from({ length: 300 }, (_, i) =>
      ({ t: i * 900_000, o: 100, h: 100, l: 100, c: 100, v: 1, n: 1 }));
    const r = optimizeMaForSeries(flat, input);
    expect(r.decision).toBe('baseline');
    expect(r.selection).toBeNull();
  });

  it('baseline from the shared-base optimizer matches an independent evaluateMaSetups', () => {
    const candles = syntheticCandles(1200);
    const gates = DEFAULT_MA_GRID_GATES;
    const splitIndex = Math.floor(candles.length * (1 - gates.validationFraction));
    const baseCombo = { fast: input.detector.maFast, slow: input.detector.maSlow };
    const direct = evaluateMaSetups(
      candles, input.detector, input.backtest, baseCombo, splitIndex, gates.minTrainTrades,
    );
    expect(optimizeMaForSeries(candles, input).baseline).toEqual(direct);
  });

  it('honors a custom validationFraction', () => {
    const candles = syntheticCandles(1000);
    const r = optimizeMaForSeries(candles, { ...input, gates: { minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.5 } });
    expect(r.splitIndex).toBe(500);
  });
});
