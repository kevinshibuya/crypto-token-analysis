# Phase 4B — Live Dashboard + Nightly MA Optimizer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 4A engine *visible* (SSE-driven live dashboard: auto-updating scanner, alert feed, health chip, served 24/7 by the Fastify server) and *self-tuning* (nightly walk-forward MA optimizer that replaces EMA50/SMA200 per coin×timeframe only when a challenger provably wins out-of-sample).

**Architecture:** A pure walk-forward grid-search function in `@cta/core` runs inside the existing worker pool as a new job kind, orchestrated by a nightly `MaOptimizer` that yields to live scans and persists selections to a `ma_selection` SQLite table; the engine injects stored selections into `analyzeCoin` config per coin×timeframe (close-scan AND tick paths). A `LiveFeed` SSE hub fans engine events (`scan`/`alert`/`health`) out to any number of `GET /live` clients with per-client drop-oldest buffering and a snapshot replay on connect. The web app gains a Live scanner mode, an alert-feed view, a toolbar health chip, and `?coin=&interval=` deep-link parsing; `@fastify/static` serves `apps/web/dist` so it all works unattended.

**Tech Stack:** TypeScript ESM, Node 22, tsx, Fastify 4, better-sqlite3, `@fastify/static` (new dep, ^7 for Fastify 4), native `EventSource` (browser) / raw SSE over `http` (server — no new dep), React 18 + vitest/jsdom, puppeteer-core e2e with system Chrome.

**Spec:** `docs/superpowers/specs/2026-06-11-phase4b-live-dashboard-ma-design.md`

## Task → Model table (per CLAUDE.md ladder; ONE consolidated spec+quality reviewer per task, tier-matched)

| Task | Title | Difficulty | Model |
|---|---|---|---|
| 1 | core: walk-forward MA grid optimizer | deep | fable |
| 2 | `ma_selection` table + MaSelectionStore | easy | sonnet |
| 3 | worker + pool: `optimize-ma` job kind | standard | opus |
| 4 | engine config: `optimizer` block | easy | sonnet |
| 5 | MaOptimizer (nightly schedule, scan-yielding, persistence) | deep | fable |
| 6 | Engine: MA overrides on scan+tick paths, optimizer wiring | deep | fable |
| 7 | `POST /engine/optimize-ma` (loopback-only) | standard | opus |
| 8 | Engine events + AlertEngine `onRecord`/`stop()` | standard | opus |
| 9 | LiveFeed SSE hub (buffering, drop-oldest, heartbeat) | deep | fable |
| 10 | `GET /live` route + snapshot + server wiring | standard | opus |
| 11 | integration test: fake-WS engine with SSE attached | deep | fable |
| 12 | `@fastify/static` web serving | easy | sonnet |
| 13 | web: URL-param parsing helper | easy | sonnet |
| 14 | web: `useLiveFeed` hook | standard | opus |
| 15 | web: HealthChip + Toolbar slot | easy | sonnet |
| 16 | web: ScannerPane Live mode | standard | opus |
| 17 | web: AlertFeedPane + App integration | standard | opus |
| 18 | vite `/live` proxy + ops/deploy docs | easy | sonnet |
| 19 | live e2e `e2e/phase4b.mjs` | deep | fable |

## File structure

```
packages/core/src/
  optimize/maGrid.ts            # NEW pure walk-forward grid search (the only new core module)
  index.ts                      # MODIFY: export maGrid symbols
apps/server/src/
  cache/db.ts                   # MODIFY: ma_selection table
  cache/maSelectionStore.ts     # NEW
  engine/config.ts              # MODIFY: optimizer block
  engine/worker.ts              # MODIFY: job kind union
  engine/workerPool.ts          # MODIFY: PoolJob union + run overloads
  engine/maOptimizer.ts         # NEW nightly orchestrator
  engine/engine.ts              # MODIFY: maOverrides, analysisConfigFor, events, optimizer wiring
  engine/provisional.ts         # MODIFY: AnalyzePlansFn gains (coin, interval)
  engine/alertEngine.ts         # MODIFY: onRecord hook + stop() (flushes digest — 4A parked debt)
  engine/types.ts               # MODIFY: ScanEvent, HealthEvent, LiveSnapshot
  engine/liveFeed.ts            # NEW SSE hub
  routes/live.ts                # NEW GET /live
  routes/optimizeMa.ts          # NEW POST /engine/optimize-ma
  app.ts                        # MODIFY: live/optimizeMa/webDistDir deps
  server.ts                     # MODIFY: wire feed, optimizer route, static dir
apps/web/src/
  urlParams.ts                  # NEW pure ?coin=&interval= parsing
  state/useLiveFeed.ts          # NEW EventSource hook
  components/HealthChip.tsx     # NEW
  components/AlertFeedPane.tsx  # NEW
  components/ScannerPane.tsx    # MODIFY: Live mode
  components/SignalsPanel.tsx   # MODIFY: forward live prop
  components/Toolbar.tsx        # MODIFY: healthChip slot + 'alerts' view
  App.tsx                       # MODIFY: integration (Task 17 owns ALL App changes)
  api/types.ts                  # MODIFY: live payload types
  vite.config.ts                # MODIFY: /live proxy
e2e/phase4b.mjs                 # NEW
docs/ops-mac.md                 # MODIFY: web build deploy step + webOrigin
engine.json.example             # MODIFY: optimizer block + webOrigin
```

## Conventions and 4A errata that bind this plan

- `SignalDirection` is `'bullish' | 'bearish'`. Real `SignalKind`s only (e.g. `'ma-golden-cross'`, `'price-cross-ma-up'`). `SetupMetrics` is the 10-field shape in `packages/core/src/backtest/metrics.ts` (no `losses` field).
- Health route is `GET /api/health` → `{status, uptimeSec, engine?}`.
- Run server tests as `pnpm --filter @cta/server exec vitest run test/<file>.test.ts` — `pnpm --filter @cta/server test -- run` misparses.
- Workers self-register tsx via `tsx/esm/api` (`register()` in `worker.ts`) — do not touch that preamble.
- Subagents MUST NOT run long commands with `run_in_background` (they die at turn end and orphan the process). The live e2e (Task 19) is run by the CONTROLLER in background Bash, never by the implementer subagent.
- MA-involved kinds are exactly those with `signalFamily(kind) === 'ma'`: `ma-golden-cross`, `ma-death-cross`, `price-cross-ma-up`, `price-cross-ma-down`.
- Walk-forward boundary note (design decision, document in code): entries are split train/validation by signal index at `splitIndex`; simulation runs over the full candle array, so a train trade entered near the boundary may exit inside the validation window. This is standard, deterministic, and accepted — do NOT truncate train simulations at the boundary.

---

### Task 1: core — walk-forward MA grid optimizer

**Model:** fable

**Files:**
- Create: `packages/core/src/optimize/maGrid.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/maGrid.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// packages/core/test/maGrid.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildMaGrid, decideChallenger, optimizeMaForSeries, DEFAULT_MA_GRID_GATES,
} from '../src/index';
import type { Candle, SplitEvaluation } from '../src/index';
import { signalFamily } from '../src/detectors';
import { DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';

const metrics = (over: Partial<SetupMetrics>): SetupMetrics => ({
  trades: 0, wins: 0, winRate: 0, avgR: 0, profitFactor: 0, expectancy: 0,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0, ...over,
});
const evaln = (train: Partial<SetupMetrics>, validation: Partial<SetupMetrics>): SplitEvaluation => ({
  kinds: ['ma-golden-cross'], train: metrics(train), validation: metrics(validation),
});

// deterministic PRNG so the synthetic series is identical across runs
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticCandles(n: number): Candle[] {
  const rnd = mulberry32(42);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    // regime waves force MA crosses at several scales; noise adds patterns/volume spikes
    const drift = Math.sin(i / 60) * 0.6 + Math.sin(i / 17) * 0.25;
    const noise = (rnd() - 0.5) * 1.2;
    const o = price;
    const c = Math.max(1, price + drift + noise);
    const h = Math.max(o, c) + rnd() * 0.5;
    const l = Math.min(o, c) - rnd() * 0.5;
    const v = 100 + rnd() * 100 + (rnd() > 0.95 ? 400 : 0);
    out.push({ t: i * 900_000, o, h, l, c, v, n: 10 });
    price = c;
  }
  return out;
}

describe('buildMaGrid', () => {
  it('builds 76 combos, all with fast period < slow period', () => {
    const grid = buildMaGrid();
    expect(grid).toHaveLength(76);
    for (const g of grid) expect(g.fast.period).toBeLessThan(g.slow.period);
    // both type axes present
    expect(grid.some((g) => g.fast.type === 'SMA' && g.slow.type === 'EMA')).toBe(true);
    expect(grid.some((g) => g.fast.type === 'EMA' && g.slow.type === 'SMA')).toBe(true);
  });
});

describe('decideChallenger', () => {
  const gates = DEFAULT_MA_GRID_GATES; // { minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 }
  it('accepts when all gates pass and validation expectancy beats baseline', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 10, expectancy: 0.4 });
    const base = evaln({ trades: 30, expectancy: 0.3 }, { trades: 12, expectancy: 0.2 });
    expect(decideChallenger(best, base, gates)).toBe(true);
  });
  it('rejects when validation expectancy does not beat baseline', () => {
    const best = evaln({ trades: 25, expectancy: 0.9 }, { trades: 10, expectancy: 0.1 });
    const base = evaln({ trades: 30, expectancy: 0.3 }, { trades: 12, expectancy: 0.2 });
    expect(decideChallenger(best, base, gates)).toBe(false);
  });
  it('rejects on too few train trades', () => {
    const best = evaln({ trades: 19, expectancy: 0.5 }, { trades: 10, expectancy: 0.4 });
    expect(decideChallenger(best, null, gates)).toBe(false);
  });
  it('rejects on too few validation trades', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 7, expectancy: 0.4 });
    expect(decideChallenger(best, null, gates)).toBe(false);
  });
  it('treats a null baseline as zero validation expectancy', () => {
    const best = evaln({ trades: 25, expectancy: 0.5 }, { trades: 10, expectancy: 0.01 });
    expect(decideChallenger(best, null, gates)).toBe(true);
    expect(decideChallenger(null, null, gates)).toBe(false);
  });
});

describe('optimizeMaForSeries', () => {
  const input = { detector: DEFAULT_DETECTOR_OPTIONS, backtest: DEFAULT_BACKTEST_CONFIG };

  it('produces a structurally complete, deterministic result on a synthetic series', () => {
    const candles = syntheticCandles(1200);
    const r1 = optimizeMaForSeries(candles, input);
    const r2 = optimizeMaForSeries(candles, input);
    expect(r2).toEqual(r1); // pure
    expect(r1.candleCount).toBe(1200);
    expect(r1.splitIndex).toBe(Math.floor(1200 * 0.7));
    expect(['challenger', 'baseline']).toContain(r1.decision);
    if (r1.decision === 'challenger') {
      expect(r1.selection).toEqual(r1.best!.combo);
      expect(r1.best!.train.trades).toBeGreaterThanOrEqual(DEFAULT_MA_GRID_GATES.minTrainTrades);
      expect(r1.best!.validation.trades).toBeGreaterThanOrEqual(DEFAULT_MA_GRID_GATES.minValidationTrades);
    } else {
      expect(r1.selection).toBeNull();
    }
    // every evaluated setup is MA-involved
    if (r1.best) expect(r1.best.kinds.some((k) => signalFamily(k) === 'ma')).toBe(true);
    if (r1.baseline) expect(r1.baseline.kinds.some((k) => signalFamily(k) === 'ma')).toBe(true);
  });

  it('returns baseline decision with null best on a series too flat for MA signals', () => {
    const flat: Candle[] = Array.from({ length: 300 }, (_, i) =>
      ({ t: i * 900_000, o: 100, h: 100, l: 100, c: 100, v: 1, n: 1 }));
    const r = optimizeMaForSeries(flat, input);
    expect(r.decision).toBe('baseline');
    expect(r.selection).toBeNull();
  });

  it('honors a custom validationFraction', () => {
    const candles = syntheticCandles(1000);
    const r = optimizeMaForSeries(candles, { ...input, gates: { minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.5 } });
    expect(r.splitIndex).toBe(500);
  });
});
```

- [ ] **Step 1.2: Run it to verify it fails**

Run: `pnpm --filter @cta/core exec vitest run test/maGrid.test.ts`
Expected: FAIL — `buildMaGrid` is not exported.

- [ ] **Step 1.3: Implement `packages/core/src/optimize/maGrid.ts`**

```ts
// packages/core/src/optimize/maGrid.ts
import type { Candle, MaType, Signal, SignalKind } from '../types';
import type { DetectorOptions, MaSpec } from '../detectorContext';
import { buildDetectorContext } from '../detectorContext';
import { detectAll, SIGNAL_KINDS, signalFamily } from '../detectors';
import { simulate } from '../backtest/simulate';
import { computeMetrics, type SetupMetrics } from '../backtest/metrics';
import { pairEntries, type BacktestConfig } from '../backtest/scan';

export interface MaGridGates {
  minTrainTrades: number;      // challenger needs ≥ this many train trades
  minValidationTrades: number; // and ≥ this many validation trades
  validationFraction: number;  // newest fraction of candles held out (walk-forward)
}

export const DEFAULT_MA_GRID_GATES: MaGridGates = {
  minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3,
};

export const MA_FAST_PERIODS = [9, 12, 21, 34, 50] as const;
export const MA_SLOW_PERIODS = [50, 100, 150, 200] as const;
const MA_TYPES: MaType[] = ['SMA', 'EMA'];

export interface MaCombo { fast: MaSpec; slow: MaSpec }

/** fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200}, fast period < slow period → 76 combos. */
export function buildMaGrid(): MaCombo[] {
  const out: MaCombo[] = [];
  for (const ft of MA_TYPES) {
    for (const fp of MA_FAST_PERIODS) {
      for (const st of MA_TYPES) {
        for (const sp of MA_SLOW_PERIODS) {
          if (fp >= sp) continue;
          out.push({ fast: { type: ft, period: fp }, slow: { type: st, period: sp } });
        }
      }
    }
  }
  return out;
}

export interface SplitEvaluation {
  kinds: SignalKind[];
  train: SetupMetrics;
  validation: SetupMetrics;
}

export interface MaOptimizationResult {
  decision: 'challenger' | 'baseline';
  selection: MaCombo | null;                            // set iff decision === 'challenger'
  best: (SplitEvaluation & { combo: MaCombo }) | null;  // best challenger even when rejected (audit)
  baseline: SplitEvaluation | null;                     // null if defaults produce no MA setups at all
  splitIndex: number;
  candleCount: number;
}

export interface MaGridInput {
  detector: DetectorOptions; // baseline detector opts; maFast/maSlow here ARE the baseline
  backtest: BacktestConfig;
  gates?: MaGridGates;
}

export function decideChallenger(
  best: SplitEvaluation | null, baseline: SplitEvaluation | null, gates: MaGridGates,
): boolean {
  if (!best) return false;
  if (best.train.trades < gates.minTrainTrades) return false;
  if (best.validation.trades < gates.minValidationTrades) return false;
  const baseExp = baseline ? baseline.validation.expectancy : 0;
  return best.validation.expectancy > baseExp;
}

const better = (a: SplitEvaluation, b: SplitEvaluation): boolean =>
  a.train.expectancy > b.train.expectancy
  || (a.train.expectancy === b.train.expectancy && a.train.trades > b.train.trades);

/**
 * Best MA-involved setup (singles of MA kinds + pairs containing an MA kind) under one MA combo,
 * picked by train expectancy. Setups meeting minTrainTrades are always preferred over those that
 * don't (a 2-trade fluke must not shadow a solid 25-trade setup). Entries are split train/validation
 * by signal index; simulation runs on the full array (boundary trades may exit in the holdout —
 * accepted, see plan conventions).
 */
export function evaluateMaSetups(
  candles: Candle[], detector: DetectorOptions, backtest: BacktestConfig,
  combo: MaCombo, splitIndex: number, minTrainTrades: number,
): SplitEvaluation | null {
  const opts: DetectorOptions = { ...detector, maFast: combo.fast, maSlow: combo.slow };
  const ctx = buildDetectorContext(candles, opts);
  const signals = detectAll(candles, ctx);
  const present = SIGNAL_KINDS.filter((k) => signals.some((s) => s.kind === k));
  const isMa = (k: SignalKind): boolean => signalFamily(k) === 'ma';
  const setups: SignalKind[][] = present.filter(isMa).map((k) => [k]);
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (isMa(present[i]) || isMa(present[j])) setups.push([present[i], present[j]].sort());
    }
  }
  let best: SplitEvaluation | null = null;
  let bestQualified = false;
  for (const kinds of setups) {
    const entries = kinds.length === 1
      ? signals.filter((s) => s.kind === kinds[0])
      : pairEntries(signals, kinds[0], kinds[1], backtest.confluenceWindow);
    const setupSignals = signals.filter((s) => kinds.includes(s.kind));
    const run = (es: Signal[]): SetupMetrics => {
      const sim = simulate(candles, es, setupSignals, ctx.pivotPricesAt, ctx.atr, backtest);
      return computeMetrics(sim.trades, sim.filtered);
    };
    const ev: SplitEvaluation = {
      kinds,
      train: run(entries.filter((e) => e.index < splitIndex)),
      validation: run(entries.filter((e) => e.index >= splitIndex)),
    };
    const qualified = ev.train.trades >= minTrainTrades;
    if (!best || (qualified && !bestQualified) || (qualified === bestQualified && better(ev, best))) {
      best = ev;
      bestQualified = qualified;
    }
  }
  return best;
}

export function optimizeMaForSeries(candles: Candle[], input: MaGridInput): MaOptimizationResult {
  const gates = input.gates ?? DEFAULT_MA_GRID_GATES;
  const splitIndex = Math.floor(candles.length * (1 - gates.validationFraction));
  const baseCombo: MaCombo = { fast: input.detector.maFast, slow: input.detector.maSlow };
  const baseline = evaluateMaSetups(candles, input.detector, input.backtest, baseCombo, splitIndex, gates.minTrainTrades);

  let best: (SplitEvaluation & { combo: MaCombo }) | null = null;
  let bestQualified = false;
  for (const combo of buildMaGrid()) {
    if (combo.fast.type === baseCombo.fast.type && combo.fast.period === baseCombo.fast.period
      && combo.slow.type === baseCombo.slow.type && combo.slow.period === baseCombo.slow.period) continue;
    const ev = evaluateMaSetups(candles, input.detector, input.backtest, combo, splitIndex, gates.minTrainTrades);
    if (!ev) continue;
    const qualified = ev.train.trades >= gates.minTrainTrades;
    if (!best || (qualified && !bestQualified) || (qualified === bestQualified && better(ev, best))) {
      best = { ...ev, combo };
      bestQualified = qualified;
    }
  }

  const wins = decideChallenger(best, baseline, gates);
  return {
    decision: wins ? 'challenger' : 'baseline',
    selection: wins && best ? best.combo : null,
    best,
    baseline,
    splitIndex,
    candleCount: candles.length,
  };
}
```

