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
});
