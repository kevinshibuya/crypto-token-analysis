import { describe, it, expect } from 'vitest';
import { atr } from '../src/atr';
import type { Candle } from '../src/types';

const k = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 1 });

describe('atr', () => {
  it('matches a hand-computed Wilder example', () => {
    // TR(i) = max(h-l, |h-prevClose|, |l-prevClose|), from i=1
    const candles = [
      k(1, 10, 11, 9, 10),      // seed (prev close 10)
      k(2, 10, 12, 10, 11),     // TR = max(2, 2, 0)  = 2
      k(3, 11, 13, 10, 12),     // TR = max(3, 2, 1)  = 3
      k(4, 12, 12.5, 11.5, 12), // TR = max(1, .5, .5) = 1
    ];
    // period 2: first ATR = (2+3)/2 = 2.5 @ t3; next = (2.5*1 + 1)/2 = 1.75 @ t4
    const r = atr(candles, 2);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ t: 3, value: 2.5 });
    expect(r[1].value).toBeCloseTo(1.75, 10);
  });

  it('returns empty when candles <= period', () => {
    expect(atr([k(1, 1, 2, 0, 1), k(2, 1, 2, 0, 1)], 2)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => atr([], 0)).toThrow();
  });
});
