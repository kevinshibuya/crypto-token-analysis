import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import {
  body, range, upperWick, lowerWick, isBull, isBear,
  DOJI_BODY_MAX_RATIO, WICK_BODY_MULT, SMALL_BODY_MAX_RATIO,
} from './helpers';

export function detectDoji(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const r = range(c);
    if (r <= 0 || body(c) > DOJI_BODY_MAX_RATIO * r) continue;
    const prev = candles[i - 1];
    if (isBull(prev)) out.push({ kind: 'doji', direction: 'bearish', index: i, t: c.t });
    else if (isBear(prev)) out.push({ kind: 'doji', direction: 'bullish', index: i, t: c.t });
  }
  return out;
}

const smallBodyAt = (c: Candle): boolean => {
  const r = range(c);
  const b = body(c);
  return r > 0 && b > DOJI_BODY_MAX_RATIO * r && b <= SMALL_BODY_MAX_RATIO * r;
};

export function detectHammer(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!smallBodyAt(c)) continue;
    if (lowerWick(c) >= WICK_BODY_MULT * body(c) && upperWick(c) <= body(c)) {
      out.push({ kind: 'hammer', direction: 'bullish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectShootingStar(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!smallBodyAt(c)) continue;
    if (upperWick(c) >= WICK_BODY_MULT * body(c) && lowerWick(c) <= body(c)) {
      out.push({ kind: 'shooting-star', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
