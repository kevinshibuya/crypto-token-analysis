import type { Candle } from '@cta/core';
import { MAX_CANDLES_PER_REQUEST } from '../config';

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};

export async function fetchCandles(
  fetchPage: (start: number, end: number) => Promise<Candle[]>,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const step = INTERVAL_MS[interval];
  if (!step) throw new Error(`unknown interval ${interval}`);
  const windowMs = step * MAX_CANDLES_PER_REQUEST;
  const byT = new Map<number, Candle>();

  let cursor = startTime;
  while (cursor <= endTime) {
    const winEnd = Math.min(endTime, cursor + windowMs - step);
    const page = await fetchPage(cursor, winEnd);
    for (const c of page) byT.set(c.t, c);
    if (page.length === 0) {
      cursor = winEnd + step; // nothing here; skip the window
    } else {
      const lastT = page[page.length - 1].t;
      cursor = Math.max(lastT + step, winEnd + step);
    }
  }

  return [...byT.values()].sort((a, b) => a.t - b.t);
}
