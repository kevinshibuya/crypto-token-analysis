import { describe, it, expect } from 'vitest';
import { computeBracket } from '../src/backtest/bracket';

const cfg = { atrFloorMult: 0.5, atrCapMult: 10, minRR: 1.5 };

describe('computeBracket', () => {
  it('places a structure-based long bracket', () => {
    const b = computeBracket(100, 'bullish', [95, 110], 2, cfg)!;
    // stop = 95 - 0.1*2 = 94.8 (dist 5.2); target = 110 (dist 10); rr ≈ 1.923
    expect(b.stop).toBeCloseTo(94.8, 10);
    expect(b.target).toBe(110);
    expect(b.rr).toBeCloseTo(10 / 5.2, 10);
  });

  it('places a structure-based short bracket', () => {
    const b = computeBracket(100, 'bearish', [90, 105], 2, cfg)!;
    expect(b.stop).toBeCloseTo(105.2, 10);
    expect(b.target).toBe(90);
    expect(b.rr).toBeCloseTo(10 / 5.2, 10);
  });

  it('applies the ATR floor when structure is too close', () => {
    const b = computeBracket(100, 'bullish', [99.9, 110], 2, cfg)!;
    // raw dist 0.3 < floor 1 → stop 99
    expect(b.stop).toBeCloseTo(99, 10);
    expect(b.rr).toBeCloseTo(10, 10);
  });

  it('applies the ATR cap on both sides', () => {
    const b = computeBracket(100, 'bullish', [50, 200], 2, { ...cfg, minRR: 1 })!;
    // raw stop dist 50.2 → cap 20; raw target dist 100 → cap 20
    expect(b.stop).toBeCloseTo(80, 10);
    expect(b.target).toBeCloseTo(120, 10);
    expect(b.rr).toBeCloseTo(1, 10);
  });

  it('falls back to ATR-only when structure is missing', () => {
    const b = computeBracket(100, 'bullish', [], 2, cfg)!;
    // stopDist 3 (1.5*atr), targetDist 6 (2*stopDist)
    expect(b.stop).toBeCloseTo(97, 10);
    expect(b.target).toBeCloseTo(106, 10);
    expect(b.rr).toBe(2);
  });

  it('returns null when R/R is below the minimum', () => {
    expect(computeBracket(100, 'bullish', [95, 102], 2, cfg)).toBeNull();
  });
});
