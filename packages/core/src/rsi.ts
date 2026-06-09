import type { Candle, IndicatorPoint } from './types';

export function rsi(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('rsi: period must be > 0');
  if (candles.length <= period) return [];

  const fromAverages = (avgGain: number, avgLoss: number): number =>
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].c - candles[i - 1].c;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  const out: IndicatorPoint[] = [{ t: candles[period].t, value: fromAverages(avgGain, avgLoss) }];
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].c - candles[i - 1].c;
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push({ t: candles[i].t, value: fromAverages(avgGain, avgLoss) });
  }
  return out;
}