- [ ] **Step 1.4: Export from `packages/core/src/index.ts`** (append at the end)

```ts
export {
  buildMaGrid, evaluateMaSetups, optimizeMaForSeries, decideChallenger,
  DEFAULT_MA_GRID_GATES, MA_FAST_PERIODS, MA_SLOW_PERIODS,
} from './optimize/maGrid';
export type {
  MaCombo, MaGridGates, MaGridInput, SplitEvaluation, MaOptimizationResult,
} from './optimize/maGrid';
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run: `pnpm --filter @cta/core exec vitest run test/maGrid.test.ts`
Expected: PASS (the synthetic-series test takes a few seconds — 76 combos × full detection).

- [ ] **Step 1.6: Run the full core suite**

Run: `pnpm --filter @cta/core test`
Expected: all green (122 + new).

- [ ] **Step 1.7: Commit**

```bash
git add packages/core/src/optimize/maGrid.ts packages/core/src/index.ts packages/core/test/maGrid.test.ts
git commit -m "feat(core): walk-forward MA grid optimizer with challenger gating"
```

---

### Task 2: `ma_selection` table + MaSelectionStore

**Model:** sonnet

**Files:**
- Modify: `apps/server/src/cache/db.ts`
- Create: `apps/server/src/cache/maSelectionStore.ts`
- Test: `apps/server/test/maSelectionStore.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// apps/server/test/maSelectionStore.test.ts
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
```

- [ ] **Step 2.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/maSelectionStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Add the table to `apps/server/src/cache/db.ts`** — append inside the existing `db.exec(...)` template literal, after the `alert_dedupe` block:

```sql
    CREATE TABLE IF NOT EXISTS ma_selection (
      coin TEXT NOT NULL, interval TEXT NOT NULL,
      fastType TEXT NOT NULL, fastPeriod INTEGER NOT NULL,
      slowType TEXT NOT NULL, slowPeriod INTEGER NOT NULL,
      setupKinds TEXT NOT NULL,
      train TEXT NOT NULL, validation TEXT NOT NULL,
      baselineSetupKinds TEXT, baselineTrain TEXT, baselineValidation TEXT,
      candleCount INTEGER NOT NULL, splitIndex INTEGER NOT NULL,
      selectedAt INTEGER NOT NULL,
      PRIMARY KEY (coin, interval)
    );
```

- [ ] **Step 2.4: Implement `apps/server/src/cache/maSelectionStore.ts`**

```ts
// apps/server/src/cache/maSelectionStore.ts
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
```

- [ ] **Step 2.5: Run the test to verify it passes**

Run: `pnpm --filter @cta/server exec vitest run test/maSelectionStore.test.ts`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/src/cache/db.ts apps/server/src/cache/maSelectionStore.ts apps/server/test/maSelectionStore.test.ts
git commit -m "feat(server): ma_selection table and store"
```

---

### Task 3: worker + pool — `optimize-ma` job kind

**Model:** opus

**Files:**
- Modify: `apps/server/src/engine/worker.ts`
- Modify: `apps/server/src/engine/workerPool.ts`
- Test: `apps/server/test/workerPool.test.ts` (extend)

