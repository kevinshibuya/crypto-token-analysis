import { describe, it, expect } from 'vitest';
import { fetchCandles, INTERVAL_MS } from '../src/hyperliquid/pagination';
import type { Candle } from '@cta/core';

describe('fetchCandles pagination', () => {
  it('walks rolling windows past the 5000-candle cap and dedupes', async () => {
    const step = INTERVAL_MS['1m'];
    const start = 0;
    const total = 12000;
    const end = start + (total - 1) * step;

    // Source emulates the API: returns at most 5000 candles within [s, e].
    const page = (s: number, e: number): Candle[] => {
      const out: Candle[] = [];
      for (let t = Math.max(start, s); t <= Math.min(end, e); t += step) {
        out.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
      }
      return out.slice(0, 5000);
    };

    let calls = 0;
    const candles = await fetchCandles((s, e) => { calls++; return Promise.resolve(page(s, e)); }, '1m', start, end);

    expect(candles).toHaveLength(total);
    expect(candles[0].t).toBe(start);
    expect(candles[candles.length - 1].t).toBe(end);
    expect(calls).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < candles.length; i++) expect(candles[i].t).toBeGreaterThan(candles[i - 1].t);
  });
});
