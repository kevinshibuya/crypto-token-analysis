import type { SetupResult } from '../backtest/scan';
import type { SetupGate } from './types';

/** Scan results arrive ranked; the gate filters and caps without reordering. */
export function qualifySetups(results: SetupResult[], gate: SetupGate): SetupResult[] {
  return results
    .filter((r) => r.metrics.trades >= gate.minTrades && r.metrics.expectancy >= gate.minExpectancy)
    .slice(0, gate.topN);
}
