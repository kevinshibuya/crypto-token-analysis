import type { Candle, MaType, Signal, SignalKind } from '../types';
import type { DetectorOptions, MaSpec, DetectorContext } from '../detectorContext';
import { buildDetectorContext, buildBaseDetectorContext, withMa } from '../detectorContext';
import { detectAll, SIGNAL_KINDS, signalFamily } from '../detectors';
import { simulate } from '../backtest/simulate';
import { computeMetrics, type SetupMetrics } from '../backtest/metrics';
import { pairEntries, type BacktestConfig } from '../backtest/scan';

export interface MaGridGates {
  minTrainTrades: number;      // challenger needs ≥ this many train trades
  minValidationTrades: number; // and ≥ this many validation trades
  validationFraction: number;  // newest fraction of candles held out (walk-forward)
}

export const DEFAULT_MA_GRID_GATES: MaGridGates = {
  minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3,
};

export const MA_FAST_PERIODS = [9, 12, 21, 34, 50] as const;
export const MA_SLOW_PERIODS = [50, 100, 150, 200] as const;
const MA_TYPES: MaType[] = ['SMA', 'EMA'];

export interface MaCombo { fast: MaSpec; slow: MaSpec }

/** fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200}, fast period < slow period → 76 combos. */
export function buildMaGrid(): MaCombo[] {
  const out: MaCombo[] = [];
  for (const ft of MA_TYPES) {
    for (const fp of MA_FAST_PERIODS) {
      for (const st of MA_TYPES) {
        for (const sp of MA_SLOW_PERIODS) {
          if (fp >= sp) continue;
          out.push({ fast: { type: ft, period: fp }, slow: { type: st, period: sp } });
        }
      }
    }
  }
  return out;
}

export interface SplitEvaluation {
  kinds: SignalKind[];
  train: SetupMetrics;
  validation: SetupMetrics;
}

export interface MaOptimizationResult {
  decision: 'challenger' | 'baseline';
  selection: MaCombo | null;                            // set iff decision === 'challenger'
  best: (SplitEvaluation & { combo: MaCombo }) | null;  // best challenger even when rejected (audit)
  baseline: SplitEvaluation | null;                     // null if defaults produce no MA setups at all
  splitIndex: number;
  candleCount: number;
}

export interface MaGridInput {
  detector: DetectorOptions; // baseline detector opts; maFast/maSlow here ARE the baseline
  backtest: BacktestConfig;
  gates?: MaGridGates;
}

export function decideChallenger(
  best: SplitEvaluation | null, baseline: SplitEvaluation | null, gates: MaGridGates,
): boolean {
  if (!best) return false;
  if (best.train.trades < gates.minTrainTrades) return false;
  if (best.validation.trades < gates.minValidationTrades) return false;
  const baseExp = baseline ? baseline.validation.expectancy : 0;
  return best.validation.expectancy > baseExp;
}

const better = (a: SplitEvaluation, b: SplitEvaluation): boolean =>
  a.train.expectancy > b.train.expectancy
  || (a.train.expectancy === b.train.expectancy && a.train.trades > b.train.trades);

/**
 * Best MA-involved setup (singles of MA kinds + pairs containing an MA kind) under one MA combo,
 * picked by train expectancy. Setups meeting minTrainTrades are always preferred over those that
 * don't (a 2-trade fluke must not shadow a solid 25-trade setup). Entries are split train/validation
 * by signal index; simulation runs on the full array (boundary trades may exit in the holdout —
 * accepted, see plan conventions).
 */
function evaluateMaSetupsWithCtx(
  candles: Candle[], ctx: DetectorContext, backtest: BacktestConfig,
  splitIndex: number, minTrainTrades: number,
): SplitEvaluation | null {
  const signals = detectAll(candles, ctx);
  const present = SIGNAL_KINDS.filter((k) => signals.some((s) => s.kind === k));
  const isMa = (k: SignalKind): boolean => signalFamily(k) === 'ma';
  const setups: SignalKind[][] = present.filter(isMa).map((k) => [k]);
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (isMa(present[i]) || isMa(present[j])) setups.push([present[i], present[j]].sort());
    }
  }
  let best: SplitEvaluation | null = null;
  let bestQualified = false;
  for (const kinds of setups) {
    const entries = kinds.length === 1
      ? signals.filter((s) => s.kind === kinds[0])
      : pairEntries(signals, kinds[0], kinds[1], backtest.confluenceWindow);
    const setupSignals = signals.filter((s) => kinds.includes(s.kind));
    const run = (es: Signal[]): SetupMetrics => {
      const sim = simulate(candles, es, setupSignals, ctx.pivotPricesAt, ctx.atr, backtest);
      return computeMetrics(sim.trades, sim.filtered);
    };
    const ev: SplitEvaluation = {
      kinds,
      train: run(entries.filter((e) => e.index < splitIndex)),
      validation: run(entries.filter((e) => e.index >= splitIndex)),
    };
    const qualified = ev.train.trades >= minTrainTrades;
    if (!best || (qualified && !bestQualified) || (qualified === bestQualified && better(ev, best))) {
      best = ev;
      bestQualified = qualified;
    }
  }
  return best;
}

export function evaluateMaSetups(
  candles: Candle[], detector: DetectorOptions, backtest: BacktestConfig,
  combo: MaCombo, splitIndex: number, minTrainTrades: number,
): SplitEvaluation | null {
  const opts: DetectorOptions = { ...detector, maFast: combo.fast, maSlow: combo.slow };
  const ctx = buildDetectorContext(candles, opts);
  return evaluateMaSetupsWithCtx(candles, ctx, backtest, splitIndex, minTrainTrades);
}

export function optimizeMaForSeries(candles: Candle[], input: MaGridInput): MaOptimizationResult {
  const gates = input.gates ?? DEFAULT_MA_GRID_GATES;
  const splitIndex = Math.floor(candles.length * (1 - gates.validationFraction));
  const baseCombo: MaCombo = { fast: input.detector.maFast, slow: input.detector.maSlow };

  const base = buildBaseDetectorContext(candles, input.detector);
  const ctxFor = (combo: MaCombo): DetectorContext =>
    withMa(base, candles, { ...input.detector, maFast: combo.fast, maSlow: combo.slow });

  const baseline = evaluateMaSetupsWithCtx(
    candles, ctxFor(baseCombo), input.backtest, splitIndex, gates.minTrainTrades,
  );

  let best: (SplitEvaluation & { combo: MaCombo }) | null = null;
  let bestQualified = false;
  for (const combo of buildMaGrid()) {
    if (combo.fast.type === baseCombo.fast.type && combo.fast.period === baseCombo.fast.period
      && combo.slow.type === baseCombo.slow.type && combo.slow.period === baseCombo.slow.period) continue;
    const ev = evaluateMaSetupsWithCtx(candles, ctxFor(combo), input.backtest, splitIndex, gates.minTrainTrades);
    if (!ev) continue;
    const qualified = ev.train.trades >= gates.minTrainTrades;
    if (!best || (qualified && !bestQualified) || (qualified === bestQualified && better(ev, best))) {
      best = { ...ev, combo };
      bestQualified = qualified;
    }
  }

  const wins = decideChallenger(best, baseline, gates);
  return {
    decision: wins ? 'challenger' : 'baseline',
    selection: wins && best ? best.combo : null,
    best,
    baseline,
    splitIndex,
    candleCount: candles.length,
  };
}
