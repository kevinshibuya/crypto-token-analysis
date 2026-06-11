import {
  buildDetectorContext, buildTradePlans, detectAll,
} from '@cta/core';
import type {
  Candle, EngineAnalysisConfig, Interval, SetupResult, TradePlan,
} from '@cta/core';
import type { CandleAggregator } from './aggregator';
import type { LatencyTracker } from './metrics';
import type { TickGate } from './scheduler';
import type { EngineLogger } from './logger';

export type AnalyzePlansFn = (candles: Candle[], qualified: SetupResult[]) => TradePlan[];

/** Default tick-path analysis: detector context + detection + plans against cached qualified setups (no backtest re-run). */
export function makePlanAnalyzer(cfg: EngineAnalysisConfig): AnalyzePlansFn {
  return (candles, qualified) => {
    const ctx = buildDetectorContext(candles, cfg.detector);
    const signals = detectAll(candles, ctx);
    return buildTradePlans(candles, ctx, signals, qualified, { ...cfg.backtest, window: cfg.window, weights: cfg.weights });
  };
}

export interface ProvisionalEvaluatorOptions {
  aggregator: CandleAggregator;
  tickGate: TickGate;
  timeframes: Interval[];
  minCandles: number; // MIN_BACKTEST_CANDLES
  metrics: LatencyTracker;
  log: EngineLogger;
  alert: (coin: string, interval: Interval, plans: TradePlan[]) => Promise<void>;
  analyze: AnalyzePlansFn;
  now?: () => number;
}

export class ProvisionalEvaluator {
  private qualified = new Map<string, SetupResult[]>(); // `${coin}|${interval}`
  private now: () => number;
  constructor(private o: ProvisionalEvaluatorOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  /** Engine updates this after every close scan; until then the coin×interval is not provisional-evaluated. */
  setQualified(coin: string, interval: Interval, qualified: SetupResult[]): void {
    this.qualified.set(`${coin}|${interval}`, qualified);
  }

  async onMids(mids: Record<string, number>): Promise<void> {
    for (const [coin, mid] of Object.entries(mids)) {
      if (!this.o.tickGate.shouldEvaluate(coin, mid)) continue;
      await this.evaluateCoin(coin);
    }
  }

  private async evaluateCoin(coin: string): Promise<void> {
    for (const tf of this.o.timeframes) {
      const qualified = this.qualified.get(`${coin}|${tf}`);
      if (!qualified || qualified.length === 0) continue;
      const forming = this.o.aggregator.forming(coin, tf);
      if (!forming) continue;
      const candles = this.o.aggregator.withForming(coin, tf);
      if (candles.length - 1 < this.o.minCandles) continue; // closed history too thin
      const started = this.now();
      try {
        const plans = this.o.analyze(candles, qualified);
        this.o.metrics.record('tick-eval', this.now() - started);
        await this.o.alert(coin, tf, plans);
      } catch (err) {
        this.o.log.error({ coin, tf, err: (err as Error).message }, 'provisional evaluation failed');
      }
    }
  }
}
