import { describe, it, expect } from 'vitest';
import { detectDoji, detectHammer, detectShootingStar } from '../src/patterns/singleCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectDoji', () => {
  it('flags a doji after a bull candle as bearish', () => {
    const candles = [candle(1, 10, 11, 9.5, 11), candle(2, 10.5, 11, 10, 10.52)];
    const s = detectDoji(candles, ctx);
    expect(s).toEqual([{ kind: 'doji', direction: 'bearish', index: 1, t: 2 }]);
  });
  it('ignores a candle whose body exceeds 10% of range', () => {
    const candles = [candle(1, 10, 11, 9.5, 11), candle(2, 10.5, 11, 10, 10.7)];
    expect(detectDoji(candles, ctx)).toEqual([]);
  });
});

describe('detectHammer', () => {
  it('flags a long lower wick with tiny upper wick as bullish', () => {
    // range 1, body .15, lowerWick .8, upperWick .05
    const candles = [candle(1, 9.8, 10, 9, 9.95)];
    const s = detectHammer(candles, ctx);
    expect(s).toEqual([{ kind: 'hammer', direction: 'bullish', index: 0, t: 1 }]);
  });
  it('rejects when the upper wick is larger than the body', () => {
    // upperWick .3 > body .15
    const candles = [candle(1, 9.5, 9.95, 9, 9.65)];
    expect(detectHammer(candles, ctx)).toEqual([]);
  });
});

describe('detectShootingStar', () => {
  it('flags a long upper wick as bearish', () => {
    // mirror of the hammer: body .15 at the bottom, upperWick .8
    const candles = [candle(1, 9.2, 10, 9, 9.05)];
    const s = detectShootingStar(candles, ctx);
    expect(s).toEqual([{ kind: 'shooting-star', direction: 'bearish', index: 0, t: 1 }]);
  });
  it('rejects a doji-sized body', () => {
    const candles = [candle(1, 9.24, 10, 9.2, 9.2)];
    expect(detectShootingStar(candles, ctx)).toEqual([]);
  });
});
