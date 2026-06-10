import type { DB } from './db';

export interface MarketRow {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  dayNtlVlm: number; // 24h notional volume
}

export class MarketStore {
  constructor(private db: DB) {}

  get(): { markets: MarketRow[]; updatedAt: number } | null {
    const row = this.db.prepare(`SELECT data, updatedAt FROM markets WHERE name = '__all__'`).get() as
      | { data: string; updatedAt: number }
      | undefined;
    if (!row) return null;
    return {
      markets: (JSON.parse(row.data) as MarketRow[]).map((m) => ({ dayNtlVlm: 0, ...m })),
      updatedAt: row.updatedAt,
    };
  }

  set(markets: MarketRow[], updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO markets (name, data, updatedAt) VALUES ('__all__', ?, ?)
         ON CONFLICT(name) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`,
      )
      .run(JSON.stringify(markets), updatedAt);
  }
}
