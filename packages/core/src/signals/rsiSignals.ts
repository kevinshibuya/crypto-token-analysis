import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectRsiZoneExits(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { rsi } = ctx;
  const { rsiOversold, rsiOverbought } = ctx.opts;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = rsi[i - 1];
    const b = rsi[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if (a < rsiOversold && b >= rsiOversold) {
      out.push({ kind: 'rsi-oversold-exit', direction: 'bullish', index: i, t: candles[i].t });
    }
    if (a > rsiOverbought && b <= rsiOverbought) {
      out.push({ kind: 'rsi-overbought-exit', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}

function swingIndices(candles: Candle[], w: number, pick: (c: Candle) => number, isLow: boolean): number[] {
  const out: number[] = [];
  for (let j = w; j < candles.length - w; j++) {
    let ok = true;
    for (let m = j - w; m <= j + w && ok; m++) {
      if (m === j) continue;
      if (isLow ? pick(candles[m]) <= pick(candles[j]) : pick(candles[m]) >= pick(candles[j])) ok = false;
    }
    if (ok) out.push(j);
  }
  return out;
}

export function detectRsiDivergence(candles: Candle[], ctx: DetectorContext): Signal[] {
  const w = ctx.opts.divergenceSwing;
  const lb = ctx.opts.divergenceLookback;
  const { rsi } = ctx;
  const out: Signal[] = [];

  const lows = swingIndices(candles, w, (c) => c.l, true);
  for (let k = 1; k < lows.length; k++) {
    const [j1, j2] = [lows[k - 1], lows[k]];
    if (j2 - j1 > lb || j2 + w >= candles.length) continue;
    if (Number.isNaN(rsi[j1]) || Number.isNaN(rsi[j2])) continue;
    if (candles[j2].l < candles[j1].l && rsi[j2] > rsi[j1]) {
      out.push({
        kind: 'rsi-bullish-divergence', direction: 'bullish',
        index: j2 + w, t: candles[j2 + w].t, meta: { prevIndex: j1, curIndex: j2 },
      });
    }
  }

  const highs = swingIndices(candles, w, (c) => c.h, false);
  for (let k = 1; k < highs.length; k++) {
    const [j1, j2] = [highs[k - 1], highs[k]];
    if (j2 - j1 > lb || j2 + w >= candles.length) continue;
    if (Number.isNaN(rsi[j1]) || Number.isNaN(rsi[j2])) continue;
    if (candles[j2].h > candles[j1].h && rsi[j2] < rsi[j1]) {
      out.push({
        kind: 'rsi-bearish-divergence', direction: 'bearish',
        index: j2 + w, t: candles[j2 + w].t, meta: { prevIndex: j1, curIndex: j2 },
      });
    }
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}
