import type { MaSpec, SetupMetrics, SignalKind } from '@cta/core';
import type { DB } from './db';

export interface MaSelectionRow {
  coin: string;
  interval: string;
  fast: MaSpec;
  slow: MaSpec;
  setupKinds: SignalKind[];
  train: SetupMetrics;
  validation: SetupMetrics;
  baselineSetupKinds: SignalKind[] | null;
  baselineTrain: SetupMetrics | null;
  baselineValidation: SetupMetrics | null;
  candleCount: number;
  splitIndex: number;
  selectedAt: number;
}

interface DbRow {
  coin: string; interval: string;
  fastType: string; fastPeriod: number; slowType: string; slowPeriod: number;
  setupKinds: string; train: string; validation: string;
  baselineSetupKinds: string | null; baselineTrain: string | null; baselineValidation: string | null;
  candleCount: number; splitIndex: number; selectedAt: number;
}

const parse = (r: DbRow): MaSelectionRow => ({
  coin: r.coin,
  interval: r.interval,
  fast: { type: r.fastType as MaSpec['type'], period: r.fastPeriod },
  slow: { type: r.slowType as MaSpec['type'], period: r.slowPeriod },
  setupKinds: JSON.parse(r.setupKinds),
  train: JSON.parse(r.train),
  validation: JSON.parse(r.validation),
  baselineSetupKinds: r.baselineSetupKinds ? JSON.parse(r.baselineSetupKinds) : null,
  baselineTrain: r.baselineTrain ? JSON.parse(r.baselineTrain) : null,
  baselineValidation: r.baselineValidation ? JSON.parse(r.baselineValidation) : null,
  candleCount: r.candleCount,
  splitIndex: r.splitIndex,
  selectedAt: r.selectedAt,
});

export class MaSelectionStore {
  constructor(private db: DB) {}

  upsert(row: MaSelectionRow): void {
    this.db.prepare(
      `INSERT INTO ma_selection (coin, interval, fastType, fastPeriod, slowType, slowPeriod,
         setupKinds, train, validation, baselineSetupKinds, baselineTrain, baselineValidation,
         candleCount, splitIndex, selectedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(coin, interval) DO UPDATE SET
         fastType = excluded.fastType, fastPeriod = excluded.fastPeriod,
         slowType = excluded.slowType, slowPeriod = excluded.slowPeriod,
         setupKinds = excluded.setupKinds, train = excluded.train, validation = excluded.validation,
         baselineSetupKinds = excluded.baselineSetupKinds, baselineTrain = excluded.baselineTrain,
         baselineValidation = excluded.baselineValidation, candleCount = excluded.candleCount,
         splitIndex = excluded.splitIndex, selectedAt = excluded.selectedAt`,
    ).run(
      row.coin, row.interval, row.fast.type, row.fast.period, row.slow.type, row.slow.period,
      JSON.stringify(row.setupKinds), JSON.stringify(row.train), JSON.stringify(row.validation),
      row.baselineSetupKinds ? JSON.stringify(row.baselineSetupKinds) : null,
      row.baselineTrain ? JSON.stringify(row.baselineTrain) : null,
      row.baselineValidation ? JSON.stringify(row.baselineValidation) : null,
      row.candleCount, row.splitIndex, row.selectedAt,
    );
  }

  get(coin: string, interval: string): MaSelectionRow | null {
    const r = this.db
      .prepare(`SELECT * FROM ma_selection WHERE coin = ? AND interval = ?`)
      .get(coin, interval) as DbRow | undefined;
    return r ? parse(r) : null;
  }

  all(): MaSelectionRow[] {
    const rows = this.db.prepare(`SELECT * FROM ma_selection`).all() as DbRow[];
    return rows.map(parse);
  }

  remove(coin: string, interval: string): boolean {
    return this.db.prepare(`DELETE FROM ma_selection WHERE coin = ? AND interval = ?`).run(coin, interval).changes > 0;
  }
}
