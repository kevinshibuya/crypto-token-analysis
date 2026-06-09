import type { Candle, IndicatorPoint, VolumeBar, VolumeResult } from './types';

export function volume(candles: Candle[], smaPeriod: number): VolumeResult {
  if (smaPeriod <= 0) throw new Error('volume: smaPeriod must be > 0');
  const bars: VolumeBar[] = candles.map((c) => ({ t: c.t, value: c.v, up: c.c >= c.o }));
  const sma: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].v;
    if (i >= smaPeriod) sum -= candles[i - smaPeriod].v;
    if (i >= smaPeriod - 1) sma.push({ t: candles[i].t, value: sum / smaPeriod });
  }
  return { bars, sma };
}
