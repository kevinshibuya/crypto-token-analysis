// packages/core/src/atr.ts
import type { Candle, IndicatorPoint } from './types';

export function atr(candles: Candle[], period = 14): IndicatorPoint[] {
  if (period <= 0) throw new Error('atr: period must be > 0');
  if (candles.length <= period) return [];

  const tr = (i: number): number => {
    const c = candles[i];
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  };

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  const out: IndicatorPoint[] = [{ t: candles[period].t, value: prev }];
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out.push({ t: candles[i].t, value: prev });
  }
  return out;
}