- [ ] **Step 3.1: Write the failing test** — append to `apps/server/test/workerPool.test.ts` (keep all existing tests; reuse the file's existing pool construction/teardown helpers and logger stub):

```ts
it('runs an optimize-ma job in a worker and returns a MaOptimizationResult', async () => {
  const pool = new WorkerPool({ size: 1, log: nullLogger });
  try {
    const candles = Array.from({ length: 300 }, (_, i) => {
      const c = 100 + Math.sin(i / 25) * 10 + (i % 7) * 0.3;
      return { t: i * 900_000, o: c - 0.2, h: c + 0.6, l: c - 0.6, c, v: 50 + (i % 11) * 10, n: 5 };
    });
    const result = await pool.run({
      kind: 'optimize-ma',
      candles,
      detector: DEFAULT_DETECTOR_OPTIONS,
      backtest: DEFAULT_BACKTEST_CONFIG,
      gates: { minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.3 },
    });
    expect(['challenger', 'baseline']).toContain(result.decision);
    expect(result.candleCount).toBe(300);
    expect(result.splitIndex).toBe(210);
  } finally {
    await pool.destroy();
  }
}, 30_000);
```

Add the needed imports at the top of the test file: `DEFAULT_DETECTOR_OPTIONS`, `DEFAULT_BACKTEST_CONFIG` from `@cta/core`.

- [ ] **Step 3.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/workerPool.test.ts`
Expected: the new test FAILS (type error / worker ignores `kind`); existing tests still pass.

- [ ] **Step 3.3: Update `apps/server/src/engine/worker.ts`** — replace the `WorkerJob` interface and message handler (keep the tsx `register()` preamble and its comment exactly as-is):

```ts
import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';
import type {
  BacktestConfig, Candle, DetectorOptions, EngineAnalysisConfig, MaGridGates,
} from '@cta/core';

export interface AnalyzeWorkerJob {
  id: number;
  kind?: 'analyze'; // absent = analyze (backward compatible)
  candles: Candle[];
  config: EngineAnalysisConfig;
  /** test hook: makes the worker throw (unit-testing respawn) */
  poison?: boolean;
}

export interface OptimizeMaWorkerJob {
  id: number;
  kind: 'optimize-ma';
  candles: Candle[];
  detector: DetectorOptions;
  backtest: BacktestConfig;
  gates: MaGridGates;
}

export type WorkerJob = AnalyzeWorkerJob | OptimizeMaWorkerJob;

if (!parentPort) throw new Error('worker.ts must run as a worker thread');

// tsx's `--import tsx` entry refuses to register ESM hooks inside worker threads on
// Node < 24.11.1, so when the parent is NOT running under tsx (e.g. vitest) the
// worker can't resolve @cta/core's extensionless TS imports. Register explicitly via
// the programmatic API, then load the kernel. (This file itself parses via Node's
// native type stripping, or via tsx hooks when the parent runs under `tsx`.)
register();
const { analyzeCoin, optimizeMaForSeries } = await import('@cta/core');

parentPort.on('message', (job: WorkerJob) => {
  if (job.kind === 'optimize-ma') {
    const result = optimizeMaForSeries(job.candles, {
      detector: job.detector, backtest: job.backtest, gates: job.gates,
    });
    parentPort!.postMessage({ id: job.id, result });
    return;
  }
  if (job.poison) throw new Error('poisoned job');
  const result = analyzeCoin(job.candles, job.config);
  parentPort!.postMessage({ id: job.id, result });
});
```

- [ ] **Step 3.4: Update `apps/server/src/engine/workerPool.ts`** — replace the `PoolJob` interface, `Pending`, the `run` method, the `message` handler typing, and the `pump` payload construction:

```ts
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type {
  AnalyzeResult, BacktestConfig, Candle, DetectorOptions, EngineAnalysisConfig,
  MaGridGates, MaOptimizationResult,
} from '@cta/core';
import type { EngineLogger } from './logger';
import type { WorkerJob } from './worker';

export interface AnalyzePoolJob {
  kind?: 'analyze';
  candles: Candle[];
  config: EngineAnalysisConfig;
  poison?: boolean; // test hook
}

export interface OptimizeMaPoolJob {
  kind: 'optimize-ma';
  candles: Candle[];
  detector: DetectorOptions;
  backtest: BacktestConfig;
  gates: MaGridGates;
}

export type PoolJob = AnalyzePoolJob | OptimizeMaPoolJob;
type PoolResult = AnalyzeResult | MaOptimizationResult;

interface Pending {
  job: PoolJob;
  retried: boolean;
  resolve: (r: PoolResult) => void;
  reject: (e: Error) => void;
}
```

`run` becomes overloaded (body unchanged apart from the generic result type):

```ts
  run(job: AnalyzePoolJob): Promise<AnalyzeResult>;
  run(job: OptimizeMaPoolJob): Promise<MaOptimizationResult>;
  run(job: PoolJob): Promise<PoolResult> {
    if (this.destroyed) return Promise.reject(new Error('pool destroyed'));
    return new Promise<PoolResult>((resolve, reject) => {
      this.queue.push({ job, retried: false, resolve, reject });
      this.pump();
    });
  }
```

In `spawn()`, type the message as `(msg: { id: number; result: PoolResult })`. In `pump()`, build the payload by spreading the job:

```ts
      const payload = { id: this.nextId++, ...pending.job } as WorkerJob;
      slot.worker.postMessage(payload);
```

- [ ] **Step 3.5: Run the tests to verify they pass**

Run: `pnpm --filter @cta/server exec vitest run test/workerPool.test.ts`
Expected: PASS, including the pre-existing analyze/poison/respawn tests.

- [ ] **Step 3.6: Commit**

```bash
git add apps/server/src/engine/worker.ts apps/server/src/engine/workerPool.ts apps/server/test/workerPool.test.ts
git commit -m "feat(engine): optimize-ma job kind in worker pool"
```

---

### Task 4: engine config — `optimizer` block

**Model:** sonnet

**Files:**
- Modify: `apps/server/src/engine/config.ts`
- Modify: `engine.json.example`
- Test: `apps/server/test/engineConfig.test.ts` (extend)

- [ ] **Step 4.1: Write the failing test** — append to `apps/server/test/engineConfig.test.ts`:

```ts
describe('optimizer config', () => {
  it('defaults to enabled with spec gates', () => {
    const cfg = loadEngineConfig('/nonexistent/engine.json', {});
    expect(cfg.optimizer).toEqual({
      enabled: true, minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3,
    });
  });

  it('deep-merges optimizer overrides from engine.json', () => {
    const path = join(tmpdir(), `engine-opt-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ optimizer: { enabled: false, minTrainTrades: 5 } }));
    const cfg = loadEngineConfig(path, {});
    expect(cfg.optimizer.enabled).toBe(false);
    expect(cfg.optimizer.minTrainTrades).toBe(5);
    expect(cfg.optimizer.minValidationTrades).toBe(8); // untouched default survives
  });
});
```

If the file does not already import them, add: `import { writeFileSync } from 'node:fs';`, `import { tmpdir } from 'node:os';`, `import { join } from 'node:path';`.

- [ ] **Step 4.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/engineConfig.test.ts`
Expected: FAIL — `optimizer` undefined.

- [ ] **Step 4.3: Implement** — in `apps/server/src/engine/config.ts`, add to the `EngineConfig` interface (after `analysis`):

```ts
  optimizer: {
    enabled: boolean;            // gates the nightly 00:10 UTC schedule only (manual trigger always works)
    minTrainTrades: number;
    minValidationTrades: number;
    validationFraction: number;
  };
```

And to `DEFAULT_ENGINE_CONFIG` (after the `analysis` block):

```ts
  optimizer: { enabled: true, minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 },
```

The existing `deepMerge` handles the nested overrides — no loader changes needed.

- [ ] **Step 4.4: Update `engine.json.example`** — add after the `"sinks"` line:

```json
  "webOrigin": "http://localhost:3001",
  "optimizer": { "enabled": true, "minTrainTrades": 20, "minValidationTrades": 8, "validationFraction": 0.3 },
```

(`webOrigin` now points at the server origin because Phase 4B serves the dashboard there — deep links must hit the served app, not the vite dev server.)

- [ ] **Step 4.5: Run the test to verify it passes**

Run: `pnpm --filter @cta/server exec vitest run test/engineConfig.test.ts`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add apps/server/src/engine/config.ts engine.json.example apps/server/test/engineConfig.test.ts
git commit -m "feat(engine): optimizer config block"
```

---

### Task 5: MaOptimizer — nightly schedule, scan-yielding, persistence

**Model:** fable

**Files:**
- Create: `apps/server/src/engine/maOptimizer.ts`
- Test: `apps/server/test/maOptimizer.test.ts`

- [ ] **Step 5.1: Write the failing test**

```ts
// apps/server/test/maOptimizer.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, MaOptimizationResult, SetupMetrics } from '@cta/core';
import { MaOptimizer, nextRunDelayMs, MIN_OPTIMIZE_CANDLES } from '../src/engine/maOptimizer';
import type { MaSelectionRow } from '../src/cache/maSelectionStore';
import { nullLogger } from '../src/engine/logger';
import { DEFAULT_DETECTOR_OPTIONS, DEFAULT_BACKTEST_CONFIG } from '@cta/core';

const metrics = (expectancy: number, trades: number): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: expectancy, profitFactor: 1, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: trades, shortTrades: 0,
});

const challengerResult: MaOptimizationResult = {
  decision: 'challenger',
  selection: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } },
  best: {
    combo: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } },
    kinds: ['ma-golden-cross'], train: metrics(0.5, 30), validation: metrics(0.4, 10),
  },
  baseline: { kinds: ['ma-golden-cross'], train: metrics(0.2, 25), validation: metrics(0.1, 9) },
  splitIndex: 1400, candleCount: 2000,
};

const baselineResult: MaOptimizationResult = {
  ...challengerResult, decision: 'baseline', selection: null,
};

const series: Candle[] = Array.from({ length: MIN_OPTIMIZE_CANDLES }, (_, i) =>
  ({ t: i * 900_000, o: 1, h: 1, l: 1, c: 1, v: 1, n: 1 }));

function makeDeps(results: MaOptimizationResult[] | Error[]) {
  const jobs: unknown[] = [];
  let i = 0;
  const upserts: MaSelectionRow[] = [];
  const removals: string[] = [];
  const selections: { coin: string; interval: string; sel: unknown }[] = [];
  return {
    jobs, upserts, removals, selections,
    deps: {
      pool: {
        run: async (job: unknown) => {
          jobs.push(job);
          const r = results[Math.min(i++, results.length - 1)];
          if (r instanceof Error) throw r;
          return r;
        },
      },
      store: {
        upsert: (row: MaSelectionRow) => { upserts.push(row); },
        remove: (coin: string, interval: string) => { removals.push(`${coin}|${interval}`); return true; },
        get: () => null, all: () => [],
      },
      log: nullLogger,
      detector: DEFAULT_DETECTOR_OPTIONS,
      backtest: DEFAULT_BACKTEST_CONFIG,
      gates: { minTrainTrades: 20, minValidationTrades: 8, validationFraction: 0.3 },
      timeframes: ['15m', '1h'] as const,
      liveCoins: () => ['BTC'],
      series: () => series,
      scanBacklog: () => 0,
      onSelection: (coin: string, interval: string, sel: unknown) => { selections.push({ coin, interval, sel }); },
      sleepMs: async () => {},
    },
  };
}

describe('nextRunDelayMs', () => {
  it('targets the next 00:10 UTC', () => {
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 23, 0, 0))).toBe(70 * 60_000);
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 0, 5, 0))).toBe(5 * 60_000);
    expect(nextRunDelayMs(Date.UTC(2026, 5, 11, 0, 10, 0))).toBe(86_400_000); // exactly 00:10 → tomorrow
  });
});

describe('MaOptimizer.run', () => {
  it('upserts and notifies on challenger, removes and notifies null on baseline', async () => {
    const { deps, upserts, removals, selections } = makeDeps([challengerResult, baselineResult]);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(summary.evaluated).toBe(2);
    expect(summary.selected).toBe(1);
    expect(summary.reverted).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      coin: 'BTC', interval: '15m',
      fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 },
      setupKinds: ['ma-golden-cross'],
    });
    expect(removals).toEqual(['BTC|1h']);
    expect(selections).toEqual([
      { coin: 'BTC', interval: '15m', sel: { fast: { type: 'EMA', period: 21 }, slow: { type: 'SMA', period: 100 } } },
      { coin: 'BTC', interval: '1h', sel: null },
    ]);
  });

  it('skips thin series without running a job', async () => {
    const { deps, jobs } = makeDeps([challengerResult]);
    deps.series = () => series.slice(0, 10);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(jobs).toHaveLength(0);
    expect(summary.skipped).toBe(2);
  });

  it('a failing job is logged and counted, and the sweep continues', async () => {
    const { deps, upserts } = makeDeps([new Error('boom'), challengerResult] as never);
    const opt = new MaOptimizer(deps as never);
    const summary = await opt.run();
    expect(summary.failed).toBe(1);
    expect(summary.evaluated).toBe(1);
    expect(upserts).toHaveLength(1); // second coin×tf still processed
  });

  it('explicit coins argument overrides liveCoins', async () => {
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    await opt.run(['ETH', 'SOL']);
    expect(jobs).toHaveLength(4); // 2 coins × 2 timeframes
  });

  it('yields to a busy scan queue before each job', async () => {
    const { deps, jobs } = makeDeps([baselineResult]);
    const backlog = [3, 2, 0, 0, 0, 0, 0, 0];
    let calls = 0;
    deps.scanBacklog = () => backlog[Math.min(calls++, backlog.length - 1)];
    const sleeps: number[] = [];
    deps.sleepMs = async (ms: number) => { sleeps.push(ms); };
    const opt = new MaOptimizer(deps as never);
    await opt.run(['BTC']);
    expect(sleeps.length).toBeGreaterThanOrEqual(2); // waited while backlog > 0
    expect(jobs).toHaveLength(2);
  });
});

describe('MaOptimizer schedule', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('start() schedules a run at the next 00:10 UTC and reschedules after it completes', async () => {
    vi.setSystemTime(Date.UTC(2026, 5, 11, 23, 0, 0));
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    opt.start();
    expect(jobs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(70 * 60_000 + 5);
    expect(jobs).toHaveLength(2); // 1 coin × 2 tfs ran
    opt.stop();
  });

  it('stop() cancels the pending schedule', async () => {
    vi.setSystemTime(Date.UTC(2026, 5, 11, 23, 0, 0));
    const { deps, jobs } = makeDeps([baselineResult]);
    const opt = new MaOptimizer(deps as never);
    opt.start();
    opt.stop();
    await vi.advanceTimersByTimeAsync(2 * 86_400_000);
    expect(jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 5.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/maOptimizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `apps/server/src/engine/maOptimizer.ts`**

```ts
// apps/server/src/engine/maOptimizer.ts
import type {
  BacktestConfig, Candle, DetectorOptions, Interval, MaGridGates, MaOptimizationResult, MaSpec,
} from '@cta/core';
import type { MaSelectionStore } from '../cache/maSelectionStore';
import type { EngineLogger } from './logger';
import type { OptimizeMaPoolJob } from './workerPool';

export const OPTIMIZE_RUN_UTC = { hour: 0, minute: 10 } as const;
/** slow MA needs 200 candles of warmup and the holdout needs room for ≥8 trades */
export const MIN_OPTIMIZE_CANDLES = 600;
const YIELD_POLL_MS = 250;
const YIELD_MAX_WAIT_MS = 120_000;
const DAY_MS = 86_400_000;

/** ms from `now` to the next 00:10:00.000 UTC, strictly in the future. */
export function nextRunDelayMs(now: number): number {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), OPTIMIZE_RUN_UTC.hour, OPTIMIZE_RUN_UTC.minute, 0, 0);
  return today > now ? today - now : today + DAY_MS - now;
}

export interface MaDecision {
  coin: string;
  interval: Interval;
  decision: 'challenger' | 'baseline' | 'skipped' | 'failed';
  fast?: MaSpec;
  slow?: MaSpec;
}

export interface MaOptimizeSummary {
  startedAt: number;
  finishedAt: number;
  evaluated: number;
  selected: number;
  reverted: number;
  skipped: number;
  failed: number;
  decisions: MaDecision[];
}

export interface MaOptimizerDeps {
  pool: { run(job: OptimizeMaPoolJob): Promise<MaOptimizationResult> };
  store: Pick<MaSelectionStore, 'upsert' | 'remove'>;
  log: EngineLogger;
  detector: DetectorOptions;   // baseline detector opts (maFast/maSlow = engine defaults)
  backtest: BacktestConfig;
  gates: MaGridGates;
  timeframes: readonly Interval[];
  liveCoins: () => string[];
  series: (coin: string, interval: Interval) => Candle[];
  /** scan-queue depth + in-flight scans; the optimizer waits until this is 0 before each job */
  scanBacklog: () => number;
  onSelection: (coin: string, interval: Interval, sel: { fast: MaSpec; slow: MaSpec } | null) => void;
  now?: () => number;
  sleepMs?: (ms: number) => Promise<void>; // test seam
}

export class MaOptimizer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private deps: MaOptimizerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleepMs ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  }

  start(): void {
    this.stopped = false;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private schedule(): void {
    const delay = nextRunDelayMs(this.now());
    this.timer = setTimeout(() => {
      void this.run().finally(() => { if (!this.stopped) this.schedule(); });
    }, delay);
    this.timer.unref?.();
    this.deps.log.info({ delayMs: delay }, 'ma-optimizer scheduled');
  }

  /** Serial sweep — at most one worker is ever occupied by optimization. */
  async run(coins?: string[]): Promise<MaOptimizeSummary> {
    const summary: MaOptimizeSummary = {
      startedAt: this.now(), finishedAt: 0,
      evaluated: 0, selected: 0, reverted: 0, skipped: 0, failed: 0, decisions: [],
    };
    if (this.running) { summary.finishedAt = this.now(); return summary; } // one run at a time
    this.running = true;
    try {
      const targets = coins ?? this.deps.liveCoins();
      for (const coin of targets) {
        for (const interval of this.deps.timeframes) {
          if (this.stopped && !coins) break; // nightly run aborts on stop; manual runs finish
          await this.yieldToScans();
          const candles = this.deps.series(coin, interval);
          if (candles.length < MIN_OPTIMIZE_CANDLES) {
            summary.skipped++;
            summary.decisions.push({ coin, interval, decision: 'skipped' });
            continue;
          }
          try {
            const result = await this.deps.pool.run({
              kind: 'optimize-ma', candles,
              detector: this.deps.detector, backtest: this.deps.backtest, gates: this.deps.gates,
            });
            summary.evaluated++;
            if (result.decision === 'challenger' && result.selection && result.best) {
              this.deps.store.upsert({
                coin, interval,
                fast: result.selection.fast, slow: result.selection.slow,
                setupKinds: result.best.kinds,
                train: result.best.train, validation: result.best.validation,
                baselineSetupKinds: result.baseline?.kinds ?? null,
                baselineTrain: result.baseline?.train ?? null,
                baselineValidation: result.baseline?.validation ?? null,
                candleCount: result.candleCount, splitIndex: result.splitIndex,
                selectedAt: this.now(),
              });
              this.deps.onSelection(coin, interval, { fast: result.selection.fast, slow: result.selection.slow });
              summary.selected++;
              summary.decisions.push({ coin, interval, decision: 'challenger', fast: result.selection.fast, slow: result.selection.slow });
              this.deps.log.info({
                coin, interval, fast: result.selection.fast, slow: result.selection.slow,
                valExpectancy: result.best.validation.expectancy,
                baselineValExpectancy: result.baseline?.validation.expectancy ?? 0,
              }, 'ma-optimizer: challenger selected');
            } else {
              if (this.deps.store.remove(coin, interval)) summary.reverted++;
              this.deps.onSelection(coin, interval, null);
              summary.decisions.push({ coin, interval, decision: 'baseline' });
            }
          } catch (err) {
            summary.failed++;
            summary.decisions.push({ coin, interval, decision: 'failed' });
            this.deps.log.warn({ coin, interval, err: (err as Error).message }, 'ma-optimizer job failed — baseline retained');
          }
        }
      }
    } finally {
      this.running = false;
    }
    summary.finishedAt = this.now();
    this.deps.log.info({
      evaluated: summary.evaluated, selected: summary.selected, reverted: summary.reverted,
      skipped: summary.skipped, failed: summary.failed, ms: summary.finishedAt - summary.startedAt,
    }, 'ma-optimizer run complete');
    return summary;
  }

  private async yieldToScans(): Promise<void> {
    const t0 = this.now();
    while (!this.stopped && this.deps.scanBacklog() > 0 && this.now() - t0 < YIELD_MAX_WAIT_MS) {
      await this.sleep(YIELD_POLL_MS);
    }
  }
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `pnpm --filter @cta/server exec vitest run test/maOptimizer.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/server/src/engine/maOptimizer.ts apps/server/test/maOptimizer.test.ts
git commit -m "feat(engine): nightly MA optimizer with scan-yielding and auditable persistence"
```

**Task 5 deviations (recorded during execution, commit `2dfe5ac`):**
- The test's `log: nullLogger` is a plan typo — `nullLogger` is a factory in `logger.ts`; implemented as `log: nullLogger()` (same adaptation as Task 3).
- Reviewer-flagged PLAN BUG (minor): `schedule()`'s `void this.run().finally(...)` surfaces an unhandled rejection if a synchronous dep (`liveCoins`/`series`/`scanBacklog`) throws. Fix folded into Task 6: add `.catch((err) => this.deps.log.warn({ err: (err as Error).message }, 'ma-optimizer nightly run crashed'))` before the `.finally` in `maOptimizer.ts`'s `schedule()`.

---

### Task 6: Engine — MA overrides on scan + tick paths, optimizer wiring

**Model:** fable

**Files:**
- Modify: `apps/server/src/engine/engine.ts`
- Modify: `apps/server/src/engine/provisional.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/engineMaOverride.test.ts` (new), `apps/server/test/provisional.test.ts` (signature), possibly `apps/server/test/engine.test.ts` / `engineIntegration.test.ts` (new required dep)

- [ ] **Step 6.1: Write the failing test**

```ts
// apps/server/test/engineMaOverride.test.ts
import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

const emptyResult: AnalyzeResult = { scanResults: [], plans: [], candleCount: 100, lastCandleT: 0 };

function makeEngine(db: ReturnType<typeof openDb>) {
  const bucket = Math.floor(Date.now() / M15) * M15;
  const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
    ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
  const jobs: { config: { detector: { maFast: unknown; maSlow: unknown } } }[] = [];
  const pool = {
    queueDepth: 0, busyCount: 0,
    run: async (job: never) => { jobs.push(job); return emptyResult; },
    destroy: async () => {},
  };
  const fakeWs = {
    connected: true, lastMessageAt: Date.now(),
    start: () => {}, stop: () => {}, setCoins: () => {}, on: () => fakeWs,
  };
  const engine = new Engine({
    config: { ...DEFAULT_ENGINE_CONFIG, timeframes: ['15m'], universeCap: 2, workerCount: 1 },
    log: nullLogger,
    candleService: { getCandles: async () => closed } as never,
    marketsService: {
      getMarkets: async () => ({
        markets: [
          { name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 },
          { name: 'ETH', dayNtlVlm: 50, szDecimals: 2, maxLeverage: 10 },
        ],
        updatedAt: 0,
      }),
    } as never,
    candleStore: new CandleStore(db),
    alertStore: new AlertStore(db),
    maSelectionStore: new MaSelectionStore(db),
    dispatch: async () => [],
    ws: fakeWs as never,
    pool: pool as never,
  });
  return { engine, jobs };
}

describe('engine MA selection overrides', () => {
  it('close scans use the stored selection for that coin×timeframe and defaults elsewhere', async () => {
    const db = openDb(':memory:');
    const store = new MaSelectionStore(db);
    store.upsert({
      coin: 'BTC', interval: '15m',
      fast: { type: 'SMA', period: 9 }, slow: { type: 'EMA', period: 150 },
      setupKinds: ['ma-golden-cross'],
      train: { trades: 30, wins: 15, winRate: 0.5, avgR: 0.3, profitFactor: 1.5, expectancy: 0.3, maxDrawdownR: 1, filtered: 0, longTrades: 30, shortTrades: 0 },
      validation: { trades: 10, wins: 5, winRate: 0.5, avgR: 0.2, profitFactor: 1.2, expectancy: 0.2, maxDrawdownR: 1, filtered: 0, longTrades: 10, shortTrades: 0 },
      baselineSetupKinds: null, baselineTrain: null, baselineValidation: null,
      candleCount: 2000, splitIndex: 1400, selectedAt: 1,
    });
    const { engine, jobs } = makeEngine(db);
    await engine.start();
    await until(() => jobs.length >= 2); // BTC + ETH initial scans
    await engine.stop();
    const btcJob = jobs.find((j) => j.config.detector.maFast && (j.config.detector.maFast as { period: number }).period === 9);
    expect(btcJob).toBeDefined();
    expect(btcJob!.config.detector.maSlow).toEqual({ type: 'EMA', period: 150 });
    const ethJob = jobs.find((j) => (j.config.detector.maFast as { period: number }).period === 50);
    expect(ethJob).toBeDefined(); // default EMA50/SMA200 fallback
    expect(ethJob!.config.detector.maSlow).toEqual({ type: 'SMA', period: 200 });
  });
});
```

- [ ] **Step 6.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/engineMaOverride.test.ts`
Expected: FAIL — `maSelectionStore` is not a known dep / no override applied.

- [ ] **Step 6.3: Change `apps/server/src/engine/provisional.ts`** — the analyze seam gains coin/interval so the tick path resolves per-coin config:

```ts
export type AnalyzePlansFn = (
  coin: string, interval: Interval, candles: Candle[], qualified: SetupResult[],
) => TradePlan[];

/** Default tick-path analysis: detector context + detection + plans against cached qualified setups (no backtest re-run). */
export function makePlanAnalyzer(resolve: (coin: string, interval: Interval) => EngineAnalysisConfig): AnalyzePlansFn {
  return (coin, interval, candles, qualified) => {
    const cfg = resolve(coin, interval);
    const ctx = buildDetectorContext(candles, cfg.detector);
    const signals = detectAll(candles, ctx);
    return buildTradePlans(candles, ctx, signals, qualified, { ...cfg.backtest, window: cfg.window, weights: cfg.weights });
  };
}
```

In `evaluateCoin`, the call becomes `const plans = this.o.analyze(coin, tf, candles, qualified);`. Stubs of the form `provisionalAnalyze: () => [plan]` remain type-compatible (fewer params is fine in TS) — only update tests that *positionally* consume the old `(candles, qualified)` args.

- [ ] **Step 6.4: Change `apps/server/src/engine/engine.ts`**

1. Imports: add `MaSelectionStore` type, `MaOptimizer`, `MaOptimizeSummary`, and `MaSpec`:

```ts
import type { MaSelectionStore } from '../cache/maSelectionStore';
import { MaOptimizer } from './maOptimizer';
import type { MaOptimizeSummary } from './maOptimizer';
import type { MaSpec } from '@cta/core';
```

2. `EngineDeps` gains a required member:

```ts
  maSelectionStore: MaSelectionStore;
```

3. New private state + constructor wiring (after `this.analysisConfig = buildAnalysisConfig(this.cfg);`):

```ts
  private maOverrides: Map<string, { fast: MaSpec; slow: MaSpec }>;
  private maOptimizer: MaOptimizer;
```

```ts
    this.maOverrides = new Map(
      deps.maSelectionStore.all().map((r) => [`${r.coin}|${r.interval}`, { fast: r.fast, slow: r.slow }]),
    );
    this.maOptimizer = new MaOptimizer({
      pool: this.pool,
      store: deps.maSelectionStore,
      log: this.log,
      detector: this.analysisConfig.detector,
      backtest: this.analysisConfig.backtest,
      gates: {
        minTrainTrades: this.cfg.optimizer.minTrainTrades,
        minValidationTrades: this.cfg.optimizer.minValidationTrades,
        validationFraction: this.cfg.optimizer.validationFraction,
      },
      timeframes: this.cfg.timeframes,
      liveCoins: () => [...this.live],
      series: (coin, interval) => this.aggregator.series(coin, interval),
      scanBacklog: () => this.queue.size + this.inFlight,
      onSelection: (coin, interval, sel) => {
        const key = `${coin}|${interval}`;
        if (sel) this.maOverrides.set(key, sel); else this.maOverrides.delete(key);
      },
      now: this.now,
    });
```

NOTE: `this.maOptimizer` must be constructed AFTER `this.pool` and `this.aggregator` are assigned — place the block right after the `this.backfill = new BackfillOrchestrator({...})` assignment.

4. The override resolver + scan path:

```ts
  /** analyzeCoin config with the stored MA selection injected, falling back to EMA50/SMA200 defaults. */
  private analysisConfigFor(coin: string, interval: Interval): EngineAnalysisConfig {
    const o = this.maOverrides.get(`${coin}|${interval}`);
    if (!o) return this.analysisConfig;
    return {
      ...this.analysisConfig,
      detector: { ...this.analysisConfig.detector, maFast: o.fast, maSlow: o.slow },
    };
  }
```

In `pumpScans`, change the pool call to `this.pool.run({ candles, config: this.analysisConfigFor(job.coin, job.interval) })`.

5. Provisional path — the ProvisionalEvaluator construction changes its `analyze` line to:

```ts
      analyze: deps.provisionalAnalyze ?? makePlanAnalyzer((coin, interval) => this.analysisConfigFor(coin, interval)),
```

6. `start()` gains (at the end): `if (this.cfg.optimizer.enabled) this.maOptimizer.start();`
   `stop()` gains (before `this.ws.stop()`): `this.maOptimizer.stop();`
   New public method:

```ts
  runMaOptimization(coins?: string[]): Promise<MaOptimizeSummary> {
    return this.maOptimizer.run(coins);
  }
```

- [ ] **Step 6.5: Wire `apps/server/src/server.ts`** — construct the store once and pass it:

```ts
import { MaSelectionStore } from './cache/maSelectionStore';
```

In the `ENGINE_ENABLED` block, hoist the alert store into a variable (Task 10 reuses it) and add the selection store:

```ts
  const alertStore = new AlertStore(db);
  const maSelectionStore = new MaSelectionStore(db);
  const engine = new Engine({
    config: engineConfig, log: engineLog,
    candleService, marketsService,
    candleStore, alertStore, maSelectionStore,
    dispatch: (text) => dispatcher.dispatch(text),
  });
```

- [ ] **Step 6.6: Fix compile fallout in existing tests** — every `new Engine({...})` in `apps/server/test/` (`engine.test.ts`, `engineIntegration.test.ts`, and any other) gains `maSelectionStore: new MaSelectionStore(db)` (each already opens an in-memory db; if one constructs Engine without a db, add `openDb(':memory:')`). `provisional.test.ts`: update direct `analyze` stubs/assertions to the 4-arg signature.

- [ ] **Step 6.7: Run the full server suite**

Run: `pnpm --filter @cta/server test`
Expected: ALL green, including the new `engineMaOverride.test.ts`.

- [ ] **Step 6.8: Commit**

```bash
git add apps/server/src/engine/engine.ts apps/server/src/engine/provisional.ts apps/server/src/server.ts apps/server/test/
git commit -m "feat(engine): per-coin×timeframe MA selection overrides on scan and tick paths"
```

---

### Task 7: `POST /engine/optimize-ma` (loopback-only)

**Model:** opus

**Files:**
- Create: `apps/server/src/routes/optimizeMa.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/optimizeMaRoute.test.ts`

- [ ] **Step 7.1: Write the failing test**

```ts
// apps/server/test/optimizeMaRoute.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const summary = {
  startedAt: 1, finishedAt: 2, evaluated: 4, selected: 1, reverted: 3, skipped: 0, failed: 0, decisions: [],
};

describe('POST /engine/optimize-ma', () => {
  it('runs the optimizer for parsed coins and returns the summary', async () => {
    const calls: (string[] | undefined)[] = [];
    const app = buildApp({ optimizeMa: async (coins) => { calls.push(coins); return summary; } });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma?coins=BTC,%20eth' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summary);
    expect(calls).toEqual([['BTC', 'ETH']]); // trimmed + uppercased
  });

  it('omitting coins passes undefined (full live universe)', async () => {
    const calls: (string[] | undefined)[] = [];
    const app = buildApp({ optimizeMa: async (coins) => { calls.push(coins); return summary; } });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([undefined]);
  });

  it('rejects non-loopback callers with 403', async () => {
    const app = buildApp({ optimizeMa: async () => summary });
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma', remoteAddress: '10.0.0.5' });
    expect(res.statusCode).toBe(403);
  });

  it('is absent when the engine is disabled', async () => {
    const app = buildApp({});
    const res = await app.inject({ method: 'POST', url: '/engine/optimize-ma' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 7.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/optimizeMaRoute.test.ts`
Expected: FAIL — `optimizeMa` not a known buildApp dep, route 404.

- [ ] **Step 7.3: Implement `apps/server/src/routes/optimizeMa.ts`**

```ts
// apps/server/src/routes/optimizeMa.ts
import type { FastifyInstance } from 'fastify';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Manual optimizer trigger for testing and the e2e — deliberately loopback-only. */
export function registerOptimizeMaRoute(
  app: FastifyInstance,
  run: (coins?: string[]) => Promise<unknown>,
): void {
  app.post('/engine/optimize-ma', {
    schema: {
      querystring: {
        type: 'object',
        properties: { coins: { type: 'string' } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!LOOPBACK.has(req.ip)) return reply.code(403).send({ error: 'local only' });
    const raw = (req.query as { coins?: string }).coins;
    const coins = raw
      ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    return run(coins && coins.length ? coins : undefined);
  });
}
```

- [ ] **Step 7.4: Register in `apps/server/src/app.ts`** — add to `AppDeps`:

```ts
  optimizeMa?: (coins?: string[]) => Promise<unknown>;
```

and in `buildApp`, after the signals route registration:

```ts
  if (deps.optimizeMa) registerOptimizeMaRoute(app, deps.optimizeMa);
```

with the import `import { registerOptimizeMaRoute } from './routes/optimizeMa';`.

In `apps/server/src/server.ts`, inside the `ENGINE_ENABLED` block, capture the trigger and pass it to buildApp:

```ts
let optimizeMa: ((coins?: string[]) => Promise<unknown>) | undefined;
// inside the ENGINE_ENABLED block, after the engine is constructed:
  optimizeMa = (coins) => engine.runMaOptimization(coins);
// at the bottom:
const app = buildApp({ marketsService, analysisService, backtestService, signalsService, engineStatus, optimizeMa });
```

- [ ] **Step 7.5: Run the test to verify it passes**

Run: `pnpm --filter @cta/server exec vitest run test/optimizeMaRoute.test.ts`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add apps/server/src/routes/optimizeMa.ts apps/server/src/app.ts apps/server/src/server.ts apps/server/test/optimizeMaRoute.test.ts
git commit -m "feat(server): loopback-only manual MA optimizer trigger"
```

---

### Task 8: Engine events + AlertEngine `onRecord` / `stop()`

**Model:** opus

**Files:**
- Modify: `apps/server/src/engine/types.ts` (ScanEvent, HealthEvent, LiveSnapshot)
- Modify: `apps/server/src/engine/alertEngine.ts`
- Modify: `apps/server/src/engine/engine.ts`
- Test: `apps/server/test/alertEngine.test.ts` (extend), `apps/server/test/engineEvents.test.ts` (new)

This task also clears two parked 4A leftovers: `AlertEngine.stop()` and digest-flush-on-stop.

- [ ] **Step 8.1: Write the failing tests**

Append to `apps/server/test/alertEngine.test.ts` (reuse its existing store/option helpers — it already constructs AlertEngine with an in-memory AlertStore and a `now` stub):

```ts
it('calls onRecord for every persisted row, including digest-buffered ones', async () => {
  // build an engine with burstLimit 1 so the second alert goes to the digest buffer;
  // use this file's existing helper for store/options and pass onRecord + digestFlushMs 10
  const records: { kind: string; identity: string }[] = [];
  // ... construct AlertEngine with onRecord: (row) => records.push({ kind: row.kind, identity: row.identity })
  // fire two provisional plans with distinct identities (helper plans from this file)
  // expect records to contain both 'provisional-new' rows immediately (one delivered, one digest-routed)
  // advance/await the digest flush → expect a 'digest' record appended
});

it('stop() flushes a pending digest buffer instead of dropping it', async () => {
  // burstLimit 1, digestFlushMs 60_000 (won't fire on its own)
  // fire two alerts → second lands in the buffer
  // await engine.stop()
  // expect the digest row persisted and dispatched exactly once, and the timer cleared
});
```

(Concrete plan/identity fixtures and option plumbing mirror the existing tests in that file — implementer fills them in with the file's own helpers; assertions above are the contract.)

Create `apps/server/test/engineEvents.test.ts`:

```ts
// apps/server/test/engineEvents.test.ts
import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle, TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { MaSelectionStore } from '../src/cache/maSelectionStore';
import { Engine } from '../src/engine/engine';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';
import type { ScanEvent } from '../src/engine/types';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

const plan: TradePlan = {
  setup: ['rsi-oversold-exit'], direction: 'bullish', signalT: 0, ageCandles: 0,
  entry: 2.5, stop: 2, target: 3.5, rr: 2, status: 'active',
  metrics: { trades: 30, wins: 18, winRate: 0.6, avgR: 0.4, profitFactor: 2.5, expectancy: 0.4, maxDrawdownR: 1.2, filtered: 0, longTrades: 30, shortTrades: 0 },
  confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
};
const result: AnalyzeResult = { scanResults: [], plans: [plan], candleCount: 100, lastCandleT: 99 };

describe('engine events', () => {
  it('emits scan (before its alerts), alert, and health; liveSnapshot ranks by confidence', async () => {
    const db = openDb(':memory:');
    const bucket = Math.floor(Date.now() / M15) * M15;
    const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
      ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
    const fakeWs = {
      connected: true, lastMessageAt: Date.now(),
      start: () => {}, stop: () => {}, setCoins: () => {}, on: () => fakeWs,
    };
    const engine = new Engine({
      config: { ...DEFAULT_ENGINE_CONFIG, timeframes: ['15m'], universeCap: 1, workerCount: 1, confirmedMinConfidence: 0 },
      log: nullLogger,
      candleService: { getCandles: async () => closed } as never,
      marketsService: { getMarkets: async () => ({ markets: [{ name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 }], updatedAt: 0 }) } as never,
      candleStore: new CandleStore(db),
      alertStore: new AlertStore(db),
      maSelectionStore: new MaSelectionStore(db),
      dispatch: async () => ['telegram'],
      ws: fakeWs as never,
      pool: { queueDepth: 0, busyCount: 0, run: async () => result, destroy: async () => {} } as never,
    });
    const order: string[] = [];
    const scans: ScanEvent[] = [];
    engine.events.on('scan', (e: ScanEvent) => { order.push('scan'); scans.push(e); });
    engine.events.on('alert', () => order.push('alert'));
    engine.events.on('health', () => order.push('health'));
    await engine.start();
    await until(() => order.includes('scan') && order.includes('alert'));
    expect(order.indexOf('scan')).toBeLessThan(order.indexOf('alert')); // scan precedes its own alerts
    expect(scans[0]).toMatchObject({
      coin: 'BTC', interval: '15m', candleCount: 100,
      plan: { direction: 'bullish', setup: ['rsi-oversold-exit'], entry: 2.5, stop: 2, target: 3.5, rr: 2, confidence: 80 },
    });
    const snap = engine.liveSnapshot();
    expect(snap.scans).toHaveLength(1);
    expect(snap.health.wsConnected).toBe(true);
    expect(typeof snap.health.ts).toBe('number');
    await until(() => order.includes('health'), 4_000); // 2s health timer
    await engine.stop();
  });
});
```

- [ ] **Step 8.2: Run to verify they fail**

Run: `pnpm --filter @cta/server exec vitest run test/engineEvents.test.ts test/alertEngine.test.ts`
Expected: FAIL — no `events`, no `onRecord`, no `stop`.

- [ ] **Step 8.3: Add types to `apps/server/src/engine/types.ts`**

```ts
import type { HealthSnapshot } from './metrics';
import type { AlertRow } from '../cache/alertStore';

export interface ScanPlanSummary {
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
}

export interface ScanEvent {
  coin: string;
  interval: Interval;
  ts: number;
  candleCount: number;
  plan: ScanPlanSummary | null; // best active plan, null when none
}

export interface HealthEvent extends HealthSnapshot { ts: number }

export interface LiveSnapshot {
  scans: ScanEvent[];   // current rankings, confidence desc
  alerts: AlertRow[];   // newest first
  health: HealthEvent;
}
```

(merge the imports with the existing ones in that file).

- [ ] **Step 8.4: AlertEngine changes** in `apps/server/src/engine/alertEngine.ts`:

1. `AlertEngineOptions` gains:

```ts
  /** observation hook fired for every persisted row (live feed) — NOT a delivery sink */
  onRecord?: (row: AlertRow) => void;
```

with `import type { AlertRow } from '../cache/alertStore';` added to the import line. The `o` field type becomes:

```ts
  private o: Required<Omit<AlertEngineOptions, 'now' | 'onRecord'>> & Pick<AlertEngineOptions, 'onRecord'>;
```

2. Extract a private insert helper and use it at all three `store.insert` sites (digest-routed alert, dispatched alert, flushed digest):

```ts
  private persist(row: AlertRow): void {
    this.o.store.insert(row);
    this.o.onRecord?.(row);
  }
```

3. New public stop (4A parked debt — digest buffer must not be dropped):

```ts
  /** Flush any pending digest before shutdown; safe to call twice. */
  async stop(): Promise<void> {
    if (this.digestTimer) { clearTimeout(this.digestTimer); this.digestTimer = null; }
    await this.flushDigest();
  }
```

- [ ] **Step 8.5: Engine changes** in `apps/server/src/engine/engine.ts`:

1. `import { EventEmitter } from 'node:events';` and import the new types:

```ts
import type { HealthEvent, LiveSnapshot, ScanEvent } from './types';
```

2. New public/private state:

```ts
  readonly events = new EventEmitter();
  private latestScans = new Map<string, ScanEvent>();
```

3. AlertEngine construction gains `onRecord: (row) => this.events.emit('alert', row),`.

4. In `pumpScans`, restructure the `.then` so the scan event fires BEFORE alerts derived from the same close (deterministic feed ordering):

```ts
        .then(async (result) => {
          this.metrics.record('close-scan', this.now() - started);
          this.scansCompleted++;
          const best = result.plans.find((p) => p.status === 'active') ?? null;
          const scanEvent: ScanEvent = {
            coin: job.coin, interval: job.interval, ts: this.now(), candleCount: result.candleCount,
            plan: best && {
              direction: best.direction, setup: best.setup, entry: best.entry,
              stop: best.stop, target: best.target, rr: best.rr, confidence: best.confidence.score,
            },
          };
          this.latestScans.set(`${job.coin}|${job.interval}`, scanEvent);
          this.events.emit('scan', scanEvent);
          const qualified = qualifySetups(result.scanResults, this.cfg.analysis.gate);
          this.provisional.setQualified(job.coin, job.interval, qualified);
          await this.alertEngine.onCloseScan(job.coin, job.interval, result.plans);
          this.syncProvisionalActive();
        })
```

5. `start()` gains a health emitter among the timers:

```ts
    this.timers.push(setInterval(() => {
      this.events.emit('health', { ...this.status(), ts: this.now() } satisfies HealthEvent);
    }, 2_000));
```

(before the `for (const t of this.timers) t.unref?.();` line).

6. `stop()` gains `await this.alertEngine.stop();` after the timers are cleared.

7. New snapshot accessor (alerts are appended by the route, which owns the AlertStore):

```ts
  liveSnapshot(): Omit<LiveSnapshot, 'alerts'> {
    const scans = [...this.latestScans.values()]
      .sort((a, b) => (b.plan?.confidence ?? -1) - (a.plan?.confidence ?? -1));
    return { scans, health: { ...this.status(), ts: this.now() } };
  }
```

- [ ] **Step 8.6: Run the tests, then the full server suite**

Run: `pnpm --filter @cta/server exec vitest run test/engineEvents.test.ts test/alertEngine.test.ts`, then `pnpm --filter @cta/server test`
Expected: ALL green (existing alertEngine tests unaffected — `onRecord` is optional).

- [ ] **Step 8.7: Commit**

```bash
git add apps/server/src/engine/types.ts apps/server/src/engine/alertEngine.ts apps/server/src/engine/engine.ts apps/server/test/engineEvents.test.ts apps/server/test/alertEngine.test.ts
git commit -m "feat(engine): scan/alert/health event emission; AlertEngine onRecord + digest-flushing stop"
```

---

### Task 9: LiveFeed SSE hub

**Model:** fable

**Files:**
- Create: `apps/server/src/engine/liveFeed.ts`
- Test: `apps/server/test/liveFeed.test.ts`

- [ ] **Step 9.1: Write the failing test**

```ts
// apps/server/test/liveFeed.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { LiveFeed, sseFrame } from '../src/engine/liveFeed';
import { nullLogger } from '../src/engine/logger';

/** Minimal ServerResponse stand-in: scripted write() returns, captured chunks, drain/close events. */
class FakeRes extends EventEmitter {
  chunks: string[] = [];
  writeReturns: boolean[] = [];
  ended = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.writeReturns.length ? this.writeReturns.shift()! : true;
  }
  end(): void { this.ended = true; }
}

describe('sseFrame', () => {
  it('formats an SSE frame', () => {
    expect(sseFrame('scan', { a: 1 })).toBe('event: scan\ndata: {"a":1}\n\n');
  });
});

describe('LiveFeed', () => {
  let feed: LiveFeed;
  beforeEach(() => { feed = new LiveFeed({ log: nullLogger, maxBuffered: 3, heartbeatMs: 60_000 }); });
  afterEach(() => { feed.destroy(); });

  it('replays snapshot frames on connect and broadcasts to every client', () => {
    const a = new FakeRes(); const b = new FakeRes();
    feed.addClient(a as never, [sseFrame('snapshot', { n: 1 })]);
    feed.addClient(b as never, [sseFrame('snapshot', { n: 2 })]);
    expect(a.chunks[0]).toContain('"n":1');
    expect(b.chunks[0]).toContain('"n":2');
    feed.broadcast('scan', { coin: 'BTC' });
    expect(a.chunks.some((c) => c.startsWith('event: scan'))).toBe(true);
    expect(b.chunks.some((c) => c.startsWith('event: scan'))).toBe(true);
    expect(feed.clientCount).toBe(2);
  });

  it('buffers for a blocked client and flushes on drain, preserving order', () => {
    const res = new FakeRes();
    res.writeReturns = [false]; // first write blocks
    feed.addClient(res as never, []);
    feed.broadcast('scan', { i: 1 }); // written, returns false → blocked
    feed.broadcast('scan', { i: 2 }); // buffered
    feed.broadcast('scan', { i: 3 }); // buffered
    expect(res.chunks).toHaveLength(1);
    res.emit('drain');
    expect(res.chunks.map((c) => c.match(/"i":(\d)/)![1])).toEqual(['1', '2', '3']);
  });

  it('drops oldest beyond maxBuffered, never blocking the broadcaster', () => {
    const res = new FakeRes();
    res.writeReturns = [false];
    feed.addClient(res as never, []);
    feed.broadcast('scan', { i: 0 }); // blocks
    for (let i = 1; i <= 5; i++) feed.broadcast('scan', { i }); // 5 buffered, cap 3 → drop 1,2
    res.emit('drain');
    expect(res.chunks.map((c) => c.match(/"i":(\d)/)![1])).toEqual(['0', '3', '4', '5']);
  });

  it('removes a client on close and on write error', () => {
    const a = new FakeRes(); const b = new FakeRes();
    feed.addClient(a as never, []);
    feed.addClient(b as never, []);
    a.emit('close');
    expect(feed.clientCount).toBe(1);
    b.write = () => { throw new Error('EPIPE'); };
    feed.broadcast('scan', {});
    expect(feed.clientCount).toBe(0);
  });

  it('heartbeats all clients on the configured interval', () => {
    vi.useFakeTimers();
    try {
      const hb = new LiveFeed({ log: nullLogger, heartbeatMs: 1_000 });
      const res = new FakeRes();
      hb.addClient(res as never, []);
      vi.advanceTimersByTime(2_100);
      expect(res.chunks.filter((c) => c.startsWith(':')).length).toBeGreaterThanOrEqual(2);
      hb.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy ends every client connection', () => {
    const res = new FakeRes();
    feed.addClient(res as never, []);
    feed.destroy();
    expect(res.ended).toBe(true);
    expect(feed.clientCount).toBe(0);
  });
});
```

- [ ] **Step 9.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/liveFeed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement `apps/server/src/engine/liveFeed.ts`**

```ts
// apps/server/src/engine/liveFeed.ts
import type { ServerResponse } from 'node:http';
import type { EngineLogger } from './logger';

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface LiveFeedOptions {
  log: EngineLogger;
  /** per-client pending-frame cap; beyond it the OLDEST buffered frames are dropped */
  maxBuffered?: number;
  heartbeatMs?: number;
}

interface Client {
  id: number;
  res: ServerResponse;
  buffer: string[];
  blocked: boolean;
}

/**
 * SSE fan-out hub. A slow client never blocks the engine: writes that report
 * backpressure flip the client to buffered mode (drop-oldest beyond maxBuffered),
 * flushed on 'drain'. Headers are written by the route before addClient.
 */
export class LiveFeed {
  private clients = new Map<number, Client>();
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private log: EngineLogger;
  private maxBuffered: number;
  private heartbeatMs: number;

  constructor(opts: LiveFeedOptions) {
    this.log = opts.log;
    this.maxBuffered = opts.maxBuffered ?? 256;
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
  }

  get clientCount(): number { return this.clients.size; }

  addClient(res: ServerResponse, snapshotFrames: string[]): number {
    const client: Client = { id: this.nextId++, res, buffer: [], blocked: false };
    this.clients.set(client.id, client);
    res.on('drain', () => this.flush(client));
    res.on('close', () => this.removeClient(client.id));
    res.on('error', () => this.removeClient(client.id));
    for (const f of snapshotFrames) this.send(client, f);
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const c of this.clients.values()) this.send(c, ': ping\n\n');
      }, this.heartbeatMs);
      this.heartbeat.unref?.();
    }
    this.log.info({ client: client.id, clients: this.clients.size }, 'live client connected');
    return client.id;
  }

  removeClient(id: number): void {
    if (!this.clients.delete(id)) return;
    this.log.info({ client: id, clients: this.clients.size }, 'live client disconnected');
    if (this.clients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const frame = sseFrame(event, data);
    for (const c of [...this.clients.values()]) this.send(c, frame);
  }

  destroy(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const c of [...this.clients.values()]) {
      try { c.res.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }

  private send(c: Client, frame: string): void {
    if (c.blocked) {
      c.buffer.push(frame);
      if (c.buffer.length > this.maxBuffered) c.buffer.splice(0, c.buffer.length - this.maxBuffered);
      return;
    }
    try {
      if (!c.res.write(frame)) c.blocked = true;
    } catch {
      this.removeClient(c.id);
    }
  }

  private flush(c: Client): void {
    c.blocked = false;
    while (c.buffer.length > 0 && !c.blocked) {
      const frame = c.buffer.shift()!;
      try {
        if (!c.res.write(frame)) c.blocked = true;
      } catch {
        this.removeClient(c.id);
        return;
      }
    }
  }
}
```

- [ ] **Step 9.4: Run the test to verify it passes**

Run: `pnpm --filter @cta/server exec vitest run test/liveFeed.test.ts`
Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add apps/server/src/engine/liveFeed.ts apps/server/test/liveFeed.test.ts
git commit -m "feat(engine): SSE LiveFeed hub with per-client drop-oldest buffering"
```

---

### Task 10: `GET /live` route + snapshot + server wiring

**Model:** opus

**Files:**
- Create: `apps/server/src/routes/live.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/liveRoute.test.ts`

- [ ] **Step 10.1: Write the failing test** — SSE streams, so this test uses a real listening socket, not `inject`:

```ts
// apps/server/test/liveRoute.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { LiveFeed } from '../src/engine/liveFeed';
import { nullLogger } from '../src/engine/logger';

let app: FastifyInstance | null = null;
afterEach(async () => { if (app) { await app.close(); app = null; } });

/** Read SSE frames from a fetch body until `count` event frames arrived (or timeout). */
async function readEvents(body: ReadableStream<Uint8Array>, count: number, timeoutMs = 5_000):
  Promise<{ event: string; data: unknown }[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: unknown }[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

describe('GET /live', () => {
  it('replays the snapshot first, then streams broadcast events, to multiple clients', async () => {
    const feed = new LiveFeed({ log: nullLogger });
    app = buildApp({
      live: { feed, snapshot: () => ({ scans: [{ coin: 'BTC' }], alerts: [], health: { wsConnected: true, ts: 1 } }) },
    });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const res1 = await fetch(`${base}/live`, { headers: { accept: 'text/event-stream' } });
    const res2 = await fetch(`${base}/live`, { headers: { accept: 'text/event-stream' } });
    expect(res1.headers.get('content-type')).toContain('text/event-stream');

    // wait for both clients to register before broadcasting
    const t0 = Date.now();
    while (feed.clientCount < 2 && Date.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 10));
    feed.broadcast('scan', { coin: 'ETH' });

    const [ev1, ev2] = await Promise.all([readEvents(res1.body!, 2), readEvents(res2.body!, 2)]);
    for (const evs of [ev1, ev2]) {
      expect(evs[0].event).toBe('snapshot');
      expect(evs[0].data).toMatchObject({ scans: [{ coin: 'BTC' }] });
      expect(evs[1]).toEqual({ event: 'scan', data: { coin: 'ETH' } });
    }
    feed.destroy();
  });

  it('is absent when live deps are not provided', async () => {
    app = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/live' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 10.2: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/liveRoute.test.ts`
Expected: FAIL — 404 / `live` not a known dep.

- [ ] **Step 10.3: Implement `apps/server/src/routes/live.ts`**

```ts
// apps/server/src/routes/live.ts
import type { FastifyInstance } from 'fastify';
import { LiveFeed, sseFrame } from '../engine/liveFeed';

export interface LiveRouteDeps {
  feed: LiveFeed;
  /** rankings + recent alerts + health, JSON-serializable, computed per connection */
  snapshot: () => unknown;
}

export function registerLiveRoute(app: FastifyInstance, deps: LiveRouteDeps): void {
  app.get('/live', (req, reply) => {
    reply.hijack(); // raw streaming — Fastify must not touch the response again
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    deps.feed.addClient(res, [sseFrame('snapshot', deps.snapshot())]);
  });
}
```

- [ ] **Step 10.4: Register in `apps/server/src/app.ts`** — `AppDeps` gains:

```ts
  live?: LiveRouteDeps;
```

(import `type { LiveRouteDeps }` and `registerLiveRoute` from `./routes/live`), and in `buildApp`:

```ts
  if (deps.live) registerLiveRoute(app, deps.live);
```

- [ ] **Step 10.5: Wire `apps/server/src/server.ts`** — in the `ENGINE_ENABLED` block (after the engine and watchdog are constructed):

```ts
import { LiveFeed } from './engine/liveFeed';
```

```ts
let live: { feed: LiveFeed; snapshot: () => unknown } | undefined;
// inside the ENGINE_ENABLED block:
  const feed = new LiveFeed({ log: engineLog });
  engine.events.on('scan', (e) => feed.broadcast('scan', e));
  engine.events.on('alert', (r) => feed.broadcast('alert', r));
  engine.events.on('health', (h) => feed.broadcast('health', h));
  live = { feed, snapshot: () => ({ ...engine.liveSnapshot(), alerts: alertStore.recent(50) }) };
```

and pass `live` into the final `buildApp({...})` call.

- [ ] **Step 10.6: Run the test, then the full server suite**

Run: `pnpm --filter @cta/server exec vitest run test/liveRoute.test.ts && pnpm --filter @cta/server test`
Expected: ALL green.

- [ ] **Step 10.7: Commit**

```bash
git add apps/server/src/routes/live.ts apps/server/src/app.ts apps/server/src/server.ts apps/server/test/liveRoute.test.ts
git commit -m "feat(server): GET /live SSE endpoint with connect snapshot"
```

---

### Task 11: integration test — fake-WS engine with SSE attached

**Model:** fable

**Files:**
- Test: `apps/server/test/engineLive.test.ts` (new; no production code expected — this task PROVES Tasks 6/8/9/10 compose; if it exposes a defect, fix it in the owning module and record the deviation)

- [ ] **Step 11.1: Write the test**

Follow `apps/server/test/engineIntegration.test.ts` for the harness idioms (fakeHlWs, stub pool, stub candleService/marketsService, `until` helper, in-memory db). The new assertions:

```ts
// apps/server/test/engineLive.test.ts — shape (reuse engineIntegration.test.ts fixtures verbatim
// for closed candles, qualifiedResult, provisionalPlan, fake services):
//
// 1. Build the Engine exactly as engineIntegration.test.ts does (fake WS via startFakeHlWs,
//    stub pool returning an AnalyzeResult whose plans include one active high-confidence plan,
//    confirmedMinConfidence 0 so the close scan fires a confirmed-new alert),
//    PLUS: maSelectionStore (in-memory db) per Task 6.
// 2. const feed = new LiveFeed({ log: nullLogger });
//    engine.events.on('scan', (e) => feed.broadcast('scan', e));
//    engine.events.on('alert', (r) => feed.broadcast('alert', r));
//    engine.events.on('health', (h) => feed.broadcast('health', h));
//    const app = buildApp({ live: { feed, snapshot: () => ({ ...engine.liveSnapshot(), alerts: alertStore.recent(50) }) } });
//    const base = await app.listen({ port: 0, host: '127.0.0.1' });
// 3. await engine.start(); wait until a first close-scan completed (until(() => engine.status().scansCompleted >= 1)).
// 4. Connect: const res = await fetch(`${base}/live`); read frames with the readEvents helper
//    from liveRoute.test.ts (copy it into this file or extract to test/helpers/sse.ts and
//    update liveRoute.test.ts to import it — prefer the helper extraction).
// 5. Assert the FIRST event is `snapshot` and it contains:
//      - scans: the BTC|15m ranking entry with plan.confidence matching the stub plan
//      - alerts: the persisted confirmed-new row (kind 'confirmed-new', coin 'BTC')
//      - health: wsConnected true, numeric ts
// 6. Drive the fake WS to close another 15m candle (the engineIntegration file shows how it
//    pushes candle messages; reuse that exact mechanism) → assert over the SAME open stream:
//      - a `scan` event for BTC|15m arrives
//      - any alert events for that close arrive AFTER the scan event (Task 8 ordering)
//      - a `health` event arrives within ~3s (2s timer)
// 7. engine.stop(); app.close(); fake.close(); feed.destroy().
```

The exact frame-pump details depend on fakeHlWs's API — mirror `engineIntegration.test.ts` line-for-line for the WS driving; the SSE side is fully specified above. Timeout generously (`it(..., 15_000)`).

- [ ] **Step 11.2: Run it**

Run: `pnpm --filter @cta/server exec vitest run test/engineLive.test.ts`
Expected: PASS. If it fails, debug the composing modules (most likely candidates: event emission order in `pumpScans`, snapshot construction in `server.ts`-equivalent wiring) — fix in the owning module, re-run that module's unit tests too.

- [ ] **Step 11.3: Run the full server suite**

Run: `pnpm --filter @cta/server test`
Expected: ALL green.

- [ ] **Step 11.4: Commit**

```bash
git add apps/server/test/engineLive.test.ts apps/server/test/helpers/
git commit -m "test(server): integration — fake-WS engine streams snapshot+scan/alert/health over SSE"
```

---

### Task 12: `@fastify/static` web serving

**Model:** sonnet

**Files:**
- Modify: `apps/server/package.json` (new dep), `apps/server/src/app.ts`, `apps/server/src/server.ts`
- Test: `apps/server/test/staticServe.test.ts`

- [ ] **Step 12.1: Add the dependency**

Run: `pnpm --filter @cta/server add @fastify/static@^7`
Expected: installs v7.x (the Fastify 4 line — v8 requires Fastify 5).

- [ ] **Step 12.2: Write the failing test**

```ts
// apps/server/test/staticServe.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';

describe('static web serving', () => {
  it('serves index.html and assets from webDistDir', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cta-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html><body>cta-dashboard</body></html>');
    writeFileSync(join(dist, 'app.js'), 'console.log(1)');
    const app = buildApp({ webDistDir: dist });
    await app.ready();
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('cta-dashboard');
    const asset = await app.inject({ method: 'GET', url: '/app.js' });
    expect(asset.statusCode).toBe(200);
  });

  it('still routes /api and /live family endpoints with static registered', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cta-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    const app = buildApp({ webDistDir: dist });
    await app.ready();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');
  });

  it('a missing dist dir degrades to API-only with a warning, not a crash', async () => {
    const app = buildApp({ webDistDir: '/nonexistent/web/dist' });
    await app.ready();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(404);
  });
});
```

- [ ] **Step 12.3: Run it to verify it fails**

Run: `pnpm --filter @cta/server exec vitest run test/staticServe.test.ts`
Expected: FAIL — `webDistDir` unknown, GET / 404 in the first test.

- [ ] **Step 12.4: Implement in `apps/server/src/app.ts`**

```ts
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
```

`AppDeps` gains:

```ts
  /** absolute path to the built web app; missing/empty → API-only with a warning */
  webDistDir?: string;
```

In `buildApp`, after the route registrations:

```ts
  if (deps.webDistDir) {
    if (existsSync(join(deps.webDistDir, 'index.html'))) {
      void app.register(fastifyStatic, { root: deps.webDistDir });
    } else {
      console.warn(`web dist not found at ${deps.webDistDir} — serving API only (run: pnpm --filter @cta/web build)`);
    }
  }
```

(Explicit routes like `/api/*` and `/live` win over the static wildcard in find-my-way — no ordering concern.)

- [ ] **Step 12.5: Wire `apps/server/src/server.ts`** — resolve the dist dir relative to this file (the server's cwd is `apps/server` under pnpm, so cwd-relative paths are wrong):

```ts
import { fileURLToPath } from 'node:url';
```

```ts
const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
```

and add `webDistDir` to the final `buildApp({...})` call. (From `apps/server/src/server.ts`, `../../web/dist` resolves to `apps/web/dist`.)

- [ ] **Step 12.6: Run the test, then the full server suite**

Run: `pnpm --filter @cta/server exec vitest run test/staticServe.test.ts && pnpm --filter @cta/server test`
Expected: ALL green.

- [ ] **Step 12.7: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/app.ts apps/server/src/server.ts apps/server/test/staticServe.test.ts
git commit -m "feat(server): serve built web app via @fastify/static with API-only fallback"
```

---

### Task 13: web — URL-param parsing helper

**Model:** sonnet

**Files:**
- Create: `apps/web/src/urlParams.ts`
- Test: `apps/web/test/urlParams.test.ts`

(App.tsx integration happens in Task 17 — this task ships the pure helper only.)

- [ ] **Step 13.1: Write the failing test**

```ts
// apps/web/test/urlParams.test.ts
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
```

- [ ] **Step 13.2: Run it to verify it fails**

Run: `pnpm --filter @cta/web exec vitest run test/urlParams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 13.3: Implement `apps/web/src/urlParams.ts`**

```ts
// apps/web/src/urlParams.ts
import { SUPPORTED_INTERVALS } from './intervals';
import type { Interval } from './intervals';

export interface CoinInterval { coin: string; interval: Interval }

/** Deep-link support: ?coin=&interval= override the defaults; invalid values are ignored. */
export function applyUrlParams<T extends CoinInterval>(defaults: T, search: string): T {
  const params = new URLSearchParams(search);
  const coin = params.get('coin');
  const interval = params.get('interval');
  return {
    ...defaults,
    ...(coin ? { coin: coin.toUpperCase() } : {}),
    ...(interval && (SUPPORTED_INTERVALS as readonly string[]).includes(interval)
      ? { interval: interval as Interval } : {}),
  };
}
```

- [ ] **Step 13.4: Run the test to verify it passes**

Run: `pnpm --filter @cta/web exec vitest run test/urlParams.test.ts`
Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
git add apps/web/src/urlParams.ts apps/web/test/urlParams.test.ts
git commit -m "feat(web): deep-link URL param parsing"
```

---

### Task 14: web — `useLiveFeed` hook

**Model:** opus

**Files:**
- Modify: `apps/web/src/api/types.ts` (live payload types)
- Create: `apps/web/src/state/useLiveFeed.ts`
- Test: `apps/web/test/useLiveFeed.test.ts`

- [ ] **Step 14.1: Add the wire types** to `apps/web/src/api/types.ts` (append; also add `SignalDirection` to the re-export list at the top of the file):

```ts
// ---- live feed (SSE /live) ----

export type AlertKind = 'provisional-new' | 'provisional-confirmed' | 'provisional-withdrawn' | 'confirmed-new' | 'digest';

export interface AlertPayload {
  kind: AlertKind;
  identity: string;
  coin: string;
  interval: string;
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
  ts: number;
  note?: string;
  link: string;
}

export interface LiveAlert {
  ts: number;
  kind: AlertKind;
  coin: string;
  interval: string;
  payload: AlertPayload;
}

export interface ScanPlanSummary {
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
}

export interface LiveScanRow {
  coin: string;
  interval: Interval;
  ts: number;
  candleCount: number;
  plan: ScanPlanSummary | null;
}

export interface LiveHealth {
  wsConnected: boolean;
  lastTickAgeMs: number;
  queueDepth: number;
  busyWorkers: number;
  coinsTracked: number;
  coinsLive: number;
  scansCompleted: number;
  ts: number;
}

export interface LiveSnapshot {
  scans: LiveScanRow[];
  alerts: LiveAlert[];
  health: LiveHealth;
}
```

(`SignalDirection` must be added to the `export type { ... } from '@cta/core'` list.)

- [ ] **Step 14.2: Write the failing test**

```ts
// apps/web/test/useLiveFeed.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveFeed, MAX_FEED_ALERTS } from '../src/state/useLiveFeed';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, Listener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const scan = (coin: string, interval: string, confidence: number, ts = 1) => ({
  coin, interval, ts, candleCount: 100,
  plan: { direction: 'bullish', setup: ['ma-golden-cross'], entry: 1, stop: 0.9, target: 1.2, rr: 2, confidence },
});
const alert = (coin: string, kind: string, ts: number) => ({
  ts, kind, coin, interval: '1h',
  payload: { kind, identity: `${coin}-${ts}`, coin, interval: '1h', direction: 'bullish', setup: ['ma-golden-cross'], entry: 1, stop: 0.9, target: 1.2, rr: 2, confidence: 80, ts, link: '' },
});

describe('useLiveFeed', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
  });
  afterEach(() => { delete (globalThis as Record<string, unknown>).EventSource; });

  it('seeds state from the snapshot and tracks connection', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    expect(result.current.connected).toBe(false);
    act(() => { es.onopen?.(); });
    expect(result.current.connected).toBe(true);
    act(() => {
      es.emit('snapshot', {
        scans: [scan('BTC', '1h', 80)],
        alerts: [alert('BTC', 'confirmed-new', 5), alert('BTC', 'digest', 4)],
        health: { wsConnected: true, lastTickAgeMs: 100, queueDepth: 0, busyWorkers: 0, coinsTracked: 5, coinsLive: 5, scansCompleted: 1, ts: 9 },
      });
    });
    expect(result.current.scans).toHaveLength(1);
    expect(result.current.alerts).toHaveLength(1); // digest filtered out
    expect(result.current.health?.wsConnected).toBe(true);
  });

  it('scan events update rows in place by coin×interval', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => {
      es.emit('scan', scan('BTC', '1h', 60, 1));
      es.emit('scan', scan('BTC', '4h', 70, 2));
      es.emit('scan', scan('BTC', '1h', 90, 3)); // replaces the first
    });
    expect(result.current.scans).toHaveLength(2);
    const btc1h = result.current.scans.find((s) => s.coin === 'BTC' && s.interval === '1h');
    expect(btc1h?.plan?.confidence).toBe(90);
  });

  it('alert events prepend newest-first, skip digests, and cap the feed', () => {
    const { result } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => {
      for (let i = 0; i < MAX_FEED_ALERTS + 10; i++) es.emit('alert', alert('BTC', 'confirmed-new', i));
      es.emit('alert', alert('ETH', 'digest', 999));
    });
    expect(result.current.alerts).toHaveLength(MAX_FEED_ALERTS);
    expect(result.current.alerts[0].ts).toBe(MAX_FEED_ALERTS + 9); // newest first
  });

  it('onerror flips connected off; close on unmount', () => {
    const { result, unmount } = renderHook(() => useLiveFeed());
    const es = FakeEventSource.instances[0];
    act(() => { es.onopen?.(); });
    act(() => { es.onerror?.(); });
    expect(result.current.connected).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});
```

- [ ] **Step 14.3: Run it to verify it fails**

Run: `pnpm --filter @cta/web exec vitest run test/useLiveFeed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 14.4: Implement `apps/web/src/state/useLiveFeed.ts`**

```ts
// apps/web/src/state/useLiveFeed.ts
import { useEffect, useMemo, useState } from 'react';
import type { LiveAlert, LiveHealth, LiveScanRow, LiveSnapshot } from '../api/types';

export const MAX_FEED_ALERTS = 200;

export interface LiveFeedState {
  connected: boolean;
  scans: LiveScanRow[];      // latest per coin×interval, insertion order
  alerts: LiveAlert[];       // newest first, digests excluded
  health: LiveHealth | null;
}

const keyOf = (s: LiveScanRow): string => `${s.coin}|${s.interval}`;
const dropDigests = (alerts: LiveAlert[]): LiveAlert[] => alerts.filter((a) => a.kind !== 'digest');

/** Subscribes to GET /live (SSE). EventSource auto-reconnects; each reconnect replays a fresh snapshot. */
export function useLiveFeed(url = '/live'): LiveFeedState {
  const [connected, setConnected] = useState(false);
  const [scanMap, setScanMap] = useState<Map<string, LiveScanRow>>(new Map());
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [health, setHealth] = useState<LiveHealth | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('snapshot', (ev) => {
      const snap = JSON.parse((ev as MessageEvent).data) as LiveSnapshot;
      setScanMap(new Map(snap.scans.map((s) => [keyOf(s), s])));
      setAlerts(dropDigests(snap.alerts).slice(0, MAX_FEED_ALERTS));
      setHealth(snap.health);
    });
    es.addEventListener('scan', (ev) => {
      const s = JSON.parse((ev as MessageEvent).data) as LiveScanRow;
      setScanMap((prev) => new Map(prev).set(keyOf(s), s));
    });
    es.addEventListener('alert', (ev) => {
      const a = JSON.parse((ev as MessageEvent).data) as LiveAlert;
      if (a.kind === 'digest') return;
      setAlerts((prev) => [a, ...prev].slice(0, MAX_FEED_ALERTS));
    });
    es.addEventListener('health', (ev) => {
      setHealth(JSON.parse((ev as MessageEvent).data) as LiveHealth);
    });
    return () => es.close();
  }, [url]);

  const scans = useMemo(() => [...scanMap.values()], [scanMap]);
  return { connected, scans, alerts, health };
}
```

- [ ] **Step 14.5: Run the test to verify it passes**

Run: `pnpm --filter @cta/web exec vitest run test/useLiveFeed.test.ts`
Expected: PASS.

- [ ] **Step 14.6: Commit**

```bash
git add apps/web/src/api/types.ts apps/web/src/state/useLiveFeed.ts apps/web/test/useLiveFeed.test.ts
git commit -m "feat(web): useLiveFeed SSE hook with snapshot seeding"
```

---

### Task 15: web — HealthChip + Toolbar slot

**Model:** sonnet

**Files:**
- Create: `apps/web/src/components/HealthChip.tsx`
- Modify: `apps/web/src/components/Toolbar.tsx` (chip slot only — the 'alerts' tab comes in Task 17)
- Test: `apps/web/test/healthChip.test.tsx`

- [ ] **Step 15.1: Write the failing test**

```tsx
// apps/web/test/healthChip.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthChip, healthLevel } from '../src/components/HealthChip';
import type { LiveHealth } from '../src/api/types';

const health = (over: Partial<LiveHealth> = {}): LiveHealth => ({
  wsConnected: true, lastTickAgeMs: 500, queueDepth: 2, busyWorkers: 1,
  coinsTracked: 140, coinsLive: 138, scansCompleted: 1000, ts: 1, ...over,
});

describe('healthLevel', () => {
  it('red when the feed is disconnected or engine WS is down or health unknown', () => {
    expect(healthLevel(false, health())).toBe('red');
    expect(healthLevel(true, null)).toBe('red');
    expect(healthLevel(true, health({ wsConnected: false }))).toBe('red');
  });
  it('amber when ticks are stale or the queue is deep', () => {
    expect(healthLevel(true, health({ lastTickAgeMs: 20_000 }))).toBe('amber');
    expect(healthLevel(true, health({ lastTickAgeMs: -1 }))).toBe('amber');
    expect(healthLevel(true, health({ queueDepth: 30 }))).toBe('amber');
  });
  it('green when connected, ws up, ticks fresh, queue shallow', () => {
    expect(healthLevel(true, health())).toBe('green');
  });
});

describe('HealthChip', () => {
  it('exposes its level via data-state and shows live coin count when green', () => {
    render(<HealthChip connected={true} health={health()} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('green');
    expect(chip.textContent).toContain('138');
  });
  it('shows offline when red', () => {
    render(<HealthChip connected={false} health={null} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('red');
    expect(chip.textContent?.toLowerCase()).toContain('offline');
  });
  it('shows degraded when amber', () => {
    render(<HealthChip connected={true} health={health({ queueDepth: 99 })} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('amber');
    expect(chip.textContent?.toLowerCase()).toContain('degraded');
  });
});
```

- [ ] **Step 15.2: Run it to verify it fails**

Run: `pnpm --filter @cta/web exec vitest run test/healthChip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 15.3: Implement `apps/web/src/components/HealthChip.tsx`**

```tsx
// apps/web/src/components/HealthChip.tsx
import type { LiveHealth } from '../api/types';

export type HealthLevel = 'green' | 'amber' | 'red';

const STALE_TICK_MS = 15_000;
const DEEP_QUEUE = 25;

export function healthLevel(connected: boolean, health: LiveHealth | null): HealthLevel {
  if (!connected || !health || !health.wsConnected) return 'red';
  if (health.lastTickAgeMs < 0 || health.lastTickAgeMs > STALE_TICK_MS || health.queueDepth > DEEP_QUEUE) return 'amber';
  return 'green';
}

const DOT: Record<HealthLevel, string> = {
  green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-500',
};

export function HealthChip({ connected, health }: { connected: boolean; health: LiveHealth | null }) {
  const level = healthLevel(connected, health);
  const label = level === 'red'
    ? 'engine offline'
    : level === 'amber'
      ? `degraded · q${health!.queueDepth} · tick ${health!.lastTickAgeMs < 0 ? '—' : `${Math.round(health!.lastTickAgeMs / 1000)}s`}`
      : `live · ${health!.coinsLive} coins`;
  const title = health
    ? `ws ${health.wsConnected ? 'up' : 'down'} · tick age ${health.lastTickAgeMs}ms · queue ${health.queueDepth} · scans ${health.scansCompleted}`
    : 'no engine feed';
  return (
    <span
      data-testid="health-chip"
      data-state={level}
      title={title}
      className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[level]}`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 15.4: Add the Toolbar slot** — in `apps/web/src/components/Toolbar.tsx`, add an optional prop and render it just before the status span:

```tsx
  healthChip?: React.ReactNode;
```

(add `import type React from 'react';` at the top) and change the trailing span line to:

```tsx
      <span className="ml-auto flex items-center gap-3">
        {props.healthChip}
        <span className="text-xs text-slate-500">{props.status}</span>
      </span>
```

(the old `ml-auto` moves to the wrapper).

- [ ] **Step 15.5: Run the tests** (healthChip + the existing toolbar suite)

Run: `pnpm --filter @cta/web exec vitest run test/healthChip.test.tsx test/toolbar.test.tsx`
Expected: PASS (the chip prop is optional — existing toolbar tests unaffected).

- [ ] **Step 15.6: Commit**

```bash
git add apps/web/src/components/HealthChip.tsx apps/web/src/components/Toolbar.tsx apps/web/test/healthChip.test.tsx
git commit -m "feat(web): engine health chip with green/amber/red mapping"
```

---

### Task 16: web — ScannerPane Live mode

**Model:** opus

**Files:**
- Modify: `apps/web/src/components/ScannerPane.tsx`
- Modify: `apps/web/src/components/SignalsPanel.tsx` (forward the live prop)
- Test: `apps/web/test/scannerPane.test.tsx` (extend)

- [ ] **Step 16.1: Write the failing tests** — append to `apps/web/test/scannerPane.test.tsx` (keep existing manual-scan tests; they must keep passing because the default `live` prop is disconnected):

```tsx
import type { LiveScanRow } from '../src/api/types';

const liveRow = (coin: string, interval: string, confidence: number, ts = 1): LiveScanRow => ({
  coin, interval: interval as LiveScanRow['interval'], ts, candleCount: 2000,
  plan: { direction: 'bullish', setup: ['ma-golden-cross'], entry: 10, stop: 9, target: 12, rr: 2, confidence },
});

describe('ScannerPane live mode', () => {
  it('renders live rows sorted by confidence without clicking, filtered to the current interval', () => {
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: true, rows: [liveRow('ETH', '1h', 60), liveRow('BTC', '1h', 90), liveRow('SOL', '4h', 99), { ...liveRow('DOGE', '1h', 0), plan: null }] }}
    />);
    const rows = screen.getAllByTestId('scan-row');
    expect(rows).toHaveLength(2); // SOL is 4h, DOGE has no plan
    expect(rows[0].textContent).toContain('BTC'); // confidence desc
    expect(rows[0].dataset.live).toBe('1');
    expect(rows[0].dataset.ts).toBe('1');
    expect(screen.getByTestId('scan-live-indicator')).toBeInTheDocument();
  });

  it('falls back to manual mode when the feed is disconnected', () => {
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: false, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    expect(screen.queryAllByTestId('scan-row')).toHaveLength(0); // no live rows shown
    expect(screen.getByTestId('scan-start')).toBeDisabled(); // no markets loaded in this render — same as today
  });

  it('clicking Scan market switches to manual results; the Live button returns', async () => {
    const user = userEvent.setup();
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: true, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    expect(screen.getAllByTestId('scan-row')).toHaveLength(1);
    await user.click(screen.getByTestId('scan-start')); // manual sweep of zero markets → empty
    expect(screen.queryAllByTestId('scan-row')).toHaveLength(0);
    await user.click(screen.getByTestId('scan-live'));
    expect(screen.getAllByTestId('scan-row')).toHaveLength(1);
  });

  it('live row click selects the coin', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={(c) => picked.push(c)}
      live={{ connected: true, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    await user.click(screen.getAllByTestId('scan-row')[0]);
    expect(picked).toEqual(['BTC']);
  });
});
```

(adapt imports — `userEvent`, `render`, `screen`, `DEFAULT_SIGNALS_SETTINGS` — to what the file already uses; existing tests that render `<ScannerPane markets=... />` without `live` keep working via the default prop below.)

- [ ] **Step 16.2: Run to verify the new tests fail**

Run: `pnpm --filter @cta/web exec vitest run test/scannerPane.test.tsx`
Expected: new tests FAIL (unknown `live` prop), old tests PASS.

- [ ] **Step 16.3: Implement** — replace `apps/web/src/components/ScannerPane.tsx` with:

```tsx
import { useState } from 'react';
import { useMarketScan } from '../state/useMarketScan';
import type { Interval, LiveScanRow, Market } from '../api/types';
import type { SignalsSettings } from '../state/signalsSettings';

export interface ScannerLiveProps { connected: boolean; rows: LiveScanRow[] }

export function ScannerPane({ markets, interval, settings, onCoin, live = { connected: false, rows: [] } }: {
  markets: Market[];
  interval: Interval;
  settings: SignalsSettings;
  onCoin: (c: string) => void;
  live?: ScannerLiveProps;
}) {
  const { rows, done, total, scanning, start } = useMarketScan(markets, interval, settings);
  const [manualMode, setManualMode] = useState(false);
  const liveMode = live.connected && !manualMode;

  const liveRanked = live.rows
    .filter((r) => r.interval === interval && r.plan)
    .sort((a, b) => b.plan!.confidence - a.plan!.confidence);
  const ranked = rows
    .filter((r) => r.status === 'ok' && r.plan)
    .sort((a, b) => b.plan!.confidence.score - a.plan!.confidence.score);
  const skipped = rows.filter((r) => r.status !== 'ok');

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          data-testid="scan-start"
          onClick={() => { setManualMode(true); start(); }}
          disabled={scanning || (markets.length === 0 && !liveMode)}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Scan market
        </button>
        {live.connected && manualMode && (
          <button
            data-testid="scan-live"
            onClick={() => setManualMode(false)}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-green-300 hover:bg-slate-700"
          >
            ● Live
          </button>
        )}
        {liveMode ? (
          <span data-testid="scan-live-indicator" className="flex items-center gap-1 text-xs text-green-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" /> live · {interval}
          </span>
        ) : (
          <span className="text-xs text-slate-400">top {settings.scanTopN} by 24h volume · {interval}</span>
        )}
        {!liveMode && total > 0 && <span data-testid="scan-progress" className="text-xs text-slate-400">{done}/{total}</span>}
      </div>
      <table className="w-full border-collapse text-xs text-slate-200">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-2 py-1">#</th><th className="px-2 py-1">coin</th><th className="px-2 py-1">dir</th>
            <th className="px-2 py-1 text-right">conf</th><th className="px-2 py-1">setup</th>
            <th className="px-2 py-1 text-right">R/R</th><th className="px-2 py-1 text-right">{liveMode ? 'tf' : 'age'}</th>
          </tr>
        </thead>
        <tbody>
          {liveMode && liveRanked.map((r, i) => (
            <tr
              key={`${r.coin}|${r.interval}`} data-testid="scan-row" data-live="1" data-ts={r.ts}
              onClick={() => onCoin(r.coin)}
              className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/60"
            >
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1">{r.coin}</td>
              <td className={`px-2 py-1 ${r.plan!.direction === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                {r.plan!.direction === 'bullish' ? '▲' : '▼'}
              </td>
              <td className="px-2 py-1 text-right font-semibold">{Math.round(r.plan!.confidence)}</td>
              <td className="px-2 py-1">{r.plan!.setup.join(' + ')}</td>
              <td className="px-2 py-1 text-right">{r.plan!.rr.toFixed(2)}</td>
              <td className="px-2 py-1 text-right">{r.interval}</td>
            </tr>
          ))}
          {!liveMode && ranked.map((r, i) => (
            <tr
              key={r.coin} data-testid="scan-row" onClick={() => onCoin(r.coin)}
              className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/60"
            >
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1">{r.coin}</td>
              <td className={`px-2 py-1 ${r.plan!.direction === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                {r.plan!.direction === 'bullish' ? '▲' : '▼'}
              </td>
              <td className="px-2 py-1 text-right font-semibold">{Math.round(r.plan!.confidence.score)}</td>
              <td className="px-2 py-1">{r.plan!.setup.join(' + ')}</td>
              <td className="px-2 py-1 text-right">{r.plan!.rr.toFixed(2)}</td>
              <td className="px-2 py-1 text-right">{r.plan!.ageCandles}c</td>
            </tr>
          ))}
          {!liveMode && skipped.map((r) => (
            <tr key={r.coin} data-testid="scan-skip" className="border-b border-slate-800 opacity-50">
              <td className="px-2 py-1" />
              <td className="px-2 py-1">{r.coin}</td>
              <td className="px-2 py-1" colSpan={5}>
                {r.status === 'thin'
                  ? 'insufficient data'
                  : <span className="rounded bg-red-950 px-1 text-red-300">{r.error}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {liveMode && liveRanked.length === 0 && (
        <p className="text-xs text-slate-500">Waiting for live scan results…</p>
      )}
      {!liveMode && !scanning && total > 0 && ranked.length === 0 && (
        <p className="text-xs text-slate-500">No active signals among the scanned coins.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 16.4: Forward the prop in `apps/web/src/components/SignalsPanel.tsx`** — `SignalsPanelProps` gains:

```tsx
  live?: ScannerLiveProps;
```

(import `type { ScannerLiveProps }` from `./ScannerPane`), destructure it in the component signature with no default, and pass `live={live}` to `<ScannerPane …/>`.

- [ ] **Step 16.5: Run the web suite**

Run: `pnpm --filter @cta/web test`
Expected: ALL green.

- [ ] **Step 16.6: Commit**

```bash
git add apps/web/src/components/ScannerPane.tsx apps/web/src/components/SignalsPanel.tsx apps/web/test/scannerPane.test.tsx
git commit -m "feat(web): scanner Live mode with manual-scan fallback"
```

**Task 16 deviation (recorded during execution, commit `c4cfc5b`):** the plan's new tests used `@testing-library/user-event`, which is NOT installed in apps/web (only `@testing-library/react` + `jest-dom`). Tests rewritten with `fireEvent` (+ `waitFor` for the async manual sweep), preserving all assertions; no dependency added. Task 17's tests must apply the same substitution.

---

### Task 17: web — AlertFeedPane + App integration

**Model:** opus

**Files:**
- Create: `apps/web/src/components/AlertFeedPane.tsx`
- Modify: `apps/web/src/components/Toolbar.tsx` ('alerts' view tab)
- Modify: `apps/web/src/App.tsx` (ALL App-level integration: url params, live feed, chip, scanner live, alerts view, plan-target refactor)
- Test: `apps/web/test/alertFeedPane.test.tsx` (new), `apps/web/test/appPlanLines.test.tsx` + `apps/web/test/toolbar.test.tsx` (extend/adjust)

**Critical subtlety — the plan-reset effect:** today `App.tsx` clears chart plan lines via `useEffect(() => setPlan(null), [config.coin, config.interval])`. An alert click sets coin AND plan in the same handler, so that effect would immediately wipe the just-set plan after the render. The refactor below removes the effect entirely: the plan is stored WITH its coin+interval (`planTarget`) and only passed to the chart when it matches the current selection. Same visible behavior for the existing flows (switching coin hides the lines), no race for the new one.

- [ ] **Step 17.1: Write the failing test for the pane**

```tsx
// apps/web/test/alertFeedPane.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertFeedPane } from '../src/components/AlertFeedPane';
import type { LiveAlert } from '../src/api/types';

const alert = (kind: LiveAlert['kind'], coin: string, ts: number): LiveAlert => ({
  ts, kind, coin, interval: '1h',
  payload: {
    kind, identity: `${coin}-${ts}`, coin, interval: '1h', direction: 'bullish',
    setup: ['ma-golden-cross'], entry: 10, stop: 9, target: 12, rr: 2, confidence: 81, ts, link: '',
  },
});

describe('AlertFeedPane', () => {
  it('lists alerts chronologically (as given) with kind badges', () => {
    render(<AlertFeedPane
      alerts={[alert('provisional-new', 'BTC', 3), alert('provisional-confirmed', 'ETH', 2), alert('provisional-withdrawn', 'SOL', 1)]}
      onOpen={() => {}}
    />);
    const rows = screen.getAllByTestId('alert-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('⚠');
    expect(rows[0].textContent).toContain('BTC');
    expect(rows[1].textContent).toContain('✓');
    expect(rows[2].textContent).toContain('✗');
  });

  it('confirmed-new gets the bell badge', () => {
    render(<AlertFeedPane alerts={[alert('confirmed-new', 'BTC', 1)]} onOpen={() => {}} />);
    expect(screen.getByTestId('alert-row').textContent).toContain('🔔');
  });

  it('clicking an alert opens it', async () => {
    const user = userEvent.setup();
    const opened: LiveAlert[] = [];
    const a = alert('confirmed-new', 'BTC', 1);
    render(<AlertFeedPane alerts={[a]} onOpen={(x) => opened.push(x)} />);
    await user.click(screen.getByTestId('alert-row'));
    expect(opened).toEqual([a]);
  });

  it('renders an empty state', () => {
    render(<AlertFeedPane alerts={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no alerts yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 17.2: Run it to verify it fails**

Run: `pnpm --filter @cta/web exec vitest run test/alertFeedPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 17.3: Implement `apps/web/src/components/AlertFeedPane.tsx`**

```tsx
// apps/web/src/components/AlertFeedPane.tsx
import type { AlertKind, LiveAlert } from '../api/types';

const BADGE: Record<AlertKind, string> = {
  'provisional-new': '⚠',
  'provisional-confirmed': '✓',
  'provisional-withdrawn': '✗',
  'confirmed-new': '🔔',
  digest: '📦', // digests are filtered out upstream; kept for type-exhaustiveness
};

export function AlertFeedPane({ alerts, onOpen }: {
  alerts: LiveAlert[];
  onOpen: (a: LiveAlert) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      {alerts.length === 0 && <p className="text-xs text-slate-500">No alerts yet — they appear here as the engine fires them.</p>}
      {alerts.map((a) => {
        const p = a.payload;
        return (
          <button
            key={`${p.identity}|${a.kind}|${a.ts}`}
            data-testid="alert-row"
            onClick={() => onOpen(a)}
            className="flex items-center gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70"
          >
            <span className="w-5 text-base">{BADGE[a.kind]}</span>
            <span className="w-32 text-slate-400">{new Date(a.ts).toLocaleString()}</span>
            <span className="w-16 font-semibold">{a.coin}</span>
            <span className="w-10 text-slate-400">{a.interval}</span>
            <span className={`w-5 ${p.direction === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
              {p.direction === 'bullish' ? '▲' : '▼'}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.setup.join(' + ')}</span>
            <span className="w-14 text-right font-semibold">{Math.round(p.confidence)}</span>
            <span className="w-44 text-right text-slate-400">
              e {p.entry} · s {p.stop} · t {p.target}
            </span>
            {p.note && <span className="w-48 truncate text-slate-500" title={p.note}>{p.note}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 17.4: Toolbar 'alerts' view** — in `apps/web/src/components/Toolbar.tsx`:

```tsx
export type View = 'chart' | 'backtest' | 'signals' | 'alerts';
```

and add `{tab('alerts', 'Alerts')}` after the signals tab in the tab row.

- [ ] **Step 17.5: Replace `apps/web/src/App.tsx`** with the integrated version:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { getMarkets } from './api/client';
import type { AnalysisConfig, LiveAlert, Market, TradePlan } from './api/types';
import { useAnalysis } from './state/useAnalysis';
import { useLiveFeed } from './state/useLiveFeed';
import { Toolbar } from './components/Toolbar';
import type { View } from './components/Toolbar';
import { IndicatorDrawer } from './components/IndicatorDrawer';
import { Chart } from './components/Chart';
import { HealthChip } from './components/HealthChip';
import { AlertFeedPane } from './components/AlertFeedPane';
import { buildMarkers, DEFAULT_FAMILIES, type FamilyToggles } from './signals';
import { BacktestPanel } from './components/BacktestPanel';
import { SignalsPanel } from './components/SignalsPanel';
import { applyUrlParams } from './urlParams';

const DEFAULT_CONFIG: AnalysisConfig = {
  coin: 'BTC',
  interval: '1h',
  lookback: 1000,
  rsiPeriod: 14,
  movingAverages: [
    { type: 'EMA', period: 50, color: '#22d3ee' },
    { type: 'SMA', period: 200, color: '#f59e0b' },
  ],
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMaxLevels: 6,
};

/** Chart plan lines, pinned to the coin×interval they belong to (only shown while it is selected). */
interface PlanTarget { coin: string; interval: string; entry: number; stop: number; target: number }

export function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(
    () => applyUrlParams(DEFAULT_CONFIG, window.location.search),
  );
  const [view, setView] = useState<View>('chart');
  const [families, setFamilies] = useState<FamilyToggles>(DEFAULT_FAMILIES);
  const [planTarget, setPlanTarget] = useState<PlanTarget | null>(null);
  const { data, loading, error, reload } = useAnalysis(config);
  const live = useLiveFeed();

  useEffect(() => {
    getMarkets().then((r) => setMarkets(r.markets)).catch((e) => console.error('markets fetch failed', e));
  }, []);

  const onViewPlan = (p: TradePlan) => {
    setPlanTarget({ coin: config.coin, interval: config.interval, entry: p.entry, stop: p.stop, target: p.target });
    setView('chart');
  };

  const onOpenAlert = (a: LiveAlert) => {
    const p = a.payload;
    setConfig((prev) => ({ ...prev, coin: a.coin, interval: a.interval as AnalysisConfig['interval'] }));
    setPlanTarget({ coin: a.coin, interval: a.interval, entry: p.entry, stop: p.stop, target: p.target });
    setView('chart');
  };

  const status = useMemo(() => {
    if (error) return `error: ${error}`;
    if (loading) return 'loading…';
    if (data) return `${data.meta.candleCount} candles · updated ${new Date(data.meta.lastUpdated).toLocaleString()}`;
    return '';
  }, [error, loading, data]);

  const plan = planTarget && planTarget.coin === config.coin && planTarget.interval === config.interval
    ? { entry: planTarget.entry, stop: planTarget.stop, target: planTarget.target }
    : null;

  const maColors = useMemo(() => config.movingAverages.map((m) => m.color), [config.movingAverages]);
  const markers = useMemo(() => buildMarkers(data?.signals ?? [], families), [data, families]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        markets={markets}
        coin={config.coin}
        interval={config.interval}
        view={view}
        onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
        onInterval={(interval) => setConfig((prev) => ({ ...prev, interval }))}
        onView={setView}
        onRefresh={reload}
        status={status}
        healthChip={<HealthChip connected={live.connected} health={live.health} />}
      />
      <div className={view === 'chart' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <Chart data={data} maColors={maColors} markers={markers} plan={plan} />
        <IndicatorDrawer config={config} onChange={setConfig} families={families} onFamilies={setFamilies} />
      </div>
      <div className={view === 'backtest' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <BacktestPanel coin={config.coin} interval={config.interval} />
      </div>
      <div className={view === 'signals' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <SignalsPanel
          coin={config.coin}
          interval={config.interval}
          markets={markets}
          active={view === 'signals'}
          onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
          onViewPlan={onViewPlan}
          live={{ connected: live.connected, rows: live.scans }}
        />
      </div>
      <div className={view === 'alerts' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <AlertFeedPane alerts={live.alerts} onOpen={onOpenAlert} />
      </div>
    </div>
  );
}
```

NOTE for the App tests: `useLiveFeed` constructs an `EventSource`, which jsdom lacks. Add a global stub in `apps/web/test/setup.ts`:

```ts
class StubEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}
if (!(globalThis as Record<string, unknown>).EventSource) {
  (globalThis as Record<string, unknown>).EventSource = StubEventSource;
}
```

(`useLiveFeed.test.ts` overrides it per-test with its FakeEventSource — its beforeEach assignment wins; its afterEach `delete` then falls back to this stub, which is fine.)

- [ ] **Step 17.6: Extend `apps/web/test/appPlanLines.test.tsx`** — keep the existing view-on-chart test green, and add an alert click-through case: render App (with mocked fetch as the file already does), inject a live alert by… NOTE: with the stub EventSource the feed stays empty, so instead test `onOpenAlert` behavior at the component seam: render `<AlertFeedPane>` with one alert and assert clicking calls onOpen (already covered in 17.1), AND assert the plan-pinning logic via the view-on-plan flow still passing. The full alert→chart pipeline is covered by the e2e (Task 19). If the existing appPlanLines test asserted the plan-reset effect (plan cleared on coin change), update it: the new equivalent assertion is that the chart receives `plan=null` when the selected coin differs from the plan's coin.

- [ ] **Step 17.7: Run the full web suite + tsc**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: ALL green, no type errors.

- [ ] **Step 17.8: Commit**

```bash
git add apps/web/src/components/AlertFeedPane.tsx apps/web/src/components/Toolbar.tsx apps/web/src/App.tsx apps/web/test/
git commit -m "feat(web): alert feed view, health chip wiring, deep links, live scanner integration"
```

---

### Task 18: vite `/live` proxy + ops/deploy docs

**Model:** sonnet

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `docs/ops-mac.md`

- [ ] **Step 18.1: vite proxy** — in `apps/web/vite.config.ts`, change the server line to:

```ts
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/live': 'http://localhost:3001' } },
```

(EventSource through the vite dev proxy streams fine — http-proxy does not buffer SSE.)

- [ ] **Step 18.2: ops docs** — in `docs/ops-mac.md`:

1. Add a "Deploy the dashboard" subsection to the existing deploy/update flow:

```markdown
### Dashboard (Phase 4B)

The server serves the built web app at its own origin — no vite process on the Mac.

1. Build it as part of every deploy: `pnpm --filter @cta/web build`
2. Open `http://localhost:3001/` (or the Mac's LAN address) — scanner Live mode, alert feed,
   and the health chip update from `GET /live` (SSE) without reloads.
3. Set `webOrigin` in `engine.json` (or `ENGINE_WEB_ORIGIN`) to the server origin, e.g.
   `http://localhost:3001`, so Telegram/Discord alert deep links open the served dashboard.
   If `apps/web/dist` is missing the server logs a warning and serves the API only.
4. The nightly MA optimizer runs at 00:10 UTC inside the engine (config block `optimizer` in
   `engine.json`); inspect selections in the `ma_selection` table, force a run with
   `curl -X POST 'http://localhost:3001/engine/optimize-ma?coins=BTC,ETH'` (loopback-only).
```

2. In the env-var table, update the `ENGINE_WEB_ORIGIN` row's default note: deep links should now point at the server origin (3001), not the vite dev server (5173).

- [ ] **Step 18.3: Verify the build + dev proxy still work**

Run: `pnpm --filter @cta/web build`
Expected: vite build completes, `apps/web/dist/index.html` exists.

- [ ] **Step 18.4: Commit**

```bash
git add apps/web/vite.config.ts docs/ops-mac.md
git commit -m "docs(ops): dashboard deploy flow; proxy /live in dev"
```

---

### Task 19: live e2e — `e2e/phase4b.mjs`

**Model:** fable

**Controller note (4A lesson):** the implementer subagent writes the script and may do SHORT smoke checks, but the full live run (`node e2e/phase4b.mjs`, ~5–8 min) is executed by the CONTROLLER via background Bash after the task lands. The subagent must NOT launch it with run_in_background.

**Files:**
- Create: `e2e/phase4b.mjs`

**Spec gates (the script FAILS unless all hold):**
1. Dashboard rows update live without clicks (a `[data-testid="scan-row"][data-live="1"]` appears, and the set of live rows grows or refreshes — new row count or a changed `data-ts` — without any page interaction).
2. Health chip is green (`[data-testid="health-chip"][data-state="green"]`).
3. A deep-link URL opens the right coin+timeframe.
4. A forced optimizer run on a few coins writes auditable `ma_selection` rows (≥1 row whose JSON metrics parse with train/validation/baseline fields).

Alert-feed click-through is exercised best-effort (alerts are market-dependent): if an alert row exists, click it and require the 3 plan lines; otherwise print a WARN and continue.

- [ ] **Step 19.1: Write the script** — reuse `e2e/phase4a.mjs`'s process-lifecycle helpers VERBATIM (detached spawn of `pnpm --filter @cta/server start`, group SIGTERM, guarded LISTEN-pid sweep, port-free wait, createRequire resolution of better-sqlite3 into apps/server) and `e2e/phase3.mjs`'s puppeteer-core idioms (system Chrome path, `clickByText`, screenshots to `e2e/out/`). Structure:

```js
// e2e/phase4b.mjs — Phase 4B live dashboard + MA optimizer e2e against real Hyperliquid.
// Owns the server lifecycle like phase4a.mjs (detached group spawn on :3016) and drives the
// SERVED dashboard (apps/web/dist via @fastify/static) with system Chrome like phase3.mjs.
// Run from the repo root: node e2e/phase4b.mjs
//
// PORT 3016, BASE http://localhost:3016
// DB   apps/server/data/e2e-phase4b.sqlite
// CFG  apps/server/data/e2e-phase4b-engine.json
```

Engine config written by the script (permissive so the dashboard has content within minutes):

```js
const engineConfig = {
  universeCap: 6,
  timeframes: ['15m', '1h'],
  confirmedMinConfidence: 0,        // every active close-scan plan alerts → feed content
  provisionalMinConfidence: 80,
  sinks: { telegram: false, discord: false, macos: false },
  webOrigin: BASE,
  optimizer: { enabled: true, minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.3 },
  analysis: { gate: { minTrades: 1, minExpectancy: -9, topN: 50 }, window: 50 },
};
```

Sequence:

```js
// 0. preflight: nothing on :3016; rm old db; mkdir LOG_DIR; write CFG
// 1. execSync('pnpm --filter @cta/web build', { cwd: ROOT, stdio: 'inherit' })  // serve fresh dist
// 2. spawn server detached: env PORT=3016 ENGINE_ENABLED=1 ENGINE_CONFIG=CFG CACHE_DB_PATH=DB ENGINE_LOG_DIR=LOG_DIR
// 3. poll GET /api/health until res.engine && res.engine.coinsLive >= 3   (timeout 240s)
// 4. SSE handshake check: fetch(BASE + '/live'), read until the first 'event: snapshot' frame,
//    JSON.parse its data → assert it has scans[], alerts[], health{} keys (10s). Abort the fetch after.
// 5. puppeteer: goto BASE/ (networkidle2);
//    await chip green:    page.waitForSelector('[data-testid="health-chip"][data-state="green"]', { timeout: 90_000 })
//    open Signals view:   clickByText('Signals')
//    first live row:      page.waitForSelector('[data-testid="scan-row"][data-live="1"]', { timeout: 300_000 })
//    capture (count, ts-set) of live rows; then waitForFunction: row count increased OR any data-ts changed,
//    WITHOUT further interaction (timeout 300_000) → gate 1
//    screenshot e2e/out/phase4b-dashboard.png
// 6. read a live coin symbol from the first live row's coin cell; pick interval '1h';
//    page.goto(`${BASE}/?coin=${coin}&interval=1h`, networkidle2);
//    assert picker shows the coin: page.$eval('input[placeholder="Search market…"]', el => el.value) === coin
//    assert the 1h pill is active (inspect TimeframePills' active class or aria state — adapt to the DOM)
//    → gate 3; screenshot e2e/out/phase4b-deeplink.png
// 7. best-effort alert click-through: clickByText('Alerts'); if a [data-testid="alert-row"] exists within 30s,
//    click it and waitForFunction(() => window.__planLineCount === 3, { timeout: 15_000 });
//    else console.warn('WARN: no alerts in feed during run — click-through skipped');
//    screenshot e2e/out/phase4b-alerts.png
// 8. optimizer: pick two live coins from /api/health-adjacent data (use the SSE snapshot's scans coins);
//    POST `${BASE}/engine/optimize-ma?coins=${c1},${c2}` → 200, summary.decisions.length === 4;
//    open DB read-only via createRequire(apps/server)('better-sqlite3');
//    rows = SELECT * FROM ma_selection;
//    if rows.length === 0 → retry once with a third coin; still 0 → FAIL
//    assert each row: JSON.parse(setupKinds/train/validation) succeed; train.trades >= 1;
//    fastPeriod < slowPeriod; selectedAt > 0 → gate 4
//    console.log decisions + rows summary
// 9. cleanup (group kill, port-free wait); console.log('E2E PASS')
```

- [ ] **Step 19.2: Static smoke check (implementer, fast)** — verify the served dashboard boots WITHOUT the engine:

Run: `pnpm --filter @cta/web build && PORT=3019 pnpm --filter @cta/server start` (background locally for <60s via two terminals or `timeout`), then `curl -s localhost:3019/ | head -c 200` shows the index.html, `curl -s localhost:3019/api/health` is ok. Kill it. (No engine: chip will be red — that's correct.)

- [ ] **Step 19.3: CONTROLLER runs the live e2e**

Run (controller, background Bash): `node e2e/phase4b.mjs`
Expected: `E2E PASS` with all four gates logged; screenshots in `e2e/out/phase4b-*.png`. One re-run on transient market emptiness is acceptable (record it).

- [ ] **Step 19.4: Commit**

```bash
git add e2e/phase4b.mjs
git commit -m "test(e2e): phase 4b live dashboard + MA optimizer verification"
```

---

## Final verification (controller, after all tasks)

- [ ] `pnpm -r test` — every workspace green (expect ≈288 pre-existing + ~45–60 new).
- [ ] `pnpm --filter @cta/web exec tsc --noEmit` — clean.
- [ ] `node e2e/phase4b.mjs` — E2E PASS (controller-run, background).
- [ ] `node e2e/phase4a.mjs` — still passes (4B must not regress the engine; run after 4b's run, ports differ but never concurrently — both subscribe live WS data).
- [ ] Spec TODOs: tick all 10 boxes in `docs/superpowers/specs/2026-06-11-phase4b-live-dashboard-ma-design.md` with a `docs(spec)` commit.
- [ ] Grep hygiene: `grep -rn "TODO\|FIXME" apps/server/src/engine/maOptimizer.ts apps/server/src/engine/liveFeed.ts apps/web/src/state/useLiveFeed.ts` → empty.

## Execution notes

- Process: `superpowers:subagent-driven-development`, ONE task at a time, never parallel implementers; per-task implementer model from the table; ONE consolidated tier-matched spec+quality reviewer per task; controller hand-verifies findings; plan-contradiction deviations recorded inline in this file as `docs(plan): record Task N deviation…` commits.
- Worktree: create a fresh `feat/phase4b-live-dashboard-ma` branch in `.claude/worktrees/phase4b` via `superpowers:using-git-worktrees` before Task 1.
- Reviewers run the tests themselves; implementers paste full command output.
- Out of scope (spec): plan lifecycle alerts, engine-health push alerts, quiet hours, per-coin MA override UI controls, Rust kernel port, `/signals` route MA overrides (on-demand UI keeps defaults — only ENGINE scans consume `ma_selection`).
