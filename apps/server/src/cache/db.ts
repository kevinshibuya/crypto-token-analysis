import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      coin TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, n INTEGER,
      PRIMARY KEY (coin, interval, t)
    );
    CREATE TABLE IF NOT EXISTS markets (
      name TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backtest_results (
      coin TEXT NOT NULL, interval TEXT NOT NULL,
      configHash TEXT NOT NULL, lastCandleT INTEGER NOT NULL,
      payload TEXT NOT NULL, createdAt INTEGER NOT NULL,
      PRIMARY KEY (coin, interval, configHash, lastCandleT)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, kind TEXT NOT NULL, identity TEXT NOT NULL,
      coin TEXT NOT NULL, interval TEXT NOT NULL,
      payload TEXT NOT NULL, delivered TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alerts_ts ON alerts (ts DESC);
    CREATE TABLE IF NOT EXISTS alert_dedupe (
      identity TEXT NOT NULL, kind TEXT NOT NULL, lastFiredAt INTEGER NOT NULL,
      PRIMARY KEY (identity, kind)
    );
  `);
  return db;
}
