import type { Candle, IndicatorPoint } from './types';

export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('sma: period must be > 0');
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ t: candles[i].t, value: sum / period });
  }
  return out;
}
