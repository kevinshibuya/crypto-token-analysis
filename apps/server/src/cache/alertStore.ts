// apps/server/src/cache/alertStore.ts
import type { DB } from './db';

export type AlertKind = 'provisional-new' | 'provisional-confirmed' | 'provisional-withdrawn' | 'confirmed-new' | 'digest';

export interface AlertRow {
  ts: number;
  kind: AlertKind;
  identity: string;
  coin: string;
  interval: string;
  payload: unknown;       // full PlanAlert JSON (message-independent)
  delivered: string[];    // sink names that accepted the alert
}

export class AlertStore {
  constructor(private db: DB) {}

  insert(row: AlertRow): void {
    this.db.prepare(
      `INSERT INTO alerts (ts, kind, identity, coin, interval, payload, delivered)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.ts, row.kind, row.identity, row.coin, row.interval, JSON.stringify(row.payload), JSON.stringify(row.delivered));
  }

  recent(limit: number): AlertRow[] {
    const rows = this.db
      .prepare(`SELECT ts, kind, identity, coin, interval, payload, delivered FROM alerts ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(limit) as { ts: number; kind: AlertKind; identity: string; coin: string; interval: string; payload: string; delivered: string }[];
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload), delivered: JSON.parse(r.delivered) }));
  }

  lastFired(identity: string, kind: AlertKind): number | null {
    const row = this.db
      .prepare(`SELECT lastFiredAt FROM alert_dedupe WHERE identity = ? AND kind = ?`)
      .get(identity, kind) as { lastFiredAt: number } | undefined;
    return row?.lastFiredAt ?? null;
  }

  markFired(identity: string, kind: AlertKind, ts: number): void {
    this.db.prepare(
      `INSERT INTO alert_dedupe (identity, kind, lastFiredAt) VALUES (?, ?, ?)
       ON CONFLICT(identity, kind) DO UPDATE SET lastFiredAt = excluded.lastFiredAt`,
    ).run(identity, kind, ts);
  }

  /** `identity|kind` → lastFiredAt, for in-memory cache priming at boot (hot path never hits SQLite). */
  allFired(): Map<string, number> {
    const rows = this.db.prepare(`SELECT identity, kind, lastFiredAt FROM alert_dedupe`).all() as
      { identity: string; kind: string; lastFiredAt: number }[];
    return new Map(rows.map((r) => [`${r.identity}|${r.kind}`, r.lastFiredAt]));
  }
}
