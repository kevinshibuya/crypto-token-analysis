import { describe, it, expect } from 'vitest';
import * as core from '../src/index';

describe('core index', () => {
  it('re-exports every public function', () => {
    for (const name of ['sma', 'ema', 'rsi', 'volume', 'volumeProfile', 'pivots']) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
