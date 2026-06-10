import type { DB } from './db';

export class BacktestStore {
  constructor(private db: DB) {}

  get(coin: string, interval: string, configHash: string, lastCandleT: number): unknown | null {
    const row = this.db
      .prepare(
        `SELECT payload FROM backtest_results
         WHERE coin = ? AND interval = ? AND configHash = ? AND lastCandleT = ?`,
      )
      .get(coin, interval, configHash, lastCandleT) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }

  set(coin: string, interval: string, configHash: string, lastCandleT: number, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO backtest_results (coin, interval, configHash, lastCandleT, payload, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(coin, interval, configHash, lastCandleT) DO UPDATE SET
           payload=excluded.payload, createdAt=excluded.createdAt`,
      )
      .run(coin, interval, configHash, lastCandleT, JSON.stringify(payload), Date.now());
  }
}
