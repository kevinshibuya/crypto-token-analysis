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

  it('expands the value area outward from the POC until it reaches 70%', () => {
    // Each candle occupies exactly one unit-wide bin over range [0,5], rows=5 (binSize 1).
    // Bin volumes: [10, 20, 50, 15, 5], total 100. POC = bin2 (50) @ midpoint 2.5.
    // 70% = 70. Seed 50 < 70 -> compare neighbors: below=bin1(20) > above=bin3(15) -> take bin1.
    // included 70 >= 70 -> stop. Value area spans bins 1..2 => [1, 3] (wider than the POC bin).
    const candles: Candle[] = [
      { t: 1, o: 0.5, h: 1, l: 0, c: 0.5, v: 10 },
      { t: 2, o: 1.5, h: 2, l: 1, c: 1.5, v: 20 },
      { t: 3, o: 2.5, h: 3, l: 2, c: 2.5, v: 50 },
      { t: 4, o: 3.5, h: 4, l: 3, c: 3.5, v: 15 },
      { t: 5, o: 4.5, h: 5, l: 4, c: 4.5, v: 5 },
    ];
    const res = volumeProfile(candles, 5);
    expect(res.rows[2].volume).toBeCloseTo(50);
    expect(res.poc).toBeCloseTo(2.5);
    expect(res.valueArea.low).toBeCloseTo(1);
    expect(res.valueArea.high).toBeCloseTo(3);
  });

  it('dumps a flat candle into the close bin and handles a degenerate (min===max) range', () => {
    // Single flat candle at price 5: min===max -> guard sets max=6, binSize=0.1.
    // span<=0 path: idx = floor((5-5)/0.1) = 0 -> all 50 into bin 0 ([5, 5.1], midpoint 5.05).
    const res = volumeProfile([{ t: 1, o: 5, h: 5, l: 5, c: 5, v: 50 }], 10);
    expect(res.rows).toHaveLength(10);
    expect(res.rows[0].volume).toBeCloseTo(50);
    expect(res.poc).toBeCloseTo(5.05);
  });

  it('throws on non-positive rows', () => {
    expect(() => volumeProfile([{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 1 }], 0)).toThrow();
  });
});
