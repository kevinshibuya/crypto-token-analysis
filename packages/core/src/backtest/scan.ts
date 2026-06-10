import type { Candle, Signal, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';
import { detectAll, SIGNAL_KINDS } from '../detectors';
import { simulate, type SimConfig } from './simulate';
import { computeMetrics, type SetupMetrics } from './metrics';

export interface BacktestConfig extends SimConfig {
  confluenceWindow: number; // max candles between the two signals of a pair
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  confluenceWindow: 3, minRR: 1.5, atrFloorMult: 1, atrCapMult: 3, breakevenAtR: 1,
};

export interface SetupResult { kinds: SignalKind[]; metrics: SetupMetrics }

export interface ScanResult {
  results: SetupResult[];
  candleCount: number;
  lastCandleT: number;
}

/** Confluence pairing. Precondition: k1 !== k2 (same-kind input degenerates to all signals of that kind). */
export function pairEntries(signals: Signal[], k1: SignalKind, k2: SignalKind, window: number): Signal[] {
  const a = signals.filter((s) => s.kind === k1);
  const b = signals.filter((s) => s.kind === k2);
  const byKey = new Map<string, Signal>();
  for (const s1 of a) {
    for (const s2 of b) {
      if (s1.direction !== s2.direction) continue;
      if (Math.abs(s1.index - s2.index) > window) continue;
      const later = s1.index >= s2.index ? s1 : s2;
      byKey.set(`${later.index}:${later.direction}`, later);
    }
  }
  return [...byKey.values()].sort((x, y) => x.index - y.index);
}

function setupFromSignals(
  candles: Candle[], signals: Signal[], ctx: DetectorContext, cfg: BacktestConfig, kinds: SignalKind[],
): SetupResult {
  const sortedKinds = [...kinds].sort();
  const entries = sortedKinds.length === 1
    ? signals.filter((s) => s.kind === sortedKinds[0])
    : pairEntries(signals, sortedKinds[0], sortedKinds[1], cfg.confluenceWindow);
  const setupSignals = signals.filter((s) => sortedKinds.includes(s.kind));
  const sim = simulate(candles, entries, setupSignals, ctx.pivotPricesAt, ctx.atr, cfg);
  return { kinds: sortedKinds, metrics: computeMetrics(sim.trades, sim.filtered) };
}

const byRank = (a: SetupResult, b: SetupResult): number =>
  b.metrics.expectancy - a.metrics.expectancy
  || b.metrics.trades - a.metrics.trades
  || a.kinds.join('+').localeCompare(b.kinds.join('+'));

export function runSetup(
  candles: Candle[], ctx: DetectorContext, cfg: BacktestConfig, kinds: SignalKind[],
): SetupResult {
  return setupFromSignals(candles, detectAll(candles, ctx), ctx, cfg, kinds);
}

export function runScan(candles: Candle[], ctx: DetectorContext, cfg: BacktestConfig = DEFAULT_BACKTEST_CONFIG): ScanResult {
  const signals = detectAll(candles, ctx);
  const present = SIGNAL_KINDS.filter((k) => signals.some((s) => s.kind === k));
  const results: SetupResult[] = [];
  for (const k of present) results.push(setupFromSignals(candles, signals, ctx, cfg, [k]));
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const r = setupFromSignals(candles, signals, ctx, cfg, [present[i], present[j]]);
      if (r.metrics.trades + r.metrics.filtered > 0) results.push(r);
    }
  }
  results.sort(byRank);
  return {
    results,
    candleCount: candles.length,
    lastCandleT: candles.length ? candles[candles.length - 1].t : 0,
  };
}
