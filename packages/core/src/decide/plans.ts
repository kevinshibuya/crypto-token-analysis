import type { Candle, Signal, SignalDirection, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';
import type { SetupMetrics } from '../backtest/metrics';
import type { SetupResult } from '../backtest/scan';
import { pairEntries } from '../backtest/scan';
import { computeBracket } from '../backtest/bracket';
import { scoreConfidence } from './confidence';
import type { DecideConfig, TradePlan } from './types';

interface Draft {
  setup: SignalKind[]; direction: SignalDirection; signalT: number; ageCandles: number;
  stop: number; target: number; rr: number; status: 'active' | 'expired'; metrics: SetupMetrics;
}

export function buildTradePlans(
  candles: Candle[],
  ctx: DetectorContext,
  signals: Signal[],
  qualified: SetupResult[],
  cfg: DecideConfig,
): TradePlan[] {
  if (!candles.length) return [];
  const last = candles.length - 1;
  const atrVal = ctx.atr[last];
  if (!Number.isFinite(atrVal) || atrVal <= 0) return [];
  const entry = candles[last].c;
  const pivotPrices = ctx.pivotPricesAt(last);

  const drafts: Draft[] = [];
  for (const q of qualified) {
    const entries = (q.kinds.length === 1
      ? signals.filter((s) => s.kind === q.kinds[0])
      : pairEntries(signals, q.kinds[0], q.kinds[1], cfg.confluenceWindow)
    ).sort((a, b) => a.index - b.index);
    const recent = entries.filter((s) => last - s.index < cfg.window).pop();
    if (!recent) continue;
    // minRR 0 so the bracket always computes; expiry is decided here, not inside computeBracket
    const bracket = computeBracket(entry, recent.direction, pivotPrices, atrVal, { ...cfg, minRR: 0 });
    if (!bracket) continue;
    drafts.push({
      setup: q.kinds, direction: recent.direction, signalT: recent.t, ageCandles: last - recent.index,
      stop: bracket.stop, target: bracket.target, rr: bracket.rr,
      status: bracket.rr >= cfg.minRR ? 'active' : 'expired', metrics: q.metrics,
    });
  }

  // second pass: confluence needs to know which other setups ended up active
  const plans: TradePlan[] = drafts.map((d) => {
    const agreeing = drafts.filter((o) => o !== d && o.status === 'active' && o.direction === d.direction).length;
    return { ...d, entry, confidence: scoreConfidence(d.metrics.expectancy, d.metrics.trades, agreeing, d.rr, cfg.weights) };
  });
  plans.sort((a, b) =>
    b.confidence.score - a.confidence.score || a.setup.join('+').localeCompare(b.setup.join('+')));
  return plans;
}
