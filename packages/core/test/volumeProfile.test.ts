import { describe, it, expect } from 'vitest';
import { volumeProfile } from '../src/volumeProfile';
import type { Candle } from '../src/types';

describe('volumeProfile', () => {
  it('distributes volume uniformly across [low,high] and finds POC + value area', () => {
    // A spreads 10 volume evenly over price [0,10] across 10 rows -> 1 per row.
    // B dumps 100 volume into [5,6] -> all into row index 5.
    const candles: Candle[] = [
      { t: 1, o: 4, h: 10, l: 0, c: 5, v: 10 },
      { t: 2, o: 5.4, h: 6, l: 5, c: 5.5, v: 100 },
    ];
    const res = volumeProfile(candles, 10);
    expect(res.rows).toHaveLength(10);
    // row 5 = [5,6] holds 1 (from A) + 100 (from B) = 101
    expect(res.rows[5].priceLow).toBeCloseTo(5);
    expect(res.rows[5].priceHigh).toBeCloseTo(6);
    expect(res.rows[5].volume).toBeCloseTo(101);
    expect(res.poc).toBeCloseTo(5.5); // midpoint of row 5
    // total = 110, 70% = 77; row 5 alone (101) covers it -> value area = [5,6]
    expect(res.valueArea.low).toBeCloseTo(5);
    expect(res.valueArea.high).toBeCloseTo(6);
  });

  it('handles empty input', () => {
    expect(volumeProfile([], 10)).toEqual({ rows: [], poc: 0, valueArea: { low: 0, high: 0 } });
  });
});
