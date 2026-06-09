import type { Candle } from '@cta/core';
import type { DB } from './db';

interface CandleRow {
  t: number; o: number; h: number; l: number; c: number; v: number; n: number | null;
}

export class CandleStore {
  constructor(private db: DB) {}

  upsert(coin: string, interval: string, candles: Candle[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO candles (coin, interval, t, o, h, l, c, v, n)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(coin, interval, t) DO UPDATE SET
         o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v, n=excluded.n`,
    );
    const tx = this.db.transaction((rows: Candle[]) => {
      for (const r of rows) stmt.run(coin, interval, r.t, r.o, r.h, r.l, r.c, r.v, r.n ?? null);
    });
    tx(candles);
  }

  get(coin: string, interval: string, from: number, to: number): Candle[] {
    const rows = this.db
      .prepare(
        `SELECT t, o, h, l, c, v, n FROM candles
         WHERE coin = ? AND interval = ? AND t >= ? AND t <= ? ORDER BY t ASC`,
      )
      .all(coin, interval, from, to) as CandleRow[];
    return rows.map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, n: r.n ?? undefined }));
  }

  latestTime(coin: string, interval: string): number | null {
    const row = this.db
      .prepare(`SELECT MAX(t) AS maxT FROM candles WHERE coin = ? AND interval = ?`)
      .get(coin, interval) as { maxT: number | null };
    return row.maxT ?? null;
  }

  earliestTime(coin: string, interval: string): number | null {
    const row = this.db
      .prepare(`SELECT MIN(t) AS minT FROM candles WHERE coin = ? AND interval = ?`)
      .get(coin, interval) as { minT: number | null };
    return row.minT ?? null;
  }
}
