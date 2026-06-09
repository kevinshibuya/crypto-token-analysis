import type { Candle, PivotLevel, PivotType } from './types';

export interface PivotOptions {
  lookback: number; // bars on each side
  maxLevels: number;
  mergeTolerance: number; // fraction of price, e.g. 0.003
  volumeWindow?: number; // bars each side summed for strength (default = lookback)
}

export function pivots(candles: Candle[], opts: PivotOptions): PivotLevel[] {
  const { lookback, maxLevels, mergeTolerance } = opts;
  if (lookback <= 0) throw new Error('pivots: lookback must be > 0');
  const vWin = opts.volumeWindow ?? lookback;
  const current = candles.length ? candles[candles.length - 1].c : 0;

  interface Raw { price: number; strength: number }
  const raw: Raw[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    let strength = 0;
    for (let j = Math.max(0, i - vWin); j <= Math.min(candles.length - 1, i + vWin); j++) {
      strength += candles[j].v;
    }
    if (isHigh) raw.push({ price: candles[i].h, strength });
    if (isLow) raw.push({ price: candles[i].l, strength });
  }

  raw.sort((a, b) => a.price - b.price);
  const merged: { price: number; strength: number; touches: number }[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(r.price - last.price) / last.price <= mergeTolerance) {
      const total = last.strength + r.strength;
      last.price = (last.price * last.strength + r.price * r.strength) / total;
      last.strength = total;
      last.touches += 1;
    } else {
      merged.push({ price: r.price, strength: r.strength, touches: 1 });
    }
  }

  const levels: PivotLevel[] = merged.map((m) => ({
    price: m.price,
    type: (m.price >= current ? 'resistance' : 'support') as PivotType,
    strength: m.strength,
    touches: m.touches,
  }));
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}
