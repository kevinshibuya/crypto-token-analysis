import { describe, expect, it } from 'vitest';
import type { SetupMetrics } from '@cta/core';
import { openDb } from '../src/cache/db';
import { MaSelectionStore, type MaSelectionRow } from '../src/cache/maSelectionStore';

const metrics = (expectancy: number, trades: number): SetupMetrics => ({
  trades, wins: Math.floor(trades / 2), winRate: 0.5, avgR: expectancy, profitFactor: 1.5,
  expectancy, maxDrawdownR: 2, filtered: 0, longTrades: trades, shortTrades: 0,
});

const row = (coin: string, interval: string): MaSelectionRow => ({
  coin, interval,
  fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 },
  setupKinds: ['ma-golden-cross', 'volume-spike-up'],
  train: metrics(0.5, 30), validation: metrics(0.4, 10),
  baselineSetupKinds: ['ma-golden-cross'],
  baselineTrain: metrics(0.2, 25), baselineValidation: metrics(0.1, 9),
  candleCount: 2000, splitIndex: 1400, selectedAt: 1_700_000_000_000,
});

describe('MaSelectionStore', () => {
  it('upserts, reads back, and lists rows with JSON round-trip intact', () => {
    const store = new MaSelectionStore(openDb(':memory:'));
    const r = row('BTC', '1h');
    store.upsert(r);
    expect(store.get('BTC', '1h')).toEqual(r);
    expect(store.get('BTC', '4h')).toBeNull();
    store.upsert(row('ETH', '15m'));
    expect(store.all()).toHaveLength(2);
  });

  it('upsert replaces the existing coin×interval row', () => {
    const store = new MaSelectionStore(openDb(':memory:'));
    store.upsert(row('BTC', '1h'));
    const updated = { ...row('BTC', '1h'), fast: { type: 'SMA' as const, period: 9 }, selectedAt: 2 };
    store.upsert(updated);
    expect(store.all()).toHaveLength(1);
    expect(store.get('BTC', '1h')).toEqual(updated);
  });

  it('handles null baseline fields', () => {
    const store = new MaSelectionStore(openDb(':memory:'));
    const r = { ...row('SOL', '4h'), baselineSetupKinds: null, baselineTrain: null, baselineValidation: null };
    store.upsert(r);
    expect(store.get('SOL', '4h')).toEqual(r);
  });

  it('remove deletes and reports whether a row existed', () => {
    const store = new MaSelectionStore(openDb(':memory:'));
    store.upsert(row('BTC', '1h'));
    expect(store.remove('BTC', '1h')).toBe(true);
    expect(store.remove('BTC', '1h')).toBe(false);
    expect(store.get('BTC', '1h')).toBeNull();
  });
});
