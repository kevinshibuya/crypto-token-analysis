import type { Candle, PivotLevel, PivotType } from './types';

export interface PivotOptions {
  lookback: number; // bars on each side
  maxLevels: number;
  mergeTolerance: number; // fraction of price, e.g. 0.003
  volumeWindow?: number; // bars each side summed for strength (default = lookback)
}

/** A raw, unmerged pivot. `confirmIdx = index + lookback` is the earliest candle at which the
 *  pivot is knowable walk-forward (lookback bars must exist after it). */
export interface RawPivot {
  price: number;
  strength: number;
  index: number;
  confirmIdx: number;
}

/** Single full-history swing-scan. Output is in candle-index order, hence also confirmIdx order. */
export function collectRawPivots(candles: Candle[], opts: PivotOptions): RawPivot[] {
  const { lookback } = opts;
  if (lookback <= 0) throw new Error('pivots: lookback must be > 0');
  const vWin = opts.volumeWindow ?? lookback;
  const raw: RawPivot[] = [];
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
    const confirmIdx = i + lookback;
    if (isHigh) raw.push({ price: candles[i].h, strength, index: i, confirmIdx });
    if (isLow) raw.push({ price: candles[i].l, strength, index: i, confirmIdx });
  }
  return raw;
}

/** Greedy price-merge (strength-weighted) → rank by strength → top maxLevels. Does not mutate `raw`. */
export function mergeRankSlice(raw: RawPivot[], opts: PivotOptions, current: number): PivotLevel[] {
  const { lookback, maxLevels, mergeTolerance } = opts;
  const sorted = [...raw].sort((a, b) => a.price - b.price);
  const merged: { price: number; strength: number; indices: number[] }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(r.price - last.price) / last.price <= mergeTolerance) {
      const total = last.strength + r.strength;
      last.price = (last.price * last.strength + r.price * r.strength) / total;
      last.strength = total;
      last.indices.push(r.index);
    } else {
      merged.push({ price: r.price, strength: r.strength, indices: [r.index] });
    }
  }

  const visitGap = 2 * lookback;
  const countVisits = (indices: number[]): number => {
    const s = [...indices].sort((a, b) => a - b);
    let visits = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] - s[i - 1] > visitGap) visits++;
    }
    return visits;
  };

  const levels: PivotLevel[] = merged.map((m) => ({
    price: m.price,
    type: (m.price >= current ? 'resistance' : 'support') as PivotType,
    strength: m.strength,
    touches: countVisits(m.indices),
  }));
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}

export function pivots(candles: Candle[], opts: PivotOptions): PivotLevel[] {
  const current = candles.length ? candles[candles.length - 1].c : 0;
  return mergeRankSlice(collectRawPivots(candles, opts), opts, current);
}
