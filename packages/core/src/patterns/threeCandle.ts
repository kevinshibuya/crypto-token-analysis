import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import { body, isBull, isBear, isLongBody, STAR_MID_BODY_MAX_RATIO } from './helpers';

export function detectStars(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];
    if (body(b) > STAR_MID_BODY_MAX_RATIO * body(a)) continue;
    const mid = (a.o + a.c) / 2;
    if (isBear(a) && isLongBody(a) && isBull(c) && c.c >= mid) {
      out.push({ kind: 'morning-star', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(a) && isLongBody(a) && isBear(c) && c.c <= mid) {
      out.push({ kind: 'evening-star', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectSoldiersCrows(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 2; i < candles.length; i++) {
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    const allBull = [a, b, c].every((x) => isBull(x) && isLongBody(x));
    const allBear = [a, b, c].every((x) => isBear(x) && isLongBody(x));
    if (allBull
      && b.c > a.c && c.c > b.c
      && b.o >= a.o && b.o <= a.c
      && c.o >= b.o && c.o <= b.c) {
      out.push({ kind: 'three-white-soldiers', direction: 'bullish', index: i, t: c.t });
    } else if (allBear
      && b.c < a.c && c.c < b.c
      && b.o <= a.o && b.o >= a.c
      && c.o <= b.o && c.o >= b.c) {
      out.push({ kind: 'three-black-crows', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
