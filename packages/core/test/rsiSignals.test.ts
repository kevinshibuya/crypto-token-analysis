import { describe, it, expect } from 'vitest';
import { detectRsiZoneExits, detectRsiDivergence } from '../src/signals/rsiSignals';
import { candle, ctxWith } from './fixtures';

describe('detectRsiZoneExits', () => {
  it('emits oversold exit and overbought exit on threshold crossings', () => {
    const candles = [1, 2, 3, 4, 5].map((t) => candle(t, 10, 11, 9, 10));
    const ctx = ctxWith({ rsi: [NaN, 25, 35, 75, 65] });
    expect(detectRsiZoneExits(candles, ctx)).toEqual([
      { kind: 'rsi-oversold-exit', direction: 'bullish', index: 2, t: 3 },
      { kind: 'rsi-overbought-exit', direction: 'bearish', index: 4, t: 5 },
    ]);
  });
  it('ignores NaN warmup values', () => {
    const candles = [1, 2].map((t) => candle(t, 10, 11, 9, 10));
    expect(detectRsiZoneExits(candles, ctxWith({ rsi: [NaN, 35] }))).toEqual([]);
  });
});

describe('detectRsiDivergence', () => {
  // w=1 keeps fixtures small. Lows at j1=2 (l=9) and j2=6 (l=8.5): price lower low.
  const lows = [10, 9.8, 9, 9.7, 9.9, 9.6, 8.5, 9.4, 9.9];
  const candles = lows.map((l, i) => candle(i + 1, l + 0.5, l + 1, l, l + 0.6));

  it('emits bullish divergence when price makes a lower low but RSI a higher low', () => {
    const ctx = ctxWith({ rsi: [50, 45, 30, 40, 45, 40, 38, 44, 50] }, { divergenceSwing: 1 });
    const s = detectRsiDivergence(candles, ctx);
    expect(s).toEqual([{
      kind: 'rsi-bullish-divergence', direction: 'bullish', index: 7, t: 8,
      meta: { prevIndex: 2, curIndex: 6 },
    }]);
  });
  it('stays silent when RSI also makes a lower low', () => {
    const ctx = ctxWith({ rsi: [50, 45, 30, 40, 45, 40, 25, 44, 50] }, { divergenceSwing: 1 });
    expect(detectRsiDivergence(candles, ctx)).toEqual([]);
  });
});
