import { describe, it, expect } from 'vitest';
import { detectStars, detectSoldiersCrows } from '../src/patterns/threeCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectStars', () => {
  it('flags a morning star', () => {
    const candles = [
      candle(1, 10, 10.1, 8.9, 9),       // long bear, body 1, midpoint 9.5
      candle(2, 8.9, 9.2, 8.7, 9.1),     // small body .2
      candle(3, 9.1, 9.8, 9.0, 9.7),     // bull closing above 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([
      { kind: 'morning-star', direction: 'bullish', index: 2, t: 3 },
    ]);
  });
  it('flags an evening star', () => {
    const candles = [
      candle(1, 9, 10.1, 8.9, 10),       // long bull, midpoint 9.5
      candle(2, 10.1, 10.3, 9.9, 10.2),  // small body
      candle(3, 10, 10.1, 9.2, 9.3),     // bear closing below 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([
      { kind: 'evening-star', direction: 'bearish', index: 2, t: 3 },
    ]);
  });
  it('rejects when the third candle stops short of the midpoint', () => {
    const candles = [
      candle(1, 10, 10.1, 8.9, 9),
      candle(2, 8.9, 9.2, 8.7, 9.1),
      candle(3, 9.1, 9.4, 9.0, 9.3),     // 9.3 < 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([]);
  });
});

describe('detectSoldiersCrows', () => {
  it('flags three white soldiers', () => {
    const candles = [
      candle(1, 9.0, 9.6, 8.95, 9.5),    // bull, body .5 / range .65
      candle(2, 9.3, 10.1, 9.25, 10.0),  // opens inside [9.0, 9.5], closes higher
      candle(3, 9.8, 10.6, 9.75, 10.5),  // opens inside [9.3, 10.0], closes higher
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([
      { kind: 'three-white-soldiers', direction: 'bullish', index: 2, t: 3 },
    ]);
  });
  it('flags three black crows', () => {
    const candles = [
      candle(1, 10.5, 10.55, 9.9, 10.0),
      candle(2, 10.2, 10.25, 9.4, 9.5),
      candle(3, 9.7, 9.75, 8.9, 9.0),
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([
      { kind: 'three-black-crows', direction: 'bearish', index: 2, t: 3 },
    ]);
  });
  it('rejects when an open gaps outside the previous body', () => {
    const candles = [
      candle(1, 9.0, 9.6, 8.95, 9.5),
      candle(2, 9.55, 10.1, 9.5, 10.0),  // opens above prev close 9.5 — gap, not inside
      candle(3, 9.8, 10.6, 9.75, 10.5),
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([]);
  });
});
