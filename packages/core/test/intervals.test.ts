import { describe, it, expect } from 'vitest';
import { SUPPORTED_INTERVALS } from '../src/intervals';

describe('SUPPORTED_INTERVALS', () => {
  it('contains the 14 Hyperliquid intervals in ascending order', () => {
    expect(SUPPORTED_INTERVALS).toEqual([
      '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
    ]);
  });
});
