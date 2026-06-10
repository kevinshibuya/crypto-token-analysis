import { describe, it, expect } from 'vitest';
import { detectMaCross, detectPriceMaCross } from '../src/signals/maSignals';
import { candle, ctxWith } from './fixtures';

const candles = [1, 2, 3, 4].map((t) => candle(t, 10, 11, 9, t === 3 ? 10.6 : 10));

describe('detectMaCross', () => {
  it('emits golden and death crosses', () => {
    const ctx = ctxWith({
      maFast: [9.0, 9.5, 10.5, 9.4],
      maSlow: [10.0, 10.0, 10.0, 10.0],
    });
    expect(detectMaCross(candles, ctx)).toEqual([
      { kind: 'ma-golden-cross', direction: 'bullish', index: 2, t: 3 },
      { kind: 'ma-death-cross', direction: 'bearish', index: 3, t: 4 },
    ]);
  });
  it('ignores indices with NaN values', () => {
    const ctx = ctxWith({ maFast: [NaN, 11], maSlow: [10, 10] });
    expect(detectMaCross(candles.slice(0, 2), ctx)).toEqual([]);
  });
});

describe('detectPriceMaCross', () => {
  it('emits up-cross when close crosses above the fast MA', () => {
    // closes: 10, 10, 10.6, 10 vs maFast 10.2 flat
    const ctx = ctxWith({ maFast: [10.2, 10.2, 10.2, 10.2] });
    expect(detectPriceMaCross(candles, ctx)).toEqual([
      { kind: 'price-cross-ma-up', direction: 'bullish', index: 2, t: 3 },
      { kind: 'price-cross-ma-down', direction: 'bearish', index: 3, t: 4 },
    ]);
  });
});
