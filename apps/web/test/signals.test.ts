import { describe, it, expect } from 'vitest';
import { buildMarkers, DEFAULT_FAMILIES } from '../src/signals';
import type { Signal } from '../src/api/types';

const sig = (kind: Signal['kind'], direction: Signal['direction'], t: number): Signal =>
  ({ kind, direction, index: 0, t });

describe('buildMarkers', () => {
  it('maps direction to position, shape and color', () => {
    const [up, down] = buildMarkers(
      [sig('hammer', 'bullish', 1000), sig('shooting-star', 'bearish', 2000)],
      DEFAULT_FAMILIES,
    );
    expect(up).toEqual({ time: 1, position: 'belowBar', shape: 'arrowUp', color: '#22c55e', text: 'HAM' });
    expect(down.position).toBe('aboveBar');
    expect(down.shape).toBe('arrowDown');
  });
  it('filters disabled families and sorts by time', () => {
    const markers = buildMarkers(
      [sig('ma-golden-cross', 'bullish', 3000), sig('hammer', 'bullish', 1000), sig('volume-spike-up', 'bullish', 2000)],
      { ...DEFAULT_FAMILIES, volume: false },
    );
    expect(markers.map((m) => m.text)).toEqual(['HAM', 'GX']);
  });
});
