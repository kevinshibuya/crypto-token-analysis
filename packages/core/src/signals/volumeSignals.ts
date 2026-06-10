import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectVolumeSpike(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { volumeSma } = ctx;
  const k = ctx.opts.volumeSpikeK;
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const smaV = volumeSma[i];
    if (!Number.isFinite(smaV) || smaV <= 0) continue;
    const c = candles[i];
    if (c.v <= k * smaV) continue;
    const up = c.c >= c.o;
    out.push({
      kind: up ? 'volume-spike-up' : 'volume-spike-down',
      direction: up ? 'bullish' : 'bearish',
      index: i, t: c.t, meta: { ratio: c.v / smaV },
    });
  }
  return out;
}
