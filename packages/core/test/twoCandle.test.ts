import { describe, it, expect } from 'vitest';
import { detectEngulfing, detectHarami } from '../src/patterns/twoCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectEngulfing', () => {
  it('flags a bullish engulfing', () => {
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.4, 10.6, 9.3, 10.5)];
    expect(detectEngulfing(candles, ctx)).toEqual([
      { kind: 'bullish-engulfing', direction: 'bullish', index: 1, t: 2 },
    ]);
  });
  it('flags a bearish engulfing', () => {
    const candles = [candle(1, 9.5, 10.1, 9.4, 10), candle(2, 10.1, 10.2, 9.3, 9.4)];
    expect(detectEngulfing(candles, ctx)).toEqual([
      { kind: 'bearish-engulfing', direction: 'bearish', index: 1, t: 2 },
    ]);
  });
  it('rejects when the second body does not cover the first', () => {
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.6, 10.0, 9.5, 9.9)];
    expect(detectEngulfing(candles, ctx)).toEqual([]);
  });
});

describe('detectHarami', () => {
  it('flags a bullish harami inside a long bear body', () => {
    // prev: body 1.0 of range 1.2 (long); cur bull inside [9, 10]
    const candles = [candle(1, 10, 10.1, 8.9, 9), candle(2, 9.3, 9.8, 9.2, 9.7)];
    expect(detectHarami(candles, ctx)).toEqual([
      { kind: 'bullish-harami', direction: 'bullish', index: 1, t: 2 },
    ]);
  });
  it('flags a bearish harami inside a long bull body', () => {
    const candles = [candle(1, 9, 10.1, 8.9, 10), candle(2, 9.7, 9.8, 9.2, 9.3)];
    expect(detectHarami(candles, ctx)).toEqual([
      { kind: 'bearish-harami', direction: 'bearish', index: 1, t: 2 },
    ]);
  });
  it('rejects when the first body is not long', () => {
    // prev body .2 of range 1.2 — not >= 60%
    const candles = [candle(1, 9.3, 10, 8.8, 9.1), candle(2, 9.15, 9.3, 9.1, 9.25)];
    expect(detectHarami(candles, ctx)).toEqual([]);
  });
});
