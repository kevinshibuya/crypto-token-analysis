import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import { body, isBull, isBear, isLongBody } from './helpers';

export function detectEngulfing(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    if (isBear(p) && isBull(c) && c.o <= p.c && c.c >= p.o && body(c) > body(p)) {
      out.push({ kind: 'bullish-engulfing', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(p) && isBear(c) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) {
      out.push({ kind: 'bearish-engulfing', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectHarami(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    if (!isLongBody(p)) continue;
    if (isBear(p) && isBull(c) && c.o > p.c && c.c < p.o) {
      out.push({ kind: 'bullish-harami', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(p) && isBear(c) && c.o < p.c && c.c > p.o) {
      out.push({ kind: 'bearish-harami', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
