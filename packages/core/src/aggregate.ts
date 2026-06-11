import type { Candle } from './types';

/** Start of the bucket containing t. Hyperliquid candles are UTC-aligned, so plain flooring is exact. */
export function bucketStart(t: number, bucketMs: number): number {
  return Math.floor(t / bucketMs) * bucketMs;
}

/** Roll base-interval candles into bucketMs candles. Input must be sorted by t ascending. */
export function aggregateCandles(base: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  for (const b of base) {
    const t = bucketStart(b.t, bucketMs);
    const cur = out[out.length - 1];
    if (!cur || cur.t !== t) {
      out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n ?? 0 });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.n = (cur.n ?? 0) + (b.n ?? 0);
    }
  }
  return out;
}

/** Apply a mid-price tick to a forming candle (close moves, extremes stretch). Returns a new candle. */
export function applyMid(forming: Candle, mid: number): Candle {
  return { ...forming, c: mid, h: Math.max(forming.h, mid), l: Math.min(forming.l, mid) };
}
