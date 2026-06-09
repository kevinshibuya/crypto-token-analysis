import { describe, it, expect } from 'vitest';
import { sma } from '../src/sma';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('sma', () => {
  it('computes a simple moving average aligned to the candle time', () => {
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(sma(candles, 3)).toEqual([
      { t: 3, value: 2 },
      { t: 4, value: 3 },
      { t: 5, value: 4 },
    ]);
  });

  it('returns empty when fewer candles than the period', () => {
    expect(sma([c(1, 1), c(2, 2)], 3)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => sma([c(1, 1)], 0)).toThrow();
  });
});
