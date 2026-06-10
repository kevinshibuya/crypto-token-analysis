import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);

export function detectMaCross(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { maFast, maSlow } = ctx;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!finite(maFast[i - 1], maFast[i], maSlow[i - 1], maSlow[i])) continue;
    if (maFast[i - 1] <= maSlow[i - 1] && maFast[i] > maSlow[i]) {
      out.push({ kind: 'ma-golden-cross', direction: 'bullish', index: i, t: candles[i].t });
    } else if (maFast[i - 1] >= maSlow[i - 1] && maFast[i] < maSlow[i]) {
      out.push({ kind: 'ma-death-cross', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}

export function detectPriceMaCross(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { maFast } = ctx;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!finite(maFast[i - 1], maFast[i])) continue;
    const p = candles[i - 1].c;
    const c = candles[i].c;
    if (p <= maFast[i - 1] && c > maFast[i]) {
      out.push({ kind: 'price-cross-ma-up', direction: 'bullish', index: i, t: candles[i].t });
    } else if (p >= maFast[i - 1] && c < maFast[i]) {
      out.push({ kind: 'price-cross-ma-down', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}
