import { describe, it, expect } from 'vitest';
import { DETECTOR_REGISTRY, SIGNAL_KINDS, signalFamily, detectAll } from '../src/detectors';
import { candle, ctxWith } from './fixtures';
import type { PivotLevel } from '../src/types';

describe('registry', () => {
  it('has a detector for all 25 kinds', () => {
    expect(SIGNAL_KINDS).toHaveLength(25);
    for (const kind of SIGNAL_KINDS) expect(typeof DETECTOR_REGISTRY[kind]).toBe('function');
  });
  it('each registry entry returns only its own kind', () => {
    // engulfing fixture emits bullish-engulfing only via its registry slot
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.4, 10.6, 9.3, 10.5)];
    const viaBull = DETECTOR_REGISTRY['bullish-engulfing'](candles, ctxWith());
    const viaBear = DETECTOR_REGISTRY['bearish-engulfing'](candles, ctxWith());
    expect(viaBull.map((s) => s.kind)).toEqual(['bullish-engulfing']);
    expect(viaBear).toEqual([]);
  });
});

describe('signalFamily', () => {
  it('maps kinds to the five families', () => {
    expect(signalFamily('hammer')).toBe('pattern');
    expect(signalFamily('rsi-bullish-divergence')).toBe('rsi');
    expect(signalFamily('ma-golden-cross')).toBe('ma');
    expect(signalFamily('price-cross-ma-up')).toBe('ma');
    expect(signalFamily('volume-spike-down')).toBe('volume');
    expect(signalFamily('sr-break-up')).toBe('sr');
  });
});

describe('detectAll', () => {
  it('yields signals from all five families on a composite fixture, sorted by index', () => {
    const level: PivotLevel = { price: 100, type: 'support', strength: 1, touches: 1 };
    const candles = [
      candle(1, 102, 103, 101.5, 102, 1),
      candle(2, 102, 102.5, 100.2, 101, 1),   // sr-bounce-support
      candle(3, 101.5, 102, 100.9, 101, 9),   // volume spike down (v9 > 2*4)
      candle(4, 101, 101.2, 100.2, 100.3, 1), // bear candle
      candle(5, 100.2, 101.6, 100.1, 101.5, 1), // bullish engulfing
    ];
    const ctx = ctxWith({
      rsi: [NaN, 25, 35, 40, 45],              // oversold exit at index 2
      maFast: [99, 99.5, 100.5, 100.4, 100.6],
      maSlow: [100, 100, 100, 100, 100],       // golden cross at index 2
      volumeSma: [4, 4, 4, 4, 4],
      atr: [2, 2, 2, 2, 2],
      pivots: [level],
    });
    const all = detectAll(candles, ctx);
    const families = new Set(all.map((s) => signalFamily(s.kind)));
    expect(families).toEqual(new Set(['pattern', 'rsi', 'ma', 'volume', 'sr']));
    for (let i = 1; i < all.length; i++) expect(all[i].index).toBeGreaterThanOrEqual(all[i - 1].index);
  });
});

describe('detectAll dedupe', () => {
  it('output equals the per-kind registry dispatch (behavior-preserving)', () => {
    const level: PivotLevel = { price: 100, type: 'support', strength: 1, touches: 1 };
    const candles = [
      candle(1, 102, 103, 101.5, 102, 1),
      candle(2, 102, 102.5, 100.2, 101, 1),
      candle(3, 101.5, 102, 100.9, 101, 9),
      candle(4, 101, 101.2, 100.2, 100.3, 1),
      candle(5, 100.2, 101.6, 100.1, 101.5, 1),
    ];
    const ctx = ctxWith({
      rsi: [NaN, 25, 35, 40, 45],
      maFast: [99, 99.5, 100.5, 100.4, 100.6],
      maSlow: [100, 100, 100, 100, 100],
      volumeSma: [4, 4, 4, 4, 4],
      atr: [2, 2, 2, 2, 2],
      pivots: [level],
    });
    const viaRegistry = SIGNAL_KINDS
      .flatMap((kind) => DETECTOR_REGISTRY[kind](candles, ctx))
      .sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
    expect(detectAll(candles, ctx)).toEqual(viaRegistry);
  });
});
