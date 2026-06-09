import { describe, it, expect } from 'vitest';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import type { Candle } from '@cta/core';

const c = (t: number): Candle => ({ t, o: 1, h: 2, l: 0, c: 1.5, v: 10, n: 3 });

describe('CandleStore', () => {
  it('upserts and reads candles back in range', () => {
    const store = new CandleStore(openDb(':memory:'));
    store.upsert('BTC', '1h', [c(1), c(2), c(3)]);
    expect(store.get('BTC', '1h', 2, 3)).toEqual([c(2), c(3)]);
    expect(store.latestTime('BTC', '1h')).toBe(3);
  });

  it('updates on conflict instead of duplicating', () => {
    const store = new CandleStore(openDb(':memory:'));
    store.upsert('BTC', '1h', [c(1)]);
    store.upsert('BTC', '1h', [{ ...c(1), c: 9 }]);
    const rows = store.get('BTC', '1h', 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].c).toBe(9);
  });

  it('returns null latestTime for an unknown series', () => {
    const store = new CandleStore(openDb(':memory:'));
    expect(store.latestTime('ETH', '1h')).toBeNull();
  });

  it('coalesces a stored NULL trade count back to undefined (not null)', () => {
    const store = new CandleStore(openDb(':memory:'));
    store.upsert('BTC', '1h', [{ t: 1, o: 1, h: 2, l: 0, c: 1.5, v: 10 }]); // no `n` -> stored as SQL NULL
    const rows = store.get('BTC', '1h', 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBeUndefined();   // undefined, NOT null (proves the coalescing)
  });
});
