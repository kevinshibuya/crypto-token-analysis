import { describe, it, expect } from 'vitest';
import { simulate } from '../src/backtest/simulate';
import { candle } from './fixtures';
import type { Signal, SignalDirection } from '../src/types';

const cfg = { atrFloorMult: 0.5, atrCapMult: 10, minRR: 1, breakevenAtR: 1 };
const sig = (index: number, direction: SignalDirection = 'bullish'): Signal =>
  ({ kind: 'hammer', direction, index, t: index + 1 });
const atrFlat = (n: number) => Array(n).fill(2);
// base long bracket from entry 100, pivots [95, 110], atr 2: stop 94.8 (risk 5.2), target 110
const c0 = candle(1, 100, 101, 99, 100);

describe('simulate', () => {
  it('hits the target', () => {
    const candles = [c0, candle(2, 100, 111, 99, 110)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades).toHaveLength(1);
    expect(trades[0].reason).toBe('target');
    expect(trades[0].r).toBeCloseTo(10 / 5.2, 10);
  });

  it('hits the stop for -1R', () => {
    const candles = [c0, candle(2, 100, 101, 94, 95)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].r).toBeCloseTo(-1, 10);
  });

  it('counts a candle touching both stop and target as a stop (conservative)', () => {
    const candles = [c0, candle(2, 100, 111, 94, 100)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].r).toBeCloseTo(-1, 10);
  });

  it('moves the stop to breakeven after +1R, effective next candle', () => {
    const candles = [
      c0,
      candle(2, 100, 106, 99, 105),   // touches 105.2? no: h=106 >= 100 + 5.2 → BE armed
      candle(3, 105, 106, 100, 101),  // stop now 100 → exit at 100
    ];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBe(100);
    expect(trades[0].r).toBeCloseTo(0, 10);
  });

  it('ratchets the stop behind a cleared level', () => {
    // Floor-clamped bracket: pivots [99.5, 100.8], atr 2, floor 0.5*2=1.
    // stopDist raw 0.7 -> floor 1 -> stop 99 (risk 1); targetDist raw 0.8 -> floor 1 -> target 101.
    // Pivot 100.8 sits between entry and target, so clearing it ratchets the stop to 100.6.
    const candles = [
      c0,
      candle(2, 100, 100.95, 99.5, 100.9),     // closes above 100.8 → stop ratchets to 100.6
      candle(3, 100.9, 100.95, 100.5, 100.55), // l 100.5 <= 100.6 → exit at 100.6
    ];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [99.5, 100.8], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBeCloseTo(100.6, 10);
    expect(trades[0].r).toBeCloseTo(0.6, 10);
  });

  it('exits at next open on an opposite setup signal', () => {
    const candles = [c0, candle(2, 100, 104, 99, 103), candle(3, 103, 104, 102, 102.5)];
    const setupSignals = [sig(0), sig(1, 'bearish')];
    const { trades } = simulate(candles, [sig(0)], setupSignals, [95, 110], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('opposite-signal');
    expect(trades[0].exitPrice).toBe(103);
    expect(trades[0].r).toBeCloseTo(3 / 5.2, 10);
  });

  it('closes still-open trades at the final candle as end-of-data', () => {
    const candles = [c0, candle(2, 100, 104, 99, 103)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('end-of-data');
    expect(trades[0].exitPrice).toBe(103);
  });

  it('counts R/R-filtered entries without trading them', () => {
    const out = simulate([c0, candle(2, 100, 111, 99, 110)], [sig(0)], [sig(0)], [95, 110], atrFlat(2), { ...cfg, minRR: 3 });
    expect(out.trades).toHaveLength(0);
    expect(out.filtered).toBe(1);
  });

  it('simulates shorts symmetrically', () => {
    const candles = [c0, candle(2, 100, 101, 89, 90)];
    const { trades } = simulate(candles, [sig(0, 'bearish')], [sig(0, 'bearish')], [90, 105], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('target');
    expect(trades[0].r).toBeCloseTo(10 / 5.2, 10);
  });

  it('ratchets a short stop behind a cleared level below entry', () => {
    // Mirror of the long ratchet: pivots [99.2, 100.5], atr 2, floor 1.
    // stopDist raw 0.7 -> floor 1 -> stop 101 (risk 1); targetDist raw 0.8 -> floor 1 -> target 99.
    // Pivot 99.2 sits between target and entry; closing below it ratchets the stop to 99.4.
    const candles = [
      c0,
      candle(2, 100, 100.1, 99.05, 99.1),  // closes below 99.2 → stop ratchets to 99.4
      candle(3, 99.1, 99.5, 99.05, 99.45), // h 99.5 >= 99.4 → exit at 99.4
    ];
    const { trades } = simulate(candles, [sig(0, 'bearish')], [sig(0, 'bearish')], [99.2, 100.5], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBeCloseTo(99.4, 10);
    expect(trades[0].r).toBeCloseTo(0.6, 10);
  });

  it('moves a short stop to breakeven after +1R, effective next candle', () => {
    // Short from 100 with pivots [90, 105], atr 2: stop 105.2 (risk 5.2), target 90; BE level 94.8.
    const candles = [
      c0,
      candle(2, 100, 101, 94, 95),       // l 94 <= 94.8 → BE armed (target 90 untouched)
      candle(3, 95, 100.5, 94.5, 96),    // stop now 100 → exit at 100
    ];
    const { trades } = simulate(candles, [sig(0, 'bearish')], [sig(0, 'bearish')], [90, 105], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBe(100);
    expect(trades[0].r).toBeCloseTo(0, 10);
  });

  it('skips entries while a position is open', () => {
    const candles = [c0, candle(2, 100, 101, 99.5, 100.5), candle(3, 100.5, 111, 100, 110)];
    const { trades } = simulate(candles, [sig(0), sig(1)], [sig(0), sig(1)], [95, 110], atrFlat(3), cfg);
    expect(trades).toHaveLength(1);
  });
});
