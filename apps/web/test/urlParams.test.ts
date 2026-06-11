import { describe, expect, it } from 'vitest';
import { applyUrlParams } from '../src/urlParams';

const defaults = { coin: 'BTC', interval: '1h' as const };

describe('applyUrlParams', () => {
  it('applies coin and interval from a search string', () => {
    expect(applyUrlParams(defaults, '?coin=ETH&interval=4h')).toEqual({ coin: 'ETH', interval: '4h' });
  });
  it('uppercases the coin', () => {
    expect(applyUrlParams(defaults, '?coin=sol')).toEqual({ coin: 'SOL', interval: '1h' });
  });
  it('ignores an unsupported interval', () => {
    expect(applyUrlParams(defaults, '?coin=ETH&interval=7h')).toEqual({ coin: 'ETH', interval: '1h' });
  });
  it('returns defaults for an empty search', () => {
    expect(applyUrlParams(defaults, '')).toEqual(defaults);
    expect(applyUrlParams(defaults, '?')).toEqual(defaults);
  });
  it('ignores empty values', () => {
    expect(applyUrlParams(defaults, '?coin=&interval=')).toEqual(defaults);
  });
});
