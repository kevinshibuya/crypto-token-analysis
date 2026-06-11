import { describe, expect, it } from 'vitest';
import type { Candle, SetupResult, TradePlan } from '@cta/core';
import { CandleAggregator } from '../src/engine/aggregator';
import { TickGate } from '../src/engine/scheduler';
import { LatencyTracker } from '../src/engine/metrics';
import { ProvisionalEvaluator } from '../src/engine/provisional';
import { nullLogger } from '../src/engine/logger';

const M15 = 900_000;
const series = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * M15, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));
const metrics: SetupResult['metrics'] = {
  trades: 30, wins: 18, winRate: 0.6, avgR: 0.4, profitFactor: 1.8,
  expectancy: 0.4, maxDrawdownR: 2, filtered: 0, longTrades: 30, shortTrades: 0,
};
const qualified: SetupResult[] = [{ kinds: ['rsi-oversold-exit'], metrics }];

const mk = (minCandles = 20) => {
  let now = 100 * M15 + 5_000;
  const aggregator = new CandleAggregator({ timeframes: ['15m', '1h'], lookback: 500, closeGraceMs: 2_000, now: () => now });
  aggregator.seed('BTC', '15m', series(100));
  aggregator.seed('BTC', '1h', series(25).map((c) => ({ ...c, t: c.t * 4 })));
  aggregator.onMid('BTC', 1.5, now); // creates forming candles on both timeframes
  const evaluated: { coin: string; interval: string; candleCount: number }[] = [];
  const alerted: { coin: string; interval: string; plans: TradePlan[] }[] = [];
  const evaluator = new ProvisionalEvaluator({
    aggregator,
    tickGate: new TickGate({ minMovePct: 0.05, minIntervalMs: 0, now: () => now }),
    timeframes: ['15m', '1h'],
    minCandles,
    metrics: new LatencyTracker(),
    log: nullLogger(),
    alert: async (coin, interval, plans) => { alerted.push({ coin, interval, plans }); },
    analyze: (candles) => {
      evaluated.push({ coin: 'BTC', interval: '?', candleCount: candles.length });
      return [{
        setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
        entry: 1.5, stop: 1, target: 2.5, rr: 2, status: 'active',
        metrics: qualified[0].metrics,
        confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
      }];
    },
  });
  return { evaluator, aggregator, evaluated, alerted, setNow: (t: number) => { now = t; } };
};

describe('ProvisionalEvaluator', () => {
  it('does nothing for coins with no qualified-setup cache yet', async () => {
    const { evaluator, evaluated } = mk();
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });

  it('evaluates every configured timeframe (closed series + forming appended) once qualified', async () => {
    const { evaluator, evaluated, alerted } = mk();
    evaluator.setQualified('BTC', '15m', qualified);
    evaluator.setQualified('BTC', '1h', qualified);
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(2);            // 15m + 1h
    expect(evaluated[0].candleCount).toBe(101);   // 100 closed + forming
    expect(alerted.map((a) => a.interval).sort()).toEqual(['15m', '1h']);
    expect(alerted[0].plans[0].confidence.score).toBe(80);
  });

  it('respects the tick gate (second tick with negligible move is skipped)', async () => {
    const { evaluator, evaluated } = mk();
    evaluator.setQualified('BTC', '15m', qualified);
    await evaluator.onMids({ BTC: 1.6 });
    const n = evaluated.length;
    await evaluator.onMids({ BTC: 1.6000001 });
    expect(evaluated).toHaveLength(n);
  });

  it('skips timeframes whose series is shorter than minCandles', async () => {
    const { evaluator, evaluated } = mk(50);
    evaluator.setQualified('BTC', '1h', qualified); // 1h has only 25 closed candles < 50
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });

  it('skips coins the aggregator does not track and empty qualified lists', async () => {
    const { evaluator, evaluated } = mk();
    evaluator.setQualified('BTC', '15m', []);
    await evaluator.onMids({ UNKNOWN: 5, BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });
});
