import { describe, it, expect } from 'vitest';
import { pivots } from '../src/pivots';
import type { Candle } from '../src/types';

const c = (t: number, h: number, l: number, close: number, v = 1): Candle => ({ t, o: close, h, l, c: close, v });

describe('pivots', () => {
  it('finds a swing high (resistance) and swing low (support) relative to current price', () => {
    // highs: 10,12,11,9,11 ; lows: 8,9,7,6,8 ; last close 9
    const candles = [
      c(1, 10, 8, 9),
      c(2, 12, 9, 9),
      c(3, 11, 7, 9),
      c(4, 9, 6, 9),
      c(5, 11, 8, 9),
    ];
    const levels = pivots(candles, { lookback: 1, maxLevels: 6, mergeTolerance: 0.003 });
    const prices = levels.map((p) => ({ price: p.price, type: p.type }));
    expect(prices).toContainEqual({ price: 12, type: 'resistance' });
    expect(prices).toContainEqual({ price: 6, type: 'support' });
  });

  it('returns at most maxLevels, strongest first', () => {
    const candles = [
      c(1, 10, 8, 9),
      c(2, 12, 9, 9, 5),
      c(3, 11, 7, 9),
      c(4, 9, 6, 9, 1),
      c(5, 11, 8, 9),
    ];
    const levels = pivots(candles, { lookback: 1, maxLevels: 1, mergeTolerance: 0.003 });
    expect(levels).toHaveLength(1);
    expect(levels[0].price).toBe(12); // higher surrounding volume
  });

  it('merges nearby pivots into a volume-weighted average price', () => {
    // Two swing highs (lookback 1): index1 h=100 (strength v0+v1+v2 = 10), index3 h=100.2
    // (strength v2+v3+v4 = 20). |100.2-100|/100 = 0.002 <= 0.003 tol -> merge.
    // merged price = (100*10 + 100.2*20)/30 = 3004/30 = 100.1333..., strength 30, touches 2.
    // last close 50 -> price >= current -> resistance.
    const candles = [
      c(1, 10, 5, 50, 0),
      c(2, 100, 5, 50, 10),
      c(3, 50, 5, 50, 0),
      c(4, 100.2, 5, 50, 20),
      c(5, 10, 5, 50, 0),
    ];
    const levels = pivots(candles, { lookback: 1, maxLevels: 6, mergeTolerance: 0.003 });
    expect(levels).toHaveLength(1);
    expect(levels[0].touches).toBe(2);
    expect(levels[0].strength).toBe(30);
    expect(levels[0].type).toBe('resistance');
    expect(levels[0].price).toBeCloseTo(100.1333, 3);
  });

  it('rejects a tied high — a flat plateau is not a strict swing pivot', () => {
    // All highs equal (and all lows equal): the >= / <= comparisons disqualify ties -> no pivots.
    const candles = [c(1, 100, 5, 50), c(2, 100, 5, 50), c(3, 100, 5, 50)];
    expect(pivots(candles, { lookback: 1, maxLevels: 6, mergeTolerance: 0.003 })).toEqual([]);
  });

  it('returns empty when lookback leaves no interior bars', () => {
    const candles = [c(1, 10, 8, 9), c(2, 12, 9, 9)];
    expect(pivots(candles, { lookback: 5, maxLevels: 6, mergeTolerance: 0.003 })).toEqual([]);
  });
});
