import type { Candle, VolumeProfileResult, VolumeProfileRow } from './types';

const VALUE_AREA_FRACTION = 0.7;

export function volumeProfile(candles: Candle[], rows: number): VolumeProfileResult {
  if (rows <= 0) throw new Error('volumeProfile: rows must be > 0');
  if (candles.length === 0) return { rows: [], poc: 0, valueArea: { low: 0, high: 0 } };

  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.l < min) min = c.l;
    if (c.h > max) max = c.h;
  }
  if (max === min) max = min + 1;
  const binSize = (max - min) / rows;
  const vol = new Array<number>(rows).fill(0);

  for (const c of candles) {
    const span = c.h - c.l;
    if (span <= 0) {
      let idx = Math.floor((c.c - min) / binSize);
      idx = Math.max(0, Math.min(rows - 1, idx));
      vol[idx] += c.v;
      continue;
    }
    const firstBin = Math.max(0, Math.floor((c.l - min) / binSize));
    const lastBin = Math.min(rows - 1, Math.floor((c.h - min) / binSize));
    for (let b = firstBin; b <= lastBin; b++) {
      const binLow = min + b * binSize;
      const binHigh = binLow + binSize;
      const overlap = Math.min(c.h, binHigh) - Math.max(c.l, binLow);
      if (overlap > 0) vol[b] += c.v * (overlap / span);
    }
  }

  const profileRows: VolumeProfileRow[] = vol.map((v, b) => ({
    priceLow: min + b * binSize,
    priceHigh: min + (b + 1) * binSize,
    volume: v,
  }));

  let pocIdx = 0;
  for (let b = 1; b < rows; b++) if (vol[b] > vol[pocIdx]) pocIdx = b;
  const poc = (profileRows[pocIdx].priceLow + profileRows[pocIdx].priceHigh) / 2;

  const total = vol.reduce((a, b) => a + b, 0);
  let included = vol[pocIdx];
  let lo = pocIdx;
  let hi = pocIdx;
  while (included < total * VALUE_AREA_FRACTION && (lo > 0 || hi < rows - 1)) {
    const below = lo > 0 ? vol[lo - 1] : -1;
    const above = hi < rows - 1 ? vol[hi + 1] : -1;
    if (above >= below) {
      hi++;
      included += vol[hi];
    } else {
      lo--;
      included += vol[lo];
    }
  }

  return {
    rows: profileRows,
    poc,
    valueArea: { low: profileRows[lo].priceLow, high: profileRows[hi].priceHigh },
  };
}
