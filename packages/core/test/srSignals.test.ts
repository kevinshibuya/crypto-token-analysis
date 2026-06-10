import { describe, it, expect } from 'vitest';
import { detectSrSignals } from '../src/signals/srSignals';
import { candle, ctxWith } from './fixtures';
import type { PivotLevel } from '../src/types';

const level = (price: number): PivotLevel => ({ price, type: 'support', strength: 1, touches: 1 });
// atr 2, srTolAtrMult 0.25 → tol 0.5
const mkCtx = (levels: number[], n: number) =>
  ctxWith({ pivots: levels.map(level), atr: Array(n).fill(2) });

describe('detectSrSignals', () => {
  it('emits a support bounce', () => {
    // P=100: prev close 102 > P; low 100.2 <= 100.5; close 101 > 100.5
    const candles = [candle(1, 102, 103, 101.5, 102), candle(2, 102, 102.5, 100.2, 101)];
    expect(detectSrSignals(candles, mkCtx([100], 2))).toEqual([
      { kind: 'sr-bounce-support', direction: 'bullish', index: 1, t: 2, meta: { level: 100 } },
    ]);
  });
  it('emits a resistance break up', () => {
    // P=105: prev close 104 <= P; close 105.6 > 105.5
    const candles = [candle(1, 103, 104.5, 102.5, 104), candle(2, 104, 106, 103.9, 105.6)];
    expect(detectSrSignals(candles, mkCtx([105], 2))).toEqual([
      { kind: 'sr-break-up', direction: 'bullish', index: 1, t: 2, meta: { level: 105 } },
    ]);
  });
  it('emits a break down through support', () => {
    const candles = [candle(1, 101, 102, 100.5, 101), candle(2, 101, 101.5, 99, 99.4)];
    expect(detectSrSignals(candles, mkCtx([100], 2))).toEqual([
      { kind: 'sr-break-down', direction: 'bearish', index: 1, t: 2, meta: { level: 100 } },
    ]);
  });
  it('stays silent when ATR is NaN', () => {
    const candles = [candle(1, 102, 103, 101.5, 102), candle(2, 102, 102.5, 100.2, 101)];
    const ctx = ctxWith({ pivots: [level(100)], atr: [NaN, NaN] });
    expect(detectSrSignals(candles, ctx)).toEqual([]);
  });
});
