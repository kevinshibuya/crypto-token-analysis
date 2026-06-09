import type { Candle, IndicatorPoint } from './types';

export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('ema: period must be > 0');
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: IndicatorPoint[] = [];
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].c;
  let prev = seed / period;
  out.push({ t: candles[period - 1].t, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].c * k + prev * (1 - k);
    out.push({ t: candles[i].t, value: prev });
  }
  return out;
}
