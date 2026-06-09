import { describe, it, expect } from 'vitest';
import { rsi } from '../src/rsi';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('rsi', () => {
  it('is 100 when every change is a gain', () => {
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(rsi(candles, 2).every((p) => p.value === 100)).toBe(true);
  });

  it('matches a hand-computed Wilder example', () => {
    // closes [1,3,2,4], period 2:
    //   first avg over changes +2,-1 -> avgGain 1, avgLoss .5 -> RSI 66.667 @ t3
    //   next change +2 -> avgGain 1.5, avgLoss .25 -> RSI 85.714 @ t4
    const candles = [c(1, 1), c(2, 3), c(3, 2), c(4, 4)];
    const r = rsi(candles, 2);
    expect(r).toHaveLength(2);
    expect(r[0].t).toBe(3);
    expect(r[0].value).toBeCloseTo(66.667, 2);
    expect(r[1].value).toBeCloseTo(85.714, 2);
  });

  it('returns empty when candles <= period', () => {
    expect(rsi([c(1, 1), c(2, 2)], 2)).toEqual([]);
  });
});
