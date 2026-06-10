import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../src/backtest/metrics';
import type { TradeRecord } from '../src/backtest/simulate';

const tr = (r: number, direction: 'bullish' | 'bearish' = 'bullish'): TradeRecord =>
  ({ direction, entryIndex: 1, entryPrice: 100, exitIndex: 2, exitPrice: 100 + r, r, reason: r > 0 ? 'target' : 'stop' });

describe('computeMetrics', () => {
  it('computes the aggregate set', () => {
    const m = computeMetrics([tr(2), tr(-1, 'bearish'), tr(1), tr(-0.5)], 3);
    expect(m.trades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.winRate).toBeCloseTo(0.5, 10);
    expect(m.avgR).toBeCloseTo(0.375, 10);
    expect(m.profitFactor).toBeCloseTo(2, 10);       // 3 / 1.5
    expect(m.expectancy).toBeCloseTo(0.375, 10);
    expect(m.maxDrawdownR).toBeCloseTo(1, 10);       // equity 2,1,2,1.5 → worst dip 1
    expect(m.filtered).toBe(3);
    expect(m.longTrades).toBe(3);
    expect(m.shortTrades).toBe(1);
  });
  it('returns null profit factor with wins and no losses', () => {
    expect(computeMetrics([tr(1)], 0).profitFactor).toBeNull();
  });
  it('handles the empty case', () => {
    const m = computeMetrics([], 2);
    expect(m.trades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.maxDrawdownR).toBe(0);
  });
});
