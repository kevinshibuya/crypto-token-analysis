import { describe, it, expect } from 'vitest';
import { qualifySetups } from '../src/decide/qualify';
import { DEFAULT_GATE } from '../src/decide/constants';
import type { SetupResult } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';

const m = (trades: number, expectancy: number): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0,
});
const r = (kind: string, trades: number, expectancy: number): SetupResult =>
  ({ kinds: [kind], metrics: m(trades, expectancy) }) as SetupResult;

describe('qualifySetups', () => {
  it('keeps boundary values (exactly minTrades / minExpectancy)', () => {
    const out = qualifySetups([r('a', 20, 0.1), r('b', 19, 0.5), r('c', 100, 0.0999)], DEFAULT_GATE);
    expect(out.map((x) => x.kinds[0])).toEqual(['a']);
  });

  it('preserves scan-rank order and caps at topN', () => {
    const results = ['a', 'b', 'c', 'd'].map((k) => r(k, 50, 0.3));
    const out = qualifySetups(results, { minTrades: 20, minExpectancy: 0.1, topN: 2 });
    expect(out.map((x) => x.kinds[0])).toEqual(['a', 'b']);
  });

  it('returns empty when nothing qualifies', () => {
    expect(qualifySetups([r('a', 5, 2)], DEFAULT_GATE)).toEqual([]);
  });
});
