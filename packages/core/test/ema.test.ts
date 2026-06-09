import { describe, it, expect } from 'vitest';
import { ema } from '../src/ema';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('ema', () => {
  it('seeds with the SMA of the first `period` closes, then smooths', () => {
    // closes 1..5, period 3, k = 0.5. seed = (1+2+3)/3 = 2 @ t3; then 4*.5+2*.5=3 @ t4; 5*.5+3*.5=4 @ t5
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(ema(candles, 3)).toEqual([
      { t: 3, value: 2 },
      { t: 4, value: 3 },
      { t: 5, value: 4 },
    ]);
  });

  it('returns empty when fewer candles than the period', () => {
    expect(ema([c(1, 1), c(2, 2)], 3)).toEqual([]);
  });
});
