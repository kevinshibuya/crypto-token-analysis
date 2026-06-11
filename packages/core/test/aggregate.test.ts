// packages/core/test/aggregate.test.ts
import { describe, expect, it } from 'vitest';
import { aggregateCandles, applyMid, bucketStart } from '../src/aggregate';
import type { Candle } from '../src/types';

const H = 3_600_000;
const c = (t: number, o: number, h: number, l: number, cl: number, v = 1, n = 1): Candle =>
  ({ t, o, h, l, c: cl, v, n });

describe('bucketStart', () => {
  it('floors to the bucket boundary', () => {
    expect(bucketStart(H + 1, H)).toBe(H);
    expect(bucketStart(H, H)).toBe(H);
    expect(bucketStart(H - 1, H)).toBe(0);
  });
});

describe('aggregateCandles', () => {
  it('rolls four 15m candles into one 1h candle (o first, h max, l min, c last, v/n sums)', () => {
    const base = [
      c(0, 10, 12, 9, 11, 5, 2), c(900_000, 11, 15, 10, 14, 3, 1),
      c(1_800_000, 14, 14, 8, 9, 2, 4), c(2_700_000, 9, 13, 9, 13, 6, 3),
    ];
    expect(aggregateCandles(base, H)).toEqual([{ t: 0, o: 10, h: 15, l: 8, c: 13, v: 16, n: 10 }]);
  });

  it('splits across boundaries and keeps partial buckets', () => {
    const base = [c(2_700_000, 1, 2, 1, 2), c(3_600_000, 2, 3, 2, 3)];
    expect(aggregateCandles(base, H)).toEqual([
      { t: 0, o: 1, h: 2, l: 1, c: 2, v: 1, n: 1 },
      { t: H, o: 2, h: 3, l: 2, c: 3, v: 1, n: 1 },
    ]);
  });

  it('treats missing n as 0 in sums and returns [] for []', () => {
    const base = [c(0, 1, 1, 1, 1), { t: 900_000, o: 1, h: 1, l: 1, c: 1, v: 1 } as Candle];
    expect(aggregateCandles(base, H)[0].n).toBe(1);
    expect(aggregateCandles([], H)).toEqual([]);
  });
});

describe('applyMid', () => {
  it('moves close and stretches extremes without mutating input', () => {
    const forming = c(0, 10, 11, 9, 10);
    const up = applyMid(forming, 12);
    expect(up).toEqual({ t: 0, o: 10, h: 12, l: 9, c: 12, v: 1, n: 1 });
    expect(forming.c).toBe(10);
    expect(applyMid(forming, 8)).toEqual({ t: 0, o: 10, h: 11, l: 8, c: 8, v: 1, n: 1 });
  });
});
