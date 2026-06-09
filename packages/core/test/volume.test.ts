import { describe, it, expect } from 'vitest';
import { volume } from '../src/volume';
import type { Candle } from '../src/types';

const c = (t: number, open: number, close: number, v: number): Candle => ({ t, o: open, h: close, l: open, c: close, v });

describe('volume', () => {
  it('produces one bar per candle, tagged up/down by direction', () => {
    const candles = [c(1, 1, 2, 10), c(2, 2, 1, 20)];
    const { bars } = volume(candles, 2);
    expect(bars).toEqual([
      { t: 1, value: 10, up: true },
      { t: 2, value: 20, up: false },
    ]);
  });

  it('computes a volume SMA aligned to candle time', () => {
    const candles = [c(1, 1, 1, 10), c(2, 1, 1, 20), c(3, 1, 1, 30)];
    expect(volume(candles, 2).sma).toEqual([
      { t: 2, value: 15 },
      { t: 3, value: 25 },
    ]);
  });
});
