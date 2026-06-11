# Phase 4A — Continuous Market Analysis Engine + Notifications: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 24/7 engine inside the existing Fastify server process that ingests Hyperliquid candles/mids over WebSocket, re-analyzes every monitored coin×timeframe on candle close (worker pool) and intra-candle (provisional checks), and pushes deduplicated trade-plan alerts to Telegram/Discord/macOS with SQLite persistence.

**Architecture:** WS push (`candle@15m` per coin + `allMids`) feeds a stateful aggregator that builds exact 1h/4h/1d candles locally. Candle closes enqueue coalesced, volume-prioritized scan jobs executed in `worker_threads` through one pure kernel function `analyzeCoin` in `@cta/core` (the Rust-portable boundary). Ticks drive throttled main-thread provisional evaluations. An AlertEngine derives `provisional-new/confirmed/withdrawn/confirmed-new` events with identity dedupe and burst digests, dispatched to independent sinks.

**Tech Stack:** TypeScript ESM throughout, Node 22 (global `WebSocket` client), `tsx` runtime, Fastify 4, better-sqlite3, vitest, `pino`+`pino-roll` (new), `ws` (devDep only, fake servers in tests), puppeteer-core e2e.

**Spec:** `docs/superpowers/specs/2026-06-11-phase4a-continuous-engine-design.md`

## Task → Model table (per CLAUDE.md ladder; reviewer tier-matched to implementer)

| Task | Title | Difficulty | Model |
|---|---|---|---|
| 1 | candleSnapshot weight accounting fix | easy | sonnet |
| 2 | core: pure candle aggregation helpers | easy | sonnet |
| 3 | core: `analyzeCoin` kernel | easy | sonnet |
| 4 | engine config loader + structured logger | standard | opus |
| 5 | Hyperliquid WS client (reconnect/resubscribe) | deep | fable |
| 6 | CandleAggregator (forming state, closes) | standard | opus |
| 7 | worker pool + worker entry | deep | fable |
| 8 | scan scheduler + tick gate | standard | opus |
| 9 | alert store (SQLite) | easy | sonnet |
| 10 | AlertEngine (lifecycle semantics, burst) | deep | fable |
| 11 | sinks + dispatcher | standard | opus |
| 12 | latency metrics + /health extension | standard | opus |
| 13 | backfill orchestrator + universe refresh | standard | opus |
| 14 | provisional evaluator | deep | fable |
| 15 | Engine wiring + watchdog + server boot | deep | fable |
| 16 | integration test: fake HL WS replay | deep | fable |
| 17 | launchd plist + ops docs | easy | sonnet |
| 18 | live e2e `e2e/phase4a.mjs` | deep | fable |

## File structure

```
packages/core/src/
  aggregate.ts                 # NEW pure roll-up math (bucketStart, aggregateCandles, applyMid)
  analyze.ts                   # NEW analyzeCoin kernel + EngineAnalysisConfig
  index.ts                     # MODIFY: export both
apps/server/src/
  config.ts                    # MODIFY: CANDLE_SNAPSHOT_BASE_WEIGHT
  services/candleService.ts    # MODIFY: weight calc
  cache/db.ts                  # MODIFY: alerts + alert_dedupe tables
  cache/alertStore.ts          # NEW
  routes/health.ts             # MODIFY: engine status block
  server.ts                    # MODIFY: ENGINE_ENABLED boot
  engine/
    types.ts                   # NEW shared engine types (PlanAlert, ScanJob, HealthSnapshot)
    config.ts                  # NEW EngineConfig + loadEngineConfig (engine.json + env)
    logger.ts                  # NEW pino + pino-roll size-capped rotation
    ws.ts                      # NEW HyperliquidWs
    aggregator.ts              # NEW CandleAggregator
    workerPool.ts              # NEW WorkerPool
    worker.ts                  # NEW worker_threads entry → analyzeCoin
    scheduler.ts               # NEW ScanQueue + TickGate
    alertEngine.ts             # NEW event derivation, identity, dedupe, burst
    sinks/types.ts             # NEW Sink interface
    sinks/telegram.ts          # NEW
    sinks/discord.ts           # NEW
    sinks/macos.ts             # NEW
    sinks/dispatcher.ts        # NEW retry + isolation
    metrics.ts                 # NEW LatencyTracker p50/p95
    backfill.ts                # NEW cold start + hourly universe refresh
    provisional.ts             # NEW ProvisionalEvaluator
    watchdog.ts                # NEW ws-dead + event-loop-stall exit
    engine.ts                  # NEW composition root
apps/server/test/
  helpers/fakeHlWs.ts          # NEW scripted fake HL WS server (uses `ws`)
  (one test file per unit, named after the module)
engine.json.example            # NEW committed example config
ops/com.cta.engine.plist       # NEW launchd service
docs/ops-mac.md                # NEW 24/7 Mac setup
e2e/phase4a.mjs                # NEW live e2e
```

**Conventions all tasks follow** (from the existing codebase — match them exactly):

- ESM TypeScript, 2-space indent, single quotes, semicolons, `import type` for types.
- Services/classes take a deps object with injectable `now?: () => number` (see `CandleService`).
- Tests: vitest `describe/it/expect`, files in `apps/server/test/<name>.test.ts` or `packages/core/test/<name>.test.ts`.
- Run a single test file: `pnpm --filter @cta/server test -- run test/<name>.test.ts` (or `--filter @cta/core`).
- Full suite gate before every commit: `pnpm -r test` must stay green (205 tests at start).
- Commit after every task with the exact message given in the task.

**Environment quirks (do not rediscover these):**

- The server runs under `tsx` (`pnpm --filter @cta/server start`). `worker_threads` therefore must spawn workers as `new Worker(fileURLToPath(new URL('./worker.ts', import.meta.url)), { execArgv: ['--import', 'tsx'] })` — without the `--import tsx` execArgv, Node cannot parse the TS worker file. The same spawn works under vitest because `tsx` is a direct devDependency.
- Node 22.18 provides a spec-compliant global `WebSocket` **client** (undici). There is no built-in WS *server* — tests use the `ws` package (devDep) for fakes.
- `better-sqlite3` is synchronous; never call it inside a hot per-tick loop — alert dedupe reads are cached in memory (Task 10).
- zsh Bash-tool quirks from CLAUDE.md apply (no `sed -i`, assert branch after checkout, etc.).

---

### Task 1: candleSnapshot weight accounting fix

The HL docs say `candleSnapshot` costs **20 base + 1 per 60 candles returned**. `CandleService.fetchAndStore` currently acquires only `ceil(est/60)`, under-budgeting every request by 20 and risking 429 storms during the Phase 4A backfill.

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/services/candleService.ts:55`
- Test: `apps/server/test/candleService.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block in `apps/server/test/candleService.test.ts` (reuse the file's existing fake client/limiter helpers — read the file first; it already constructs a `CandleService` with a recording rate limiter; if its fake limiter records weights, assert on it, otherwise add a recording wrapper exactly like below):

```ts
it('acquires 20 base + 1-per-60-candles weight for snapshot requests', async () => {
  const weights: number[] = [];
  const rateLimiter = { acquire: async (w: number) => { weights.push(w); } } as unknown as RateLimiter;
  const client = {
    candleSnapshot: async (_c: string, _i: string, s: number, e: number) => {
      const step = 3_600_000;
      const out: Candle[] = [];
      for (let t = s; t <= e; t += step) out.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
      return out;
    },
  } as unknown as HyperliquidClient;
  const db = openDb(':memory:');
  const svc = new CandleService({ client, store: new CandleStore(db), rateLimiter, now: () => 3_600_000 * 1000 });
  await svc.getCandles('BTC', '1h', 600);
  // 600 candles in one page: 20 base + ceil(600/60) = 30
  expect(weights).toEqual([30]);
});
```

> **DEVIATION (Task 1, recorded during implementation):** the test asserts `[31]`, not `[30]`. The real `est` formula counts candles inclusively: `ceil((e−s)/step)+1 = 601` for a 600-candle 1h request, so weight = 20 + ceil(601/60) = 31. The plan comment's `ceil(600/60)` shorthand missed the `+1`. Implementation formula is exactly as specified; only the expected literal changed.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cta/server test -- run test/candleService.test.ts`
Expected: FAIL — received `[10]` (only the per-60 component).

- [ ] **Step 3: Implement**

In `apps/server/src/config.ts` add:

```ts
export const CANDLE_SNAPSHOT_BASE_WEIGHT = 20; // HL docs: candleSnapshot weighs 20 + 1 per 60 candles returned
```

In `apps/server/src/services/candleService.ts`, import the constant and change the acquire line inside `fetchAndStore`:

```ts
const est = Math.min(MAX_CANDLES_PER_REQUEST, Math.ceil((e - s) / step) + 1);
await this.deps.rateLimiter.acquire(CANDLE_SNAPSHOT_BASE_WEIGHT + Math.max(1, Math.ceil(est / 60)));
```

- [ ] **Step 4: Run the file, then the full suite**

Run: `pnpm --filter @cta/server test -- run test/candleService.test.ts` → PASS.
Run: `pnpm -r test` → all green (some existing candleService tests may assert old weights — update those assertions to include the +20 base; that is the only acceptable change to existing tests in this task).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/services/candleService.ts apps/server/test/candleService.test.ts
git commit -m "fix(server): candleSnapshot weight = 20 base + 1 per 60 candles (HL docs)"
```

**Model:** sonnet

---

### Task 2: core — pure candle aggregation helpers

Pure math for rolling 15m candles into 1h/4h/1d buckets and applying mid-price ticks to a forming candle. Stateful orchestration lives in Task 6; this task is pure functions only.

**Files:**
- Create: `packages/core/src/aggregate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/aggregate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/aggregate.test.ts
import { describe, expect, it } from 'vitest';
import { aggregateCandles, applyMid, bucketStart } from '../src/aggregate';
import type { Candle } from '../src/types';

const H = 3_600_000;
const c = (t: number, o: number, h: number, l: number, cl: number, v = 1, n = 1): Candle =>
  ({ t, o, h, l, c: cl, v, n });

describe('bucketStart', () => {
  it('floors to the bucket boundary', () => {
    expect(bucketStart(H + 1, H)).toBe(H);
    expect(bucketStart(H, H)).toBe(H);
    expect(bucketStart(H - 1, H)).toBe(0);
  });
});

describe('aggregateCandles', () => {
  it('rolls four 15m candles into one 1h candle (o first, h max, l min, c last, v/n sums)', () => {
    const base = [
      c(0, 10, 12, 9, 11, 5, 2), c(900_000, 11, 15, 10, 14, 3, 1),
      c(1_800_000, 14, 14, 8, 9, 2, 4), c(2_700_000, 9, 13, 9, 13, 6, 3),
    ];
    expect(aggregateCandles(base, H)).toEqual([{ t: 0, o: 10, h: 15, l: 8, c: 13, v: 16, n: 10 }]);
  });

  it('splits across boundaries and keeps partial buckets', () => {
    const base = [c(2_700_000, 1, 2, 1, 2), c(3_600_000, 2, 3, 2, 3)];
    expect(aggregateCandles(base, H)).toEqual([
      { t: 0, o: 1, h: 2, l: 1, c: 2, v: 1, n: 1 },
      { t: H, o: 2, h: 3, l: 2, c: 3, v: 1, n: 1 },
    ]);
  });

  it('treats missing n as 0 in sums and returns [] for []', () => {
    const base = [c(0, 1, 1, 1, 1), { t: 900_000, o: 1, h: 1, l: 1, c: 1, v: 1 } as Candle];
    expect(aggregateCandles(base, H)[0].n).toBe(1);
    expect(aggregateCandles([], H)).toEqual([]);
  });
});

describe('applyMid', () => {
  it('moves close and stretches extremes without mutating input', () => {
    const forming = c(0, 10, 11, 9, 10);
    const up = applyMid(forming, 12);
    expect(up).toEqual({ t: 0, o: 10, h: 12, l: 9, c: 12, v: 1, n: 1 });
    expect(forming.c).toBe(10);
    expect(applyMid(forming, 8)).toEqual({ t: 0, o: 10, h: 11, l: 8, c: 8, v: 1, n: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- run test/aggregate.test.ts`
Expected: FAIL — cannot resolve `../src/aggregate`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/aggregate.ts
import type { Candle } from './types';

/** Start of the bucket containing t. Hyperliquid candles are UTC-aligned, so plain flooring is exact. */
export function bucketStart(t: number, bucketMs: number): number {
  return Math.floor(t / bucketMs) * bucketMs;
}

/** Roll base-interval candles into bucketMs candles. Input must be sorted by t ascending. */
export function aggregateCandles(base: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  for (const b of base) {
    const t = bucketStart(b.t, bucketMs);
    const cur = out[out.length - 1];
    if (!cur || cur.t !== t) {
      out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n ?? 0 });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.n = (cur.n ?? 0) + (b.n ?? 0);
    }
  }
  return out;
}

/** Apply a mid-price tick to a forming candle (close moves, extremes stretch). Returns a new candle. */
export function applyMid(forming: Candle, mid: number): Candle {
  return { ...forming, c: mid, h: Math.max(forming.h, mid), l: Math.min(forming.l, mid) };
}
```

Add to `packages/core/src/index.ts` (after the `atr` export line):

```ts
export { aggregateCandles, applyMid, bucketStart } from './aggregate';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- run test/aggregate.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/aggregate.ts packages/core/src/index.ts packages/core/test/aggregate.test.ts
git commit -m "feat(core): pure candle aggregation helpers (bucketStart, aggregateCandles, applyMid)"
```

**Model:** sonnet

---

### Task 3: core — `analyzeCoin` kernel

The single pure entry point all engine analysis flows through (spec: the Rust-portable boundary). Wraps the existing pipeline; adds nothing new analytically.

**Files:**
- Create: `packages/core/src/analyze.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/analyze.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/analyze.test.ts
import { describe, expect, it } from 'vitest';
import { analyzeCoin, defaultEngineAnalysisConfig } from '../src/analyze';
import { trendingCandles } from './fixtures'; // existing fixture helper used by scan/plans tests — check test/fixtures.ts for the exact name/signature of the long trending-series generator and reuse it; if it differs, use the same generator scan.test.ts uses.

describe('analyzeCoin', () => {
  it('returns scan results, plans sorted by confidence desc, and head metadata', () => {
    const candles = trendingCandles(400);
    const out = analyzeCoin(candles, defaultEngineAnalysisConfig());
    expect(out.candleCount).toBe(400);
    expect(out.lastCandleT).toBe(candles[399].t);
    expect(Array.isArray(out.scanResults)).toBe(true);
    for (let i = 1; i < out.plans.length; i++) {
      expect(out.plans[i - 1].confidence.score).toBeGreaterThanOrEqual(out.plans[i].confidence.score);
    }
  });

  it('honors the MA override in config (different maFast changes the detector context)', () => {
    const candles = trendingCandles(400);
    const cfg = defaultEngineAnalysisConfig();
    const out1 = analyzeCoin(candles, cfg);
    const out2 = analyzeCoin(candles, {
      ...cfg,
      detector: { ...cfg.detector, maFast: { type: 'SMA', period: 9 }, maSlow: { type: 'SMA', period: 21 } },
    });
    // not asserting specific plans (fixture-dependent) — assert the configs are actually independent
    expect(out2).not.toEqual(out1); // different MA specs must be able to produce different output on a 400-candle trend
  });

  it('is pure: same input twice gives deeply equal output', () => {
    const candles = trendingCandles(300);
    const cfg = defaultEngineAnalysisConfig();
    expect(analyzeCoin(candles, cfg)).toEqual(analyzeCoin(candles, cfg));
  });
});
```

> **DEVIATION (Task 3, recorded during implementation):** `test/fixtures.ts` has no `trendingCandles` helper (only `candle()`/`ctxWith()`). The test defines local deterministic generators instead: `trendingCandles` (pure uptrend) and `upthendownCandles(500)` (up-then-down, forcing different MA cross sets for the override test). Kernel implementation matched the template exactly — `runScan` really returns `results/candleCount/lastCandleT` and `buildTradePlans` takes `DecideConfig`.

Note for the implementer: if `out2.not.toEqual(out1)` is flaky because the fixture genuinely produces identical results under both MA configs, assert instead on the detector context boundary: export nothing new — change the test to compare `analyzeCoin` outputs on a fixture long enough that EMA50/SMA200 vs SMA9/SMA21 cross sets differ (e.g. a series with one trend reversal: concatenate an up-trend and a down-trend from the fixture helpers). Do not weaken the other two tests.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- run test/analyze.test.ts`
Expected: FAIL — cannot resolve `../src/analyze`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/analyze.ts
import type { Candle } from './types';
import { buildDetectorContext, DEFAULT_DETECTOR_OPTIONS } from './detectorContext';
import type { DetectorOptions } from './detectorContext';
import { detectAll } from './detectors';
import { runScan, DEFAULT_BACKTEST_CONFIG } from './backtest/scan';
import type { BacktestConfig, SetupResult } from './backtest/scan';
import { qualifySetups } from './decide/qualify';
import { buildTradePlans } from './decide/plans';
import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from './decide/constants';
import type { ConfidenceWeights, SetupGate, TradePlan } from './decide/types';

/**
 * The engine compute kernel — the single boundary all continuous analysis flows through.
 * Keep this function pure and its signature stable: it is the documented Rust-port seam.
 */
export interface EngineAnalysisConfig {
  detector: DetectorOptions;   // includes the maFast/maSlow override (Phase 4B optimizer injects here)
  backtest: BacktestConfig;
  gate: SetupGate;
  weights: ConfidenceWeights;
  window: number;
}

export interface AnalyzeResult {
  scanResults: SetupResult[];
  plans: TradePlan[];
  candleCount: number;
  lastCandleT: number;
}

export function defaultEngineAnalysisConfig(): EngineAnalysisConfig {
  return {
    detector: { ...DEFAULT_DETECTOR_OPTIONS },
    backtest: { ...DEFAULT_BACKTEST_CONFIG },
    gate: { ...DEFAULT_GATE },
    weights: { ...DEFAULT_WEIGHTS },
    window: DEFAULT_WINDOW,
  };
}

export function analyzeCoin(candles: Candle[], cfg: EngineAnalysisConfig): AnalyzeResult {
  const ctx = buildDetectorContext(candles, cfg.detector);
  const scan = runScan(candles, ctx, cfg.backtest);
  const qualified = qualifySetups(scan.results, cfg.gate);
  const signals = detectAll(candles, ctx);
  const plans = buildTradePlans(candles, ctx, signals, qualified, {
    ...cfg.backtest, window: cfg.window, weights: cfg.weights,
  });
  return {
    scanResults: scan.results,
    plans,
    candleCount: scan.candleCount,
    lastCandleT: scan.lastCandleT,
  };
}
```

Add to `packages/core/src/index.ts`:

```ts
export { analyzeCoin, defaultEngineAnalysisConfig } from './analyze';
export type { EngineAnalysisConfig, AnalyzeResult } from './analyze';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- run test/analyze.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyze.ts packages/core/src/index.ts packages/core/test/analyze.test.ts
git commit -m "feat(core): analyzeCoin kernel — the engine's pure compute boundary"
```

**Model:** sonnet

### Task 4: engine config loader + structured logger

**Files:**
- Create: `apps/server/src/engine/config.ts`
- Create: `apps/server/src/engine/logger.ts`
- Create: `engine.json.example`
- Test: `apps/server/test/engineConfig.test.ts`

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @cta/server add pino pino-roll
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/server/test/engineConfig.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, loadEngineConfig } from '../src/engine/config';

describe('loadEngineConfig', () => {
  it('returns defaults when no file exists', () => {
    const cfg = loadEngineConfig(join(tmpdir(), 'nope', 'missing-engine.json'), {});
    expect(cfg).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(cfg.timeframes).toEqual(['15m', '1h', '4h', '1d']);
    expect(cfg.confirmedMinConfidence).toBe(65);
    expect(cfg.provisionalMinConfidence).toBe(75);
  });

  it('deep-merges engine.json over defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engcfg-'));
    const p = join(dir, 'engine.json');
    writeFileSync(p, JSON.stringify({ universeCap: 50, analysis: { minRR: 2 } }));
    const cfg = loadEngineConfig(p, {});
    expect(cfg.universeCap).toBe(50);
    expect(cfg.analysis.minRR).toBe(2);
    expect(cfg.analysis.gate.minTrades).toBe(DEFAULT_ENGINE_CONFIG.analysis.gate.minTrades); // untouched sibling
  });

  it('applies env overrides and derives sink enablement from secrets', () => {
    const cfg = loadEngineConfig(join(tmpdir(), 'missing.json'), {
      ENGINE_UNIVERSE_CAP: '20',
      ENGINE_TIMEFRAMES: '15m,1h',
      ENGINE_WORKERS: '2',
      TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c',
    });
    expect(cfg.universeCap).toBe(20);
    expect(cfg.timeframes).toEqual(['15m', '1h']);
    expect(cfg.workerCount).toBe(2);
    expect(cfg.sinks.telegram).toBe(true);
    expect(cfg.sinks.discord).toBe(false); // no DISCORD_WEBHOOK_URL
  });

  it('rejects timeframes that do not include 15m (the aggregation base)', () => {
    expect(() => loadEngineConfig(join(tmpdir(), 'missing.json'), { ENGINE_TIMEFRAMES: '1h,4h' }))
      .toThrow(/15m/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/engineConfig.test.ts`
Expected: FAIL — cannot resolve `../src/engine/config`.

- [ ] **Step 4: Implement config**

```ts
// apps/server/src/engine/config.ts
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import {
  DEFAULT_BACKTEST_CONFIG, DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW, SUPPORTED_INTERVALS,
} from '@cta/core';
import type { ConfidenceWeights, Interval, SetupGate } from '@cta/core';

export interface EngineConfig {
  universeCap: number;               // 0 = all listed coins
  timeframes: Interval[];            // must include '15m' (aggregation base)
  lookback: number;                  // candles of history per coin×timeframe
  confirmedMinConfidence: number;
  provisionalMinConfidence: number;
  tickMinMovePct: number;            // re-evaluate a coin only if mid moved this %
  tickMinIntervalMs: number;         // and at most once per this window
  workerCount: number;
  wsSilenceMs: number;               // no WS message for this long → reconnect
  wsDeadExitMs: number;              // WS down this long despite reconnects → watchdog exits
  closeGraceMs: number;              // close a forming candle this long after its boundary
  burstLimit: number;                // alerts per burstWindowMs before digesting
  burstWindowMs: number;
  dedupeCooldownMs: number;
  webOrigin: string;                 // deep-link base (Phase 4B serves the UI from the server origin)
  sinks: { telegram: boolean; discord: boolean; macos: boolean };
  analysis: {
    confluenceWindow: number; minRR: number; volumeSpikeK: number;
    gate: SetupGate; weights: ConfidenceWeights; window: number;
  };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  universeCap: 0,
  timeframes: ['15m', '1h', '4h', '1d'],
  lookback: 2000,
  confirmedMinConfidence: 65,
  provisionalMinConfidence: 75,
  tickMinMovePct: 0.05,
  tickMinIntervalMs: 1000,
  workerCount: Math.max(1, cpus().length - 2),
  wsSilenceMs: 30_000,
  wsDeadExitMs: 300_000,
  closeGraceMs: 2_000,
  burstLimit: 10,
  burstWindowMs: 60_000,
  dedupeCooldownMs: 6 * 3_600_000,
  webOrigin: 'http://localhost:5173',
  sinks: { telegram: false, discord: false, macos: false },
  analysis: {
    confluenceWindow: DEFAULT_BACKTEST_CONFIG.confluenceWindow,
    minRR: DEFAULT_BACKTEST_CONFIG.minRR,
    volumeSpikeK: 2,
    gate: { ...DEFAULT_GATE },
    weights: { ...DEFAULT_WEIGHTS },
    window: DEFAULT_WINDOW,
  },
};

type Env = Record<string, string | undefined>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(patch)) return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function loadEngineConfig(path = 'engine.json', env: Env = process.env): EngineConfig {
  let fileCfg: unknown = {};
  try {
    fileCfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // missing or unreadable file → defaults; malformed JSON also lands here deliberately (boot must not crash)
  }
  let cfg = deepMerge(structuredClone(DEFAULT_ENGINE_CONFIG), fileCfg);
  if (env.ENGINE_UNIVERSE_CAP) cfg = { ...cfg, universeCap: Number(env.ENGINE_UNIVERSE_CAP) };
  if (env.ENGINE_WORKERS) cfg = { ...cfg, workerCount: Number(env.ENGINE_WORKERS) };
  if (env.ENGINE_TIMEFRAMES) {
    const tfs = env.ENGINE_TIMEFRAMES.split(',').map((s) => s.trim()) as Interval[];
    const bad = tfs.filter((t) => !(SUPPORTED_INTERVALS as readonly string[]).includes(t));
    if (bad.length) throw new Error(`ENGINE_TIMEFRAMES: unknown intervals ${bad.join(', ')}`);
    cfg = { ...cfg, timeframes: tfs };
  }
  if (env.ENGINE_WEB_ORIGIN) cfg = { ...cfg, webOrigin: env.ENGINE_WEB_ORIGIN };
  // Sink rule: env secrets enable telegram/discord unless the json explicitly opts out (false).
  // macos needs no secret: the json toggle or ENGINE_MACOS_NOTIFY=1 enables it directly.
  const fileSinks = (isObject(fileCfg) && isObject((fileCfg as Record<string, unknown>).sinks)
    ? (fileCfg as { sinks: Record<string, unknown> }).sinks
    : {}) as Partial<Record<'telegram' | 'discord' | 'macos', boolean>>;
  cfg.sinks = {
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) && fileSinks.telegram !== false,
    discord: Boolean(env.DISCORD_WEBHOOK_URL) && fileSinks.discord !== false,
    macos: fileSinks.macos === true || env.ENGINE_MACOS_NOTIFY === '1',
  };
  if (!cfg.timeframes.includes('15m')) {
    throw new Error('engine timeframes must include 15m — it is the aggregation base');
  }
  return cfg;
}
```

- [ ] **Step 5: Implement logger**

```ts
// apps/server/src/engine/logger.ts
import { join } from 'node:path';
import pino from 'pino';

export type EngineLogger = pino.Logger;

/** Structured engine log with size-capped rotation: data/logs/engine.log, 20MB × 5 files. */
export function createEngineLogger(dir = 'data/logs'): EngineLogger {
  const transport = pino.transport({
    target: 'pino-roll',
    options: { file: join(dir, 'engine.log'), size: '20m', limit: { count: 5 }, mkdir: true },
  });
  return pino({ level: process.env.LOG_LEVEL ?? 'info', base: undefined }, transport);
}

/** Silent logger for tests. */
export function nullLogger(): EngineLogger {
  return pino({ level: 'silent' });
}
```

No dedicated unit test for the transport (async file plumbing — covered implicitly by the e2e checking `data/logs/engine.log` exists); `nullLogger` is what every other engine test injects.

- [ ] **Step 6: Create `engine.json.example`** (repo root)

```json
{
  "universeCap": 0,
  "timeframes": ["15m", "1h", "4h", "1d"],
  "confirmedMinConfidence": 65,
  "provisionalMinConfidence": 75,
  "sinks": { "telegram": true, "discord": true, "macos": true },
  "analysis": {
    "confluenceWindow": 3, "minRR": 1.5, "volumeSpikeK": 2,
    "gate": { "minTrades": 20, "minExpectancy": 0.1, "topN": 10 },
    "weights": { "edge": 0.4, "sample": 0.2, "confluence": 0.2, "bracket": 0.2 },
    "window": 3
  }
}
```

Add `engine.json` to `.gitignore` (the real file is local config).

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @cta/server test -- run test/engineConfig.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/engine/config.ts apps/server/src/engine/logger.ts engine.json.example .gitignore apps/server/test/engineConfig.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(engine): config loader (engine.json + env) and rotating structured logger"
```

**Model:** opus

---

### Task 5: Hyperliquid WS client

One connection, `candle@15m` per coin + `allMids`, heartbeat, silence-triggered reconnect with exponential backoff, resubscribe-on-open. Emits typed events; gap-fill on reconnect is the *engine's* job (Task 15) — this class only reports `down`/`open` transitions.

**HL WS protocol (from the official docs — encode it exactly like this):**
- URL: `wss://api.hyperliquid.xyz/ws`
- Subscribe: `{"method":"subscribe","subscription":{"type":"candle","coin":"BTC","interval":"15m"}}` / `{"method":"subscribe","subscription":{"type":"allMids"}}`
- Unsubscribe: same shape with `"method":"unsubscribe"`
- Heartbeat: send `{"method":"ping"}` at least once a minute; server replies `{"channel":"pong"}`
- Candle message: `{"channel":"candle","data":{"t":…,"T":…,"s":"BTC","i":"15m","o":"123.4","h":…,"l":…,"c":…,"v":…,"n":12}}` — o/h/l/c/v are **strings**
- allMids message: `{"channel":"allMids","data":{"mids":{"BTC":"61234.5","ETH":"2987.1",…}}}`

**Files:**
- Create: `apps/server/src/engine/ws.ts`
- Create: `apps/server/test/helpers/fakeHlWs.ts`
- Test: `apps/server/test/engineWs.test.ts`

- [ ] **Step 1: Add the `ws` devDependency (fake server only — the client uses Node's global WebSocket)**

```bash
pnpm --filter @cta/server add -D ws @types/ws
```

- [ ] **Step 2: Write the fake server helper**

```ts
// apps/server/test/helpers/fakeHlWs.ts
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';

export interface FakeHlWs {
  url: string;
  /** all parsed messages received from the client, in order */
  received: unknown[];
  /** resolves when the next client connects */
  nextConnection(): Promise<ServerSocket>;
  send(obj: unknown): void;            // to the most recent client
  sendCandle(coin: string, candle: { t: number; o: number; h: number; l: number; c: number; v: number; n?: number }): void;
  sendMids(mids: Record<string, number>): void;
  dropClients(): void;                 // hard-close all sockets (simulates network drop)
  close(): Promise<void>;
}

export function startFakeHlWs(): Promise<FakeHlWs> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const { port } = wss.address() as { port: number };
      resolve(api(wss, `ws://127.0.0.1:${port}`));
    });
  });
}

function api(wss: WebSocketServer, url: string): FakeHlWs {
  const received: unknown[] = [];
  let sockets: ServerSocket[] = [];
  let waiters: ((s: ServerSocket) => void)[] = [];
  wss.on('connection', (sock) => {
    sockets.push(sock);
    sock.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      received.push(msg);
      if (msg.method === 'ping') sock.send(JSON.stringify({ channel: 'pong' }));
    });
    waiters.splice(0).forEach((w) => w(sock));
  });
  const last = () => sockets[sockets.length - 1];
  return {
    url, received,
    nextConnection: () => new Promise((r) => waiters.push(r)),
    send: (obj) => last()?.send(JSON.stringify(obj)),
    sendCandle: (coin, c) => last()?.send(JSON.stringify({
      channel: 'candle',
      data: { t: c.t, T: c.t + 899_999, s: coin, i: '15m', o: String(c.o), h: String(c.h), l: String(c.l), c: String(c.c), v: String(c.v), n: c.n ?? 1 },
    })),
    sendMids: (mids) => last()?.send(JSON.stringify({
      channel: 'allMids',
      data: { mids: Object.fromEntries(Object.entries(mids).map(([k, v]) => [k, String(v)])) },
    })),
    dropClients: () => { sockets.forEach((s) => s.terminate()); sockets = []; },
    close: () => new Promise((r) => { sockets.forEach((s) => s.terminate()); wss.close(() => r()); }),
  };
}
```

- [ ] **Step 3: Write the failing tests**

```ts
// apps/server/test/engineWs.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperliquidWs } from '../src/engine/ws';
import { nullLogger } from '../src/engine/logger';
import { startFakeHlWs, type FakeHlWs } from './helpers/fakeHlWs';

const flush = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('HyperliquidWs', () => {
  let fake: FakeHlWs;
  let ws: HyperliquidWs;

  beforeEach(async () => { fake = await startFakeHlWs(); });
  afterEach(async () => { ws?.stop(); await fake.close(); });

  const mk = (over: Partial<ConstructorParameters<typeof HyperliquidWs>[0]> = {}) =>
    new HyperliquidWs({
      url: fake.url, log: nullLogger(),
      silenceMs: 60_000, pingIntervalMs: 30_000, baseBackoffMs: 20, maxBackoffMs: 100, ...over,
    });

  it('subscribes allMids + candle@15m per coin on open and emits typed events', async () => {
    ws = mk();
    ws.setCoins(['BTC', 'ETH']);
    const candles: unknown[] = [];
    const mids: unknown[] = [];
    ws.on('candle', (e) => candles.push(e));
    ws.on('mids', (m) => mids.push(m));
    ws.start();
    await fake.nextConnection();
    await flush();
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'allMids' } },
      { method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
      { method: 'subscribe', subscription: { type: 'candle', coin: 'ETH', interval: '15m' } },
    ]));
    fake.sendCandle('BTC', { t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, n: 3 });
    fake.sendMids({ BTC: 61234.5 });
    await flush();
    expect(candles).toEqual([{ coin: 'BTC', interval: '15m', candle: { t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, n: 3 } }]);
    expect(mids).toEqual([{ BTC: 61234.5 }]);
  });

  it('setCoins after open subscribes additions and unsubscribes removals', async () => {
    ws = mk();
    ws.setCoins(['BTC']);
    ws.start();
    await fake.nextConnection();
    await flush();
    ws.setCoins(['ETH']);
    await flush();
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'candle', coin: 'ETH', interval: '15m' } },
      { method: 'unsubscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
    ]));
  });

  it('reconnects with resubscribe after a network drop, emitting down then open', async () => {
    ws = mk();
    ws.setCoins(['BTC']);
    const transitions: string[] = [];
    ws.on('down', () => transitions.push('down'));
    ws.on('open', () => transitions.push('open'));
    ws.start();
    await fake.nextConnection();
    await flush();
    fake.received.length = 0;
    fake.dropClients();
    await fake.nextConnection(); // backoff is 20ms in tests
    await flush();
    expect(transitions).toEqual(['open', 'down', 'open']);
    expect(fake.received).toEqual(expect.arrayContaining([
      { method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '15m' } },
    ]));
  });

  it('force-reconnects when no message arrives within silenceMs', async () => {
    ws = mk({ silenceMs: 80, pingIntervalMs: 10_000 }); // silence far below ping cadence → must trip
    ws.setCoins([]);
    ws.start();
    await fake.nextConnection();
    await fake.nextConnection(); // a second connection proves the silence reconnect fired
    expect(ws.connected).toBe(true);
  });

  it('sends pings on the ping interval and treats pong as liveness', async () => {
    ws = mk({ pingIntervalMs: 30, silenceMs: 200 });
    ws.setCoins([]);
    ws.start();
    await fake.nextConnection();
    await flush(120);
    const pings = fake.received.filter((m) => (m as { method?: string }).method === 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2); // pongs keep resetting the silence window — no reconnect
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/engineWs.test.ts`
Expected: FAIL — cannot resolve `../src/engine/ws`.

- [ ] **Step 5: Implement**

```ts
// apps/server/src/engine/ws.ts
import { EventEmitter } from 'node:events';
import type { Candle } from '@cta/core';
import type { EngineLogger } from './logger';

export interface HyperliquidWsOptions {
  url?: string;
  log: EngineLogger;
  silenceMs?: number;
  pingIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

export interface WsCandleEvent { coin: string; interval: string; candle: Candle }

/**
 * Single-connection Hyperliquid WS: allMids + candle@15m per coin.
 * Emits: 'candle' (WsCandleEvent), 'mids' (Record<string, number>), 'open', 'down' (reason string).
 * Reconnect/resubscribe is internal; REST gap-fill on 'open' after 'down' is the caller's job.
 */
export class HyperliquidWs extends EventEmitter {
  private url: string;
  private log: EngineLogger;
  private silenceMs: number;
  private pingIntervalMs: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private now: () => number;

  private sock: WebSocket | null = null;
  private coins = new Set<string>();
  private stopped = true;
  private attempt = 0;
  private lastMsgAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HyperliquidWsOptions) {
    super();
    this.url = opts.url ?? 'wss://api.hyperliquid.xyz/ws';
    this.log = opts.log;
    this.silenceMs = opts.silenceMs ?? 30_000;
    this.pingIntervalMs = opts.pingIntervalMs ?? 30_000;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get connected(): boolean { return this.sock?.readyState === WebSocket.OPEN; }
  get lastMessageAt(): number { return this.lastMsgAt; }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.close();
    this.sock = null;
  }

  /** Declarative subscription set; diffs against the current one on a live socket. */
  setCoins(coins: string[]): void {
    const next = new Set(coins);
    if (this.connected) {
      for (const c of next) if (!this.coins.has(c)) this.send({ method: 'subscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
      for (const c of this.coins) if (!next.has(c)) this.send({ method: 'unsubscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
    }
    this.coins = next;
  }

  private connect(): void {
    if (this.stopped) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect(`constructor: ${String(err)}`);
      return;
    }
    this.sock = sock;
    sock.addEventListener('open', () => {
      if (sock !== this.sock) return; // a newer connection superseded this one
      this.attempt = 0;
      this.lastMsgAt = this.now();
      this.send({ method: 'subscribe', subscription: { type: 'allMids' } });
      for (const c of this.coins) this.send({ method: 'subscribe', subscription: { type: 'candle', coin: c, interval: '15m' } });
      this.armTimers();
      this.emit('open');
    });
    sock.addEventListener('message', (ev) => {
      if (sock !== this.sock) return;
      this.lastMsgAt = this.now();
      this.handle(typeof ev.data === 'string' ? ev.data : '');
    });
    const onGone = (reason: string) => () => {
      if (sock !== this.sock) return;
      this.sock = null;
      this.clearTimers();
      if (!this.stopped) {
        this.emit('down', reason);
        this.scheduleReconnect(reason);
      }
    };
    sock.addEventListener('close', onGone('close'));
    sock.addEventListener('error', onGone('error'));
  }

  private handle(raw: string): void {
    let msg: { channel?: string; data?: unknown };
    try { msg = JSON.parse(raw); } catch { this.log.warn({ raw: raw.slice(0, 200) }, 'ws: malformed message'); return; }
    if (msg.channel === 'candle') {
      const d = msg.data as { t: number; s: string; i: string; o: string; h: string; l: string; c: string; v: string; n: number };
      if (!d || typeof d.t !== 'number') { this.log.warn('ws: malformed candle'); return; }
      this.emit('candle', {
        coin: d.s, interval: d.i,
        candle: { t: d.t, o: +d.o, h: +d.h, l: +d.l, c: +d.c, v: +d.v, n: d.n },
      } satisfies WsCandleEvent);
    } else if (msg.channel === 'allMids') {
      const mids = (msg.data as { mids?: Record<string, string> })?.mids;
      if (!mids) return;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(mids)) out[k] = +v;
      this.emit('mids', out);
    }
    // pong and subscription acks only refresh lastMsgAt
  }

  private armTimers(): void {
    this.clearTimers();
    this.timers.push(setInterval(() => this.send({ method: 'ping' }), this.pingIntervalMs));
    this.timers.push(setInterval(() => {
      if (this.now() - this.lastMsgAt > this.silenceMs) {
        this.log.warn({ silenceMs: this.silenceMs }, 'ws: silence threshold — forcing reconnect');
        const sock = this.sock;
        this.sock = null;
        this.clearTimers();
        sock?.close();
        this.emit('down', 'silence');
        this.scheduleReconnect('silence');
      }
    }, Math.max(10, Math.min(this.silenceMs / 4, 5_000))));
    for (const t of this.timers) if (typeof t === 'object' && 'unref' in t) t.unref();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    const delay = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** this.attempt++);
    this.log.info({ reason, delay, attempt: this.attempt }, 'ws: reconnect scheduled');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  private send(obj: unknown): void {
    if (this.connected) this.sock!.send(JSON.stringify(obj));
  }
}
```

> **DEVIATION (Task 5, recorded during implementation):** in the silence-reconnect test, `nextConnection()` resolves on the SERVER's connection event before the client processes the 101 handshake, so the bare `expect(ws.connected).toBe(true)` was deterministically flaky. Fixed with `await new Promise<void>((r) => ws.once('open', () => r()))` before the assertion (deterministic event wait, assertion unchanged). Also dropped the unused `vi` import. Client code itself transcribed verbatim — reviewer audited all supersede/silence/stop races and found no bugs.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cta/server test -- run test/engineWs.test.ts` → PASS (these use real short timers; if a test is flaky on timing, widen `flush()` waits, never the assertions), then `pnpm -r test` → green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/engine/ws.ts apps/server/test/helpers/fakeHlWs.ts apps/server/test/engineWs.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(engine): Hyperliquid WS client with heartbeat, silence reconnect, resubscribe"
```

**Model:** fable

---

### Task 6: CandleAggregator

Owns per-coin candle state: the in-memory closed series per timeframe (capped at `lookback`), the forming candle per timeframe, WS-candle ingestion, mid application, boundary closes with grace timer, and `close` events. Storage-free — the engine (Task 15) persists closes to `CandleStore` and enqueues scans.

**Files:**
- Create: `apps/server/src/engine/aggregator.ts`
- Test: `apps/server/test/aggregator.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/aggregator.test.ts
import { describe, expect, it } from 'vitest';
import { CandleAggregator } from '../src/engine/aggregator';
import type { Candle } from '@cta/core';

const M15 = 900_000, H1 = 3_600_000;
const c = (t: number, o = 1, h = 2, l = 0.5, cl = 1.5, v = 1, n = 1): Candle => ({ t, o, h, l, c: cl, v, n });

const mk = (now: () => number, timeframes: ('15m' | '1h' | '4h' | '1d')[] = ['15m', '1h']) => {
  const agg = new CandleAggregator({ timeframes, lookback: 50, closeGraceMs: 2_000, now });
  const closes: { coin: string; interval: string; candle: Candle }[] = [];
  agg.on('close', (e) => closes.push(e));
  return { agg, closes };
};

describe('CandleAggregator', () => {
  it('seed splits closed history from the still-open bucket', () => {
    let t = M15 * 2 + 1; // inside the third 15m bucket
    const { agg } = mk(() => t);
    agg.seed('BTC', '15m', [c(0), c(M15), c(M15 * 2)]); // last one is the open bucket
    expect(agg.series('BTC', '15m')).toEqual([c(0), c(M15)]);
    expect(agg.forming('BTC', '15m')).toEqual(c(M15 * 2));
    expect(agg.withForming('BTC', '15m')).toEqual([c(0), c(M15), c(M15 * 2)]);
  });

  it('ws candle for the forming bucket replaces it authoritatively; newer t closes the old one', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    agg.onWsCandle('BTC', c(0, 1, 3, 1, 2));          // same bucket → replace
    expect(agg.forming('BTC', '15m')).toEqual(c(0, 1, 3, 1, 2));
    now = M15 + 1;
    agg.onWsCandle('BTC', c(M15, 2, 2, 2, 2));         // next bucket → close previous
    expect(closes).toEqual([{ coin: 'BTC', interval: '15m', candle: c(0, 1, 3, 1, 2) }]);
    expect(agg.series('BTC', '15m')).toEqual([c(0, 1, 3, 1, 2)]);
    expect(agg.forming('BTC', '15m')).toEqual(c(M15, 2, 2, 2, 2));
  });

  it('builds the 1h forming from closed 15m candles and closes it on the 4th close', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    for (let i = 0; i < 5; i++) {
      now = i * M15 + 1;
      agg.onWsCandle('BTC', c(i * M15, 10 + i, 20 + i, 5 + i, 15 + i, 2, 1));
    }
    // candles 0..3 closed (arrival of #4 closed #3) → 1h bucket [0,4×15m) complete
    const h1Closes = closes.filter((e) => e.interval === '1h');
    expect(h1Closes).toHaveLength(1);
    expect(h1Closes[0].candle).toEqual({ t: 0, o: 10, h: 23, l: 5, c: 18, v: 8, n: 4 });
    expect(agg.series('BTC', '1h')).toEqual([h1Closes[0].candle]);
  });

  it('applies mids to every forming timeframe', () => {
    let now = 1;
    const { agg } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 10, 11, 9, 10));
    agg.onMid('BTC', 12, 5);
    expect(agg.forming('BTC', '15m')).toEqual({ t: 0, o: 10, h: 12, l: 9, c: 12, v: 1, n: 1 });
    expect(agg.forming('BTC', '1h')!.c).toBe(12);
    expect(agg.forming('BTC', '1h')!.h).toBe(12);
  });

  it('a mid with no forming candle starts one per timeframe at the bucket boundary with zero volume', () => {
    const { agg } = mk(() => M15 + 7);
    agg.onMid('BTC', 100, M15 + 5);
    expect(agg.forming('BTC', '15m')).toEqual({ t: M15, o: 100, h: 100, l: 100, c: 100, v: 0, n: 0 });
    expect(agg.forming('BTC', '1h')).toEqual({ t: 0, o: 100, h: 100, l: 100, c: 100, v: 0, n: 0 });
  });

  it('closeDue closes a sparse-coin forming candle after boundary + grace', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    now = M15 + 1_000;            // inside grace
    agg.closeDue();
    expect(closes).toHaveLength(0);
    now = M15 + 2_500;            // past grace
    agg.closeDue();
    expect(closes).toEqual([{ coin: 'BTC', interval: '15m', candle: c(0, 1, 1, 1, 1) }]);
    expect(agg.forming('BTC', '15m')).toBeUndefined();
  });

  it('caps each closed series at lookback', () => {
    let now = 1;
    const { agg } = mk(() => now);
    for (let i = 0; i < 60; i++) {
      now = i * M15 + 1;
      agg.onWsCandle('BTC', c(i * M15));
    }
    expect(agg.series('BTC', '15m')).toHaveLength(50); // lookback cap
    expect(agg.series('BTC', '15m')[0].t).toBe(9 * M15);
  });

  it('a late candle for an already-closed bucket corrects the series without re-emitting', () => {
    let now = 1;
    const { agg, closes } = mk(() => now);
    agg.onWsCandle('BTC', c(0, 1, 1, 1, 1));
    now = M15 + 1;
    agg.onWsCandle('BTC', c(M15));
    closes.length = 0;
    agg.onWsCandle('BTC', c(0, 1, 9, 1, 8)); // late correction for bucket 0
    expect(closes).toEqual([]);
    expect(agg.series('BTC', '15m')[0]).toEqual(c(0, 1, 9, 1, 8));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/aggregator.test.ts`
Expected: FAIL — cannot resolve `../src/engine/aggregator`.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/engine/aggregator.ts
import { EventEmitter } from 'node:events';
import { applyMid, bucketStart } from '@cta/core';
import type { Candle, Interval } from '@cta/core';
import { INTERVAL_MS } from '../hyperliquid/pagination';

export interface AggregatorOptions {
  timeframes: Interval[];     // includes '15m'
  lookback: number;           // closed-series cap per coin×timeframe
  closeGraceMs: number;
  now?: () => number;
}

export interface CloseEvent { coin: string; interval: Interval; candle: Candle }

interface CoinState {
  series: Map<Interval, Candle[]>;
  forming: Map<Interval, Candle | undefined>;
}

/**
 * Stateful candle book per coin: 15m authoritative from WS, higher timeframes aggregated locally.
 * Emits 'close' (CloseEvent) exactly once per completed coin×timeframe candle.
 */
export class CandleAggregator extends EventEmitter {
  private timeframes: Interval[];
  private lookback: number;
  private closeGraceMs: number;
  private now: () => number;
  private coins = new Map<string, CoinState>();
  private base: Interval = '15m';

  constructor(opts: AggregatorOptions) {
    super();
    this.timeframes = opts.timeframes;
    this.lookback = opts.lookback;
    this.closeGraceMs = opts.closeGraceMs;
    this.now = opts.now ?? (() => Date.now());
  }

  private state(coin: string): CoinState {
    let s = this.coins.get(coin);
    if (!s) {
      s = { series: new Map(), forming: new Map() };
      for (const tf of this.timeframes) { s.series.set(tf, []); s.forming.set(tf, undefined); }
      this.coins.set(coin, s);
    }
    return s;
  }

  /** Backfilled history per coin×timeframe; the candle in the currently-open bucket becomes forming. */
  seed(coin: string, interval: Interval, candles: Candle[]): void {
    const s = this.state(coin);
    const step = INTERVAL_MS[interval];
    const openBucket = bucketStart(this.now(), step);
    const closed = candles.filter((c) => c.t < openBucket).slice(-this.lookback);
    const open = candles.find((c) => c.t === openBucket);
    s.series.set(interval, closed);
    s.forming.set(interval, open ? { ...open } : undefined);
  }

  series(coin: string, interval: Interval): Candle[] { return this.state(coin).series.get(interval) ?? []; }
  forming(coin: string, interval: Interval): Candle | undefined { return this.state(coin).forming.get(interval); }
  withForming(coin: string, interval: Interval): Candle[] {
    const f = this.forming(coin, interval);
    const base = this.series(coin, interval);
    return f ? [...base, f] : [...base];
  }
  trackedCoins(): string[] { return [...this.coins.keys()]; }

  /** Authoritative 15m candle from WS. */
  onWsCandle(coin: string, candle: Candle): void {
    const s = this.state(coin);
    const cur = s.forming.get(this.base);
    if (!cur || candle.t === cur.t) {
      s.forming.set(this.base, { ...candle });
      return;
    }
    if (candle.t > cur.t) {
      this.closeBase(coin, cur);
      s.forming.set(this.base, { ...candle });
      return;
    }
    // late correction for an already-closed bucket: fix the series in place, no re-emit
    const series = s.series.get(this.base)!;
    const idx = series.findIndex((x) => x.t === candle.t);
    if (idx >= 0) series[idx] = { ...candle };
  }

  onMid(coin: string, mid: number, t: number): void {
    const s = this.state(coin);
    for (const tf of this.timeframes) {
      const step = INTERVAL_MS[tf];
      const f = s.forming.get(tf);
      if (f) {
        s.forming.set(tf, applyMid(f, mid));
      } else {
        // start a forming candle from the mid (any timeframe): provisional checks need a forming
        // candle on 1h/4h/1d too, and mids are real prices. Accepted approximation: a candle
        // started this way carries a mid-based open until warm reseed corrects it.
        s.forming.set(tf, { t: bucketStart(t, step), o: mid, h: mid, l: mid, c: mid, v: 0, n: 0 });
      }
    }
  }

  /** Timer hook: close any base forming candle past its boundary + grace (sparse coins). */
  closeDue(): void {
    const t = this.now();
    const step = INTERVAL_MS[this.base];
    for (const [coin, s] of this.coins) {
      const f = s.forming.get(this.base);
      if (f && t >= f.t + step + this.closeGraceMs) {
        this.closeBase(coin, f);
        s.forming.set(this.base, undefined);
      }
    }
  }

  private closeBase(coin: string, candle: Candle): void {
    this.appendClosed(coin, this.base, candle);
    this.emit('close', { coin, interval: this.base, candle } satisfies CloseEvent);
    for (const tf of this.timeframes) {
      if (tf === this.base) continue;
      this.rollUp(coin, tf, candle);
    }
  }

  private rollUp(coin: string, tf: Interval, c15: Candle): void {
    const s = this.state(coin);
    const step = INTERVAL_MS[tf];
    const baseStep = INTERVAL_MS[this.base];
    const bucket = bucketStart(c15.t, step);
    let f = s.forming.get(tf);
    if (f && f.t !== bucket) {
      // base candle belongs to a newer bucket → the old forming is complete
      this.appendClosed(coin, tf, f);
      this.emit('close', { coin, interval: tf, candle: f } satisfies CloseEvent);
      f = undefined;
    }
    f = f
      ? { ...f, h: Math.max(f.h, c15.h), l: Math.min(f.l, c15.l), c: c15.c, v: f.v + c15.v, n: (f.n ?? 0) + (c15.n ?? 0) }
      : { t: bucket, o: c15.o, h: c15.h, l: c15.l, c: c15.c, v: c15.v, n: c15.n ?? 0 };
    if (c15.t + baseStep === bucket + step) {
      // this base candle completes the bucket → close immediately
      this.appendClosed(coin, tf, f);
      this.emit('close', { coin, interval: tf, candle: f } satisfies CloseEvent);
      s.forming.set(tf, undefined);
    } else {
      s.forming.set(tf, f);
    }
  }

  private appendClosed(coin: string, tf: Interval, candle: Candle): void {
    const series = this.state(coin).series.get(tf)!;
    series.push({ ...candle });
    if (series.length > this.lookback) series.splice(0, series.length - this.lookback);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- run test/aggregator.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine/aggregator.ts apps/server/test/aggregator.test.ts
git commit -m "feat(engine): CandleAggregator — forming state, local roll-up, grace closes"
```

**Model:** opus

### Task 7: worker pool + worker entry

`worker_threads` pool running `analyzeCoin` off the main thread. Respawn on crash; an in-flight job is re-queued once, then rejected and logged by the caller.

**Files:**
- Create: `apps/server/src/engine/workerPool.ts`
- Create: `apps/server/src/engine/worker.ts`
- Test: `apps/server/test/workerPool.test.ts`

- [ ] **Step 1: Write the worker entry first (the pool can't be tested without it)**

```ts
// apps/server/src/engine/worker.ts
import { parentPort } from 'node:worker_threads';
import { analyzeCoin } from '@cta/core';
import type { Candle, EngineAnalysisConfig } from '@cta/core';

export interface WorkerJob {
  id: number;
  candles: Candle[];
  config: EngineAnalysisConfig;
  /** test hook: makes the worker throw (unit-testing respawn) */
  poison?: boolean;
}

if (!parentPort) throw new Error('worker.ts must run as a worker thread');
parentPort.on('message', (job: WorkerJob) => {
  if (job.poison) throw new Error('poisoned job');
  const result = analyzeCoin(job.candles, job.config);
  parentPort!.postMessage({ id: job.id, result });
});
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/server/test/workerPool.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { defaultEngineAnalysisConfig } from '@cta/core';
import type { Candle } from '@cta/core';
import { WorkerPool } from '../src/engine/workerPool';
import { nullLogger } from '../src/engine/logger';

// deterministic trending series long enough for the pipeline to not throw
const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
  const o = 100 + i + Math.sin(i / 5) * 3;
  const c = 100 + i + 1 + Math.sin((i + 1) / 5) * 3;
  return { t: i * 900_000, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 10 + (i % 7), n: 5 };
});

describe('WorkerPool', () => {
  let pool: WorkerPool;
  afterEach(async () => { await pool?.destroy(); });

  it('runs analyzeCoin in a worker and resolves the result', async () => {
    pool = new WorkerPool({ size: 2, log: nullLogger() });
    const out = await pool.run({ candles, config: defaultEngineAnalysisConfig() });
    expect(out.candleCount).toBe(300);
    expect(out.lastCandleT).toBe(candles[299].t);
  }, 30_000);

  it('runs jobs in parallel across workers', async () => {
    pool = new WorkerPool({ size: 2, log: nullLogger() });
    const outs = await Promise.all([
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
      pool.run({ candles, config: defaultEngineAnalysisConfig() }),
    ]);
    expect(outs).toHaveLength(3);
    for (const o of outs) expect(o.candleCount).toBe(300);
  }, 30_000);

  it('respawns a crashed worker, retries the job once, and keeps serving', async () => {
    pool = new WorkerPool({ size: 1, log: nullLogger() });
    // poisoned job crashes the worker; the retry re-poisons (same payload) → rejects after the single retry
    await expect(pool.run({ candles, config: defaultEngineAnalysisConfig(), poison: true }))
      .rejects.toThrow(/worker|poisoned/i);
    // the pool must have respawned: a normal job still completes
    const out = await pool.run({ candles, config: defaultEngineAnalysisConfig() });
    expect(out.candleCount).toBe(300);
  }, 30_000);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/workerPool.test.ts`
Expected: FAIL — cannot resolve `../src/engine/workerPool`.

- [ ] **Step 4: Implement the pool**

```ts
// apps/server/src/engine/workerPool.ts
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { AnalyzeResult, Candle, EngineAnalysisConfig } from '@cta/core';
import type { EngineLogger } from './logger';
import type { WorkerJob } from './worker';

export interface PoolJob {
  candles: Candle[];
  config: EngineAnalysisConfig;
  poison?: boolean; // test hook
}

interface Pending {
  job: PoolJob;
  retried: boolean;
  resolve: (r: AnalyzeResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
}

/**
 * Fixed-size worker_threads pool for analyzeCoin jobs.
 * tsx quirk: workers must be spawned with execArgv ['--import','tsx'] so Node can load the TS entry.
 */
export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  private destroyed = false;
  private log: EngineLogger;

  constructor(opts: { size: number; log: EngineLogger }) {
    this.log = opts.log;
    for (let i = 0; i < opts.size; i++) this.slots.push(this.spawn());
  }

  get queueDepth(): number { return this.queue.length; }
  get busyCount(): number { return this.slots.filter((s) => s.busy).length; }

  run(job: PoolJob): Promise<AnalyzeResult> {
    if (this.destroyed) return Promise.reject(new Error('pool destroyed'));
    return new Promise<AnalyzeResult>((resolve, reject) => {
      this.queue.push({ job, retried: false, resolve, reject });
      this.pump();
    });
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const p of this.queue.splice(0)) p.reject(new Error('pool destroyed'));
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }

  private spawn(): Slot {
    const worker = new Worker(fileURLToPath(new URL('./worker.ts', import.meta.url)), {
      execArgv: ['--import', 'tsx'],
    });
    const slot: Slot = { worker, busy: null };
    worker.on('message', (msg: { id: number; result: AnalyzeResult }) => {
      const pending = slot.busy;
      slot.busy = null;
      pending?.resolve(msg.result);
      this.pump();
    });
    worker.on('error', (err) => this.onWorkerGone(slot, err));
    worker.on('exit', (code) => {
      if (code !== 0 && !this.destroyed) this.onWorkerGone(slot, new Error(`worker exited ${code}`));
    });
    return slot;
  }

  private onWorkerGone(slot: Slot, err: Error): void {
    if (this.destroyed) return;
    const pending = slot.busy;
    slot.busy = null;
    this.log.error({ err: err.message }, 'engine worker crashed — respawning');
    const i = this.slots.indexOf(slot);
    void slot.worker.terminate();
    if (i >= 0) this.slots[i] = this.spawn();
    if (pending) {
      if (pending.retried) {
        pending.reject(new Error(`worker job failed twice: ${err.message}`));
      } else {
        pending.retried = true;
        this.queue.unshift(pending); // re-queue once, at the front
      }
    }
    this.pump();
  }

  private pump(): void {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const pending = this.queue.shift()!;
      slot.busy = pending;
      const payload: WorkerJob = {
        id: this.nextId++, candles: pending.job.candles, config: pending.job.config, poison: pending.job.poison,
      };
      slot.worker.postMessage(payload);
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cta/server test -- run test/workerPool.test.ts` → PASS.
If the worker fails to start with a TS parse error, the `--import tsx` execArgv is not taking effect — check that `tsx` resolves from `apps/server` (`pnpm --filter @cta/server exec tsx --version`); do **not** work around by precompiling.
Then `pnpm -r test` → green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/engine/worker.ts apps/server/src/engine/workerPool.ts apps/server/test/workerPool.test.ts
git commit -m "feat(engine): worker_threads pool running the analyzeCoin kernel with respawn + single retry"
```

**Model:** fable

---

### Task 8: scan scheduler + tick gate

Pure in-memory policy objects (no I/O): `ScanQueue` (coalescing + priority) and `TickGate` (per-coin move/time throttle). The engine wires them in Task 15.

**Files:**
- Create: `apps/server/src/engine/scheduler.ts`
- Test: `apps/server/test/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/scheduler.test.ts
import { describe, expect, it } from 'vitest';
import { ScanQueue, TickGate } from '../src/engine/scheduler';

describe('ScanQueue', () => {
  it('coalesces duplicate coin×interval jobs', () => {
    const q = new ScanQueue();
    q.push({ coin: 'BTC', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    q.push({ coin: 'BTC', interval: '15m' });
    expect(q.size).toBe(2);
  });

  it('pops by volume rank (ascending) with provisional-active coins first', () => {
    const q = new ScanQueue();
    q.setVolumeRanks(new Map([['BTC', 0], ['ETH', 1], ['DOGE', 50]]));
    q.push({ coin: 'DOGE', interval: '1h' });
    q.push({ coin: 'ETH', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    q.markProvisionalActive('DOGE', true);
    expect(q.pop()).toEqual({ coin: 'DOGE', interval: '1h' }); // provisional-active jumps
    expect(q.pop()).toEqual({ coin: 'BTC', interval: '1h' });  // then rank order
    expect(q.pop()).toEqual({ coin: 'ETH', interval: '1h' });
    expect(q.pop()).toBeUndefined();
  });

  it('unranked coins sort after ranked ones', () => {
    const q = new ScanQueue();
    q.setVolumeRanks(new Map([['BTC', 0]]));
    q.push({ coin: 'NEWCOIN', interval: '1h' });
    q.push({ coin: 'BTC', interval: '1h' });
    expect(q.pop()!.coin).toBe('BTC');
    expect(q.pop()!.coin).toBe('NEWCOIN');
  });

  it('re-pushing after pop is allowed (not deduped against history)', () => {
    const q = new ScanQueue();
    q.push({ coin: 'BTC', interval: '1h' });
    q.pop();
    q.push({ coin: 'BTC', interval: '1h' });
    expect(q.size).toBe(1);
  });
});

describe('TickGate', () => {
  it('passes only when the move exceeds minMovePct since the last evaluation', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);      // first sighting
    now = 2000;
    expect(g.shouldEvaluate('BTC', 100.01)).toBe(false);  // 0.01% < 0.05%
    expect(g.shouldEvaluate('BTC', 100.2)).toBe(true);    // 0.2% move passes
  });

  it('rate-limits to one evaluation per minIntervalMs per coin', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    now = 500;
    expect(g.shouldEvaluate('BTC', 200)).toBe(false);     // huge move but inside the window
    now = 1001;
    expect(g.shouldEvaluate('BTC', 200)).toBe(true);
  });

  it('tracks coins independently', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 1000, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    expect(g.shouldEvaluate('ETH', 100)).toBe(true);
  });

  it('reference price updates only on passed evaluations (no drift accumulation)', () => {
    let now = 0;
    const g = new TickGate({ minMovePct: 0.05, minIntervalMs: 0, now: () => now });
    expect(g.shouldEvaluate('BTC', 100)).toBe(true);
    expect(g.shouldEvaluate('BTC', 100.03)).toBe(false); // +0.03%
    expect(g.shouldEvaluate('BTC', 100.06)).toBe(true);  // +0.06% vs 100 — tiny ticks must accumulate
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/scheduler.test.ts`
Expected: FAIL — cannot resolve `../src/engine/scheduler`.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/engine/scheduler.ts
import type { Interval } from '@cta/core';

export interface ScanJob { coin: string; interval: Interval }

/** Coalescing priority queue: provisional-active coins first, then 24h-volume rank, then FIFO. */
export class ScanQueue {
  private jobs = new Map<string, ScanJob>(); // key coin|interval — Map preserves insertion order (FIFO tiebreak)
  private ranks = new Map<string, number>();
  private provisionalActive = new Set<string>();

  get size(): number { return this.jobs.size; }

  setVolumeRanks(ranks: Map<string, number>): void { this.ranks = ranks; }
  markProvisionalActive(coin: string, active: boolean): void {
    if (active) this.provisionalActive.add(coin); else this.provisionalActive.delete(coin);
  }

  push(job: ScanJob): void {
    this.jobs.set(`${job.coin}|${job.interval}`, job);
  }

  pop(): ScanJob | undefined {
    let bestKey: string | undefined;
    let best: ScanJob | undefined;
    let bestScore = Infinity;
    for (const [key, job] of this.jobs) {
      const rank = this.ranks.get(job.coin) ?? Number.MAX_SAFE_INTEGER - 1;
      const score = this.provisionalActive.has(job.coin) ? rank - 1e9 : rank;
      if (score < bestScore) { bestScore = score; bestKey = key; best = job; }
    }
    if (bestKey) this.jobs.delete(bestKey);
    return best;
  }
}

export interface TickGateOptions { minMovePct: number; minIntervalMs: number; now?: () => number }

/** Per-coin throttle for provisional evaluations: both a min move and a min interval must pass. */
export class TickGate {
  private minMovePct: number;
  private minIntervalMs: number;
  private now: () => number;
  private last = new Map<string, { price: number; t: number }>();

  constructor(opts: TickGateOptions) {
    this.minMovePct = opts.minMovePct;
    this.minIntervalMs = opts.minIntervalMs;
    this.now = opts.now ?? (() => Date.now());
  }

  shouldEvaluate(coin: string, mid: number): boolean {
    const t = this.now();
    const prev = this.last.get(coin);
    if (!prev) { this.last.set(coin, { price: mid, t }); return true; }
    if (t - prev.t < this.minIntervalMs) return false;
    const movePct = Math.abs(mid - prev.price) / prev.price * 100;
    if (movePct < this.minMovePct) return false;
    this.last.set(coin, { price: mid, t });
    return true;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- run test/scheduler.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine/scheduler.ts apps/server/test/scheduler.test.ts
git commit -m "feat(engine): coalescing priority ScanQueue and per-coin TickGate"
```

**Model:** opus

---

### Task 9: alert store (SQLite)

Persistence for alerts and dedupe state, following the existing store patterns (`backtestStore.ts`). Schema lives in `db.ts` like all other tables.

**Files:**
- Modify: `apps/server/src/cache/db.ts`
- Create: `apps/server/src/cache/alertStore.ts`
- Test: `apps/server/test/alertStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/alertStore.test.ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/cache/db';
import { AlertStore } from '../src/cache/alertStore';

const row = (over: Partial<Parameters<AlertStore['insert']>[0]> = {}) => ({
  ts: 1000, kind: 'confirmed-new' as const, identity: 'BTC|1h|long|rsi-oversold|110532',
  coin: 'BTC', interval: '1h', payload: { entry: 100, stop: 95, target: 110, confidence: 70 },
  delivered: ['telegram'], ...over,
});

describe('AlertStore', () => {
  it('inserts and lists alerts newest-first', () => {
    const store = new AlertStore(openDb(':memory:'));
    store.insert(row({ ts: 1000 }));
    store.insert(row({ ts: 2000, kind: 'provisional-new' }));
    const out = store.recent(10);
    expect(out).toHaveLength(2);
    expect(out[0].ts).toBe(2000);
    expect(out[0].kind).toBe('provisional-new');
    expect(out[1].payload).toEqual({ entry: 100, stop: 95, target: 110, confidence: 70 });
  });

  it('records and reads per-(identity,kind) last-fired timestamps', () => {
    const store = new AlertStore(openDb(':memory:'));
    expect(store.lastFired('id1', 'confirmed-new')).toBeNull();
    store.markFired('id1', 'confirmed-new', 5000);
    expect(store.lastFired('id1', 'confirmed-new')).toBe(5000);
    store.markFired('id1', 'confirmed-new', 9000); // upsert
    expect(store.lastFired('id1', 'confirmed-new')).toBe(9000);
    expect(store.lastFired('id1', 'provisional-new')).toBeNull(); // kind-scoped
  });

  it('loads the full dedupe table for warm-boot cache priming', () => {
    const store = new AlertStore(openDb(':memory:'));
    store.markFired('a', 'confirmed-new', 1);
    store.markFired('b', 'provisional-new', 2);
    expect(store.allFired()).toEqual(new Map([['a|confirmed-new', 1], ['b|provisional-new', 2]]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/alertStore.test.ts`
Expected: FAIL — cannot resolve `../src/cache/alertStore`.

- [ ] **Step 3: Add tables to `db.ts`**

Append inside the existing `db.exec` template literal (after `backtest_results`):

```sql
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
```

- [ ] **Step 4: Implement the store**

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cta/server test -- run test/alertStore.test.ts` → PASS, then `pnpm -r test` → green (existing `db.ts` consumers are unaffected — new tables only).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/cache/db.ts apps/server/src/cache/alertStore.ts apps/server/test/alertStore.test.ts
git commit -m "feat(server): alert + dedupe SQLite tables and AlertStore"
```

**Model:** sonnet

### Task 10: AlertEngine — lifecycle semantics, dedupe, burst digest

The heart of the alerting spec. Owns: alert identity, provisional pending state, the ✓/✗ settle rules, threshold gates, identity+kind dedupe with cooldown (memory-cached, SQLite-backed), and the burst digest. Dispatching is injected (Task 11's dispatcher; tests use a fake).

**Exact semantics (from the spec — encode these, no improvisation):**
- Identity = `coin|interval|direction|setup.join('+')|entryBucket` where `entryBucket = Math.round(Math.log(entry) / Math.log(1.001))` (0.1% multiplicative buckets).
- `provisional-new`: plan from a forming-candle evaluation, `status==='active'`, `ageCandles===0`, `confidence.score >= provisionalMinConfidence`. At most one pending provisional per identity.
- On close scan for that coin×interval, every pending provisional settles to exactly one of:
  - `provisional-confirmed` — same identity present, `active`, `confidence.score >= confirmedMinConfidence`;
  - `provisional-withdrawn` — otherwise; if the identity exists but under-bar/expired, the alert note says it survived below the bar.
- `confirmed-new`: close-scan plan, `active`, `ageCandles===0`, `confidence.score >= confirmedMinConfidence`, and the identity was **not** just settled as `provisional-confirmed`.
- Dedupe: a given (identity, kind) never fires twice within `dedupeCooldownMs` (6h default). State survives restart via `alert_dedupe`, primed into memory at construction (`allFired()`); the hot path never reads SQLite.
- Burst: if more than `burstLimit` dispatches would occur within `burstWindowMs`, the overflow buffers; a single digest (count, coins, top 5 by confidence) flushes `digestFlushMs` (5s) later. Every overflow alert is still persisted individually with `delivered: ['digest']`.

**Files:**
- Create: `apps/server/src/engine/types.ts`
- Create: `apps/server/src/engine/alertEngine.ts`
- Test: `apps/server/test/alertEngine.test.ts`

- [ ] **Step 1: Write `engine/types.ts`**

```ts
// apps/server/src/engine/types.ts
import type { Interval, SignalDirection, SignalKind } from '@cta/core';
import type { AlertKind } from '../cache/alertStore';

export interface PlanAlert {
  kind: AlertKind;
  identity: string;
  coin: string;
  interval: Interval;
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

export interface DigestAlert {
  kind: 'digest';
  ts: number;
  count: number;
  coins: string[];
  top: PlanAlert[]; // top 5 by confidence
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/server/test/alertEngine.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { AlertStore } from '../src/cache/alertStore';
import { AlertEngine, planIdentity } from '../src/engine/alertEngine';
import { nullLogger } from '../src/engine/logger';
import type { DigestAlert, PlanAlert } from '../src/engine/types';

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  setup: ['rsi-oversold'], direction: 'long', signalT: 0, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status: 'active',
  metrics: { trades: 30, wins: 18, losses: 12, winRate: 0.6, avgR: 0.4, expectancy: 0.4, filtered: 0 } as TradePlan['metrics'],
  confidence: { edge: 0.8, sample: 0.5, confluence: 0, bracket: 0.6, score: 80 },
  ...over,
});
// NOTE: check packages/core/src/backtest/metrics.ts for the real SetupMetrics field names
// and adjust the metrics literal to match — the values are irrelevant to these tests.

interface Sent { text: string; alert: PlanAlert | DigestAlert }

const mk = (over: Partial<ConstructorParameters<typeof AlertEngine>[0]> = {}) => {
  const db = openDb(':memory:');
  const store = new AlertStore(db);
  const sent: Sent[] = [];
  let now = 1_000_000;
  const engine = new AlertEngine({
    store, log: nullLogger(),
    dispatch: async (text, alert) => { sent.push({ text, alert }); return ['telegram']; },
    confirmedMinConfidence: 65, provisionalMinConfidence: 75,
    dedupeCooldownMs: 6 * 3_600_000, burstLimit: 10, burstWindowMs: 60_000, digestFlushMs: 5_000,
    webOrigin: 'http://localhost:5173',
    now: () => now,
    ...over,
  });
  return { engine, store, sent, setNow: (t: number) => { now = t; }, db };
};

describe('AlertEngine', () => {
  it('fires provisional-new for an active age-0 plan at/above the provisional bar, exactly once', async () => {
    const { engine, sent, store } = mk();
    await engine.onProvisionalPlans('BTC', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 76 } })]);
    await engine.onProvisionalPlans('BTC', '1h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 76 } })]);
    expect(sent).toHaveLength(1);
    expect((sent[0].alert as PlanAlert).kind).toBe('provisional-new');
    expect(sent[0].text).toContain('BTC');
    expect(sent[0].text).toContain('coin=BTC');           // deep link params
    expect(sent[0].text).toContain('interval=1h');
    expect(store.recent(10)).toHaveLength(1);
    expect(engine.provisionalActiveCoins().has('BTC')).toBe(true);
  });

  it('ignores provisional plans below the provisional bar and stale (age>0) plans', async () => {
    const { engine, sent } = mk();
    await engine.onProvisionalPlans('BTC', '1h', [
      plan({ confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score: 74 } }),
      plan({ ageCandles: 1, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
      plan({ status: 'expired', confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
    ]);
    expect(sent).toHaveLength(0);
  });

  it('settles a pending provisional as confirmed when the close scan agrees — and does NOT also fire confirmed-new', async () => {
    const { engine, sent } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 80 } });
    await engine.onProvisionalPlans('BTC', '1h', [p]);
    await engine.onCloseScan('BTC', '1h', [p]); // same identity, active, 80 ≥ 65
    const kinds = sent.map((s) => (s.alert as PlanAlert).kind);
    expect(kinds).toEqual(['provisional-new', 'provisional-confirmed']);
    expect(engine.provisionalActiveCoins().has('BTC')).toBe(false);
  });

  it('settles as withdrawn when the close scan lost the setup, noting an under-bar survivor', async () => {
    const { engine, sent } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 80 } });
    await engine.onProvisionalPlans('BTC', '1h', [p]);
    await engine.onCloseScan('BTC', '1h', [
      { ...p, confidence: { ...p.confidence, score: 60 } }, // same identity, under the confirmed bar
    ]);
    const last = sent[sent.length - 1].alert as PlanAlert;
    expect(last.kind).toBe('provisional-withdrawn');
    expect(last.note).toMatch(/below/i);
  });

  it('fires confirmed-new for a fresh close-scan plan that was never provisional', async () => {
    const { engine, sent } = mk();
    await engine.onCloseScan('ETH', '4h', [plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 66 } })]);
    expect(sent).toHaveLength(1);
    expect((sent[0].alert as PlanAlert).kind).toBe('confirmed-new');
  });

  it('skips confirmed-new below the bar or with age > 0', async () => {
    const { engine, sent } = mk();
    await engine.onCloseScan('ETH', '4h', [
      plan({ confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score: 64 } }),
      plan({ ageCandles: 2, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 90 } }),
    ]);
    expect(sent).toHaveLength(0);
  });

  it('dedupes (identity, kind) within the cooldown and refires after it', async () => {
    const { engine, sent, setNow } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } });
    await engine.onCloseScan('BTC', '1h', [p]);
    setNow(1_000_000 + 3_600_000);
    await engine.onCloseScan('BTC', '1h', [p]); // 1h later: inside 6h cooldown
    expect(sent).toHaveLength(1);
    setNow(1_000_000 + 7 * 3_600_000);
    await engine.onCloseScan('BTC', '1h', [{ ...p, ageCandles: 0 }]); // past cooldown
    expect(sent).toHaveLength(2);
  });

  it('dedupe survives restart via the store', async () => {
    const { engine, sent, db } = mk();
    const p = plan({ confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 } });
    await engine.onCloseScan('BTC', '1h', [p]);
    expect(sent).toHaveLength(1);
    // "restart": fresh AlertEngine over the same db
    const sent2: Sent[] = [];
    const engine2 = new AlertEngine({
      store: new AlertStore(db), log: nullLogger(),
      dispatch: async (text, alert) => { sent2.push({ text, alert }); return ['telegram']; },
      confirmedMinConfidence: 65, provisionalMinConfidence: 75,
      dedupeCooldownMs: 6 * 3_600_000, burstLimit: 10, burstWindowMs: 60_000, digestFlushMs: 5_000,
      webOrigin: 'http://localhost:5173', now: () => 1_000_000 + 60_000,
    });
    await engine2.onCloseScan('BTC', '1h', [p]);
    expect(sent2).toHaveLength(0);
  });

  it('collapses overflow beyond burstLimit/window into one digest, persisting every alert', async () => {
    const { engine, sent, store } = mk({ burstLimit: 3, digestFlushMs: 10 });
    for (let i = 0; i < 5; i++) {
      await engine.onCloseScan(`COIN${i}`, '1h', [plan({ entry: 100 + i, confidence: { edge: 1, sample: 1, confluence: 1, bracket: 1, score: 70 + i } })]);
    }
    await new Promise((r) => setTimeout(r, 50)); // let the digest flush
    const digests = sent.filter((s) => (s.alert as DigestAlert).kind === 'digest');
    expect(sent.length - digests.length).toBe(3);          // individual dispatches stopped at the limit
    expect(digests).toHaveLength(1);
    expect((digests[0].alert as DigestAlert).count).toBe(2);
    expect(store.recent(20).filter((r) => r.kind !== 'digest')).toHaveLength(5); // all persisted individually
    expect(store.recent(20).some((r) => r.kind === 'digest')).toBe(true);
  });
});

describe('planIdentity', () => {
  it('buckets entry at 0.1% and is stable across tiny moves', () => {
    const a = planIdentity('BTC', '1h', plan({ entry: 100.00 }));
    const b = planIdentity('BTC', '1h', plan({ entry: 100.04 })); // +0.04% → same bucket
    const c = planIdentity('BTC', '1h', plan({ entry: 101.5 }));  // +1.5% → different bucket
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('BTC|1h|long|rsi-oversold|');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/alertEngine.test.ts`
Expected: FAIL — cannot resolve `../src/engine/alertEngine`.

- [ ] **Step 4: Implement**

```ts
// apps/server/src/engine/alertEngine.ts
import type { Interval, TradePlan } from '@cta/core';
import type { AlertKind, AlertStore } from '../cache/alertStore';
import type { EngineLogger } from './logger';
import type { DigestAlert, PlanAlert } from './types';

export function planIdentity(coin: string, interval: string, plan: TradePlan): string {
  const bucket = Math.round(Math.log(plan.entry) / Math.log(1.001));
  return `${coin}|${interval}|${plan.direction}|${plan.setup.join('+')}|${bucket}`;
}

export function formatAlertText(a: PlanAlert): string {
  const mark = { 'provisional-new': '⚠', 'provisional-confirmed': '✓', 'provisional-withdrawn': '✗', 'confirmed-new': '🔔', digest: '' }[a.kind];
  const head = `${mark} ${a.kind.toUpperCase()} ${a.coin} ${a.interval} ${a.direction.toUpperCase()}`;
  const body = `${a.setup.join('+')} | entry ${a.entry} stop ${a.stop} target ${a.target} | R/R ${a.rr.toFixed(2)} | conf ${Math.round(a.confidence)}`;
  return [head, body, a.note, a.link].filter(Boolean).join('\n');
}

export function formatDigestText(d: DigestAlert): string {
  const top = d.top.map((a) => `• ${a.coin} ${a.interval} ${a.direction} conf ${Math.round(a.confidence)}`).join('\n');
  return `📦 ${d.count} more alert(s) across ${d.coins.length} coin(s) in the last minute — top by confidence:\n${top}`;
}

export interface AlertEngineOptions {
  store: AlertStore;
  log: EngineLogger;
  /** delivers to all sinks; resolves with the sink names that accepted (never rejects) */
  dispatch: (text: string, alert: PlanAlert | DigestAlert) => Promise<string[]>;
  confirmedMinConfidence: number;
  provisionalMinConfidence: number;
  dedupeCooldownMs: number;
  burstLimit: number;
  burstWindowMs: number;
  digestFlushMs: number;
  webOrigin: string;
  now?: () => number;
}

export class AlertEngine {
  private o: Required<Omit<AlertEngineOptions, 'now'>>;
  private now: () => number;
  private fired: Map<string, number>;                       // `${identity}|${kind}` → ts (memory mirror of alert_dedupe)
  private pending = new Map<string, Map<string, PlanAlert>>(); // `${coin}|${interval}` → identity → provisional alert
  private dispatchTimes: number[] = [];
  private digestBuffer: PlanAlert[] = [];
  private digestTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AlertEngineOptions) {
    this.o = opts;
    this.now = opts.now ?? (() => Date.now());
    this.fired = opts.store.allFired();
  }

  provisionalActiveCoins(): Set<string> {
    const out = new Set<string>();
    for (const [key, m] of this.pending) if (m.size) out.add(key.split('|')[0]);
    return out;
  }

  /** Candidate plans from a forming-candle evaluation. */
  async onProvisionalPlans(coin: string, interval: Interval, plans: TradePlan[]): Promise<void> {
    const key = `${coin}|${interval}`;
    for (const p of plans) {
      if (p.status !== 'active' || p.ageCandles !== 0) continue;
      if (p.confidence.score < this.o.provisionalMinConfidence) continue;
      const identity = planIdentity(coin, interval, p);
      const bucket = this.pending.get(key) ?? new Map<string, PlanAlert>();
      this.pending.set(key, bucket);
      if (bucket.has(identity)) continue;
      if (this.inCooldown(identity, 'provisional-new')) continue;
      const alert = this.toAlert('provisional-new', identity, coin, interval, p);
      bucket.set(identity, alert);
      await this.fire(alert);
    }
  }

  /** Authoritative close-scan plans: settle pending provisionals, then fresh confirmed-new. */
  async onCloseScan(coin: string, interval: Interval, plans: TradePlan[]): Promise<void> {
    const key = `${coin}|${interval}`;
    const byIdentity = new Map(plans.map((p) => [planIdentity(coin, interval, p), p]));
    const settledConfirmed = new Set<string>();

    const bucket = this.pending.get(key);
    if (bucket) {
      for (const [identity, prov] of bucket) {
        const match = byIdentity.get(identity);
        if (match && match.status === 'active' && match.confidence.score >= this.o.confirmedMinConfidence) {
          settledConfirmed.add(identity);
          await this.fire(this.toAlert('provisional-confirmed', identity, coin, interval, match));
        } else {
          const note = match
            ? `setup survived the close but scored below the confirmed bar (${Math.round(match.confidence.score)} < ${this.o.confirmedMinConfidence})`
            : 'setup did not exist on the closed candle';
          await this.fire({ ...prov, kind: 'provisional-withdrawn', note, ts: this.now() });
        }
      }
      bucket.clear();
    }

    for (const p of plans) {
      if (p.status !== 'active' || p.ageCandles !== 0) continue;
      if (p.confidence.score < this.o.confirmedMinConfidence) continue;
      const identity = planIdentity(coin, interval, p);
      if (settledConfirmed.has(identity)) continue;
      if (this.inCooldown(identity, 'confirmed-new')) continue;
      await this.fire(this.toAlert('confirmed-new', identity, coin, interval, p));
    }
  }

  private toAlert(kind: AlertKind, identity: string, coin: string, interval: Interval, p: TradePlan): PlanAlert {
    return {
      kind, identity, coin, interval,
      direction: p.direction, setup: p.setup,
      entry: p.entry, stop: p.stop, target: p.target, rr: p.rr,
      confidence: p.confidence.score, ts: this.now(),
      link: `${this.o.webOrigin}/?coin=${encodeURIComponent(coin)}&interval=${interval}`,
    };
  }

  private inCooldown(identity: string, kind: AlertKind): boolean {
    const last = this.fired.get(`${identity}|${kind}`);
    return last !== undefined && this.now() - last < this.o.dedupeCooldownMs;
  }

  private markFired(identity: string, kind: AlertKind): void {
    const t = this.now();
    this.fired.set(`${identity}|${kind}`, t);
    this.o.store.markFired(identity, kind, t);
  }

  private async fire(alert: PlanAlert): Promise<void> {
    this.markFired(alert.identity, alert.kind);
    const t = this.now();
    this.dispatchTimes = this.dispatchTimes.filter((x) => t - x < this.o.burstWindowMs);
    if (this.dispatchTimes.length >= this.o.burstLimit) {
      this.digestBuffer.push(alert);
      this.o.store.insert({ ts: t, kind: alert.kind, identity: alert.identity, coin: alert.coin, interval: alert.interval, payload: alert, delivered: ['digest'] });
      if (!this.digestTimer) {
        this.digestTimer = setTimeout(() => { void this.flushDigest(); }, this.o.digestFlushMs);
        this.digestTimer.unref?.();
      }
      return;
    }
    this.dispatchTimes.push(t);
    const delivered = await this.o.dispatch(formatAlertText(alert), alert);
    this.o.store.insert({ ts: t, kind: alert.kind, identity: alert.identity, coin: alert.coin, interval: alert.interval, payload: alert, delivered });
  }

  private async flushDigest(): Promise<void> {
    this.digestTimer = null;
    const buf = this.digestBuffer.splice(0);
    if (!buf.length) return;
    const digest: DigestAlert = {
      kind: 'digest', ts: this.now(), count: buf.length,
      coins: [...new Set(buf.map((a) => a.coin))],
      top: [...buf].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
    const delivered = await this.o.dispatch(formatDigestText(digest), digest);
    this.o.store.insert({ ts: digest.ts, kind: 'digest', identity: 'digest', coin: '*', interval: '*', payload: digest, delivered });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cta/server test -- run test/alertEngine.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/engine/types.ts apps/server/src/engine/alertEngine.ts apps/server/test/alertEngine.test.ts
git commit -m "feat(engine): AlertEngine — provisional lifecycle, identity dedupe, burst digest"
```

**Model:** fable

---

### Task 11: sinks + dispatcher

Telegram, Discord webhook, macOS notification; each isolated behind a `Sink` interface, delivered by a dispatcher with 3 attempts + exponential backoff per sink that never throws and never blocks one sink on another.

**Files:**
- Create: `apps/server/src/engine/sinks/types.ts`
- Create: `apps/server/src/engine/sinks/telegram.ts`
- Create: `apps/server/src/engine/sinks/discord.ts`
- Create: `apps/server/src/engine/sinks/macos.ts`
- Create: `apps/server/src/engine/sinks/dispatcher.ts`
- Test: `apps/server/test/sinks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/sinks.test.ts
import { describe, expect, it } from 'vitest';
import { TelegramSink } from '../src/engine/sinks/telegram';
import { DiscordSink } from '../src/engine/sinks/discord';
import { MacosSink } from '../src/engine/sinks/macos';
import { SinkDispatcher } from '../src/engine/sinks/dispatcher';
import { nullLogger } from '../src/engine/logger';
import type { Sink } from '../src/engine/sinks/types';

const okResponse = { ok: true, status: 200 } as Response;
const failResponse = { ok: false, status: 500 } as Response;

describe('TelegramSink', () => {
  it('POSTs sendMessage with chat id and HTML parse mode', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const sink = new TelegramSink({
      token: 'TOK', chatId: '42',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return okResponse;
      }) as unknown as typeof fetch,
    });
    await sink.send('hello <b>world</b>');
    expect(calls[0].url).toBe('https://api.telegram.org/botTOK/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: '42', text: 'hello <b>world</b>', parse_mode: 'HTML', disable_web_page_preview: true });
  });

  it('throws on non-2xx so the dispatcher can retry', async () => {
    const sink = new TelegramSink({ token: 'T', chatId: 'c', fetchImpl: (async () => failResponse) as unknown as typeof fetch });
    await expect(sink.send('x')).rejects.toThrow(/500/);
  });
});

describe('DiscordSink', () => {
  it('POSTs the webhook with content truncated to 2000 chars', async () => {
    const calls: { url: string; body: { content: string } }[] = [];
    const sink = new DiscordSink({
      webhookUrl: 'https://discord/hook',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) });
        return okResponse;
      }) as unknown as typeof fetch,
    });
    await sink.send('y'.repeat(2500));
    expect(calls[0].url).toBe('https://discord/hook');
    expect(calls[0].body.content).toHaveLength(2000);
  });
});

describe('MacosSink', () => {
  it('invokes terminal-notifier with title and message', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const sink = new MacosSink({ execImpl: async (cmd, args) => { calls.push({ cmd, args }); } });
    await sink.send('line1\nline2');
    expect(calls[0].cmd).toBe('terminal-notifier');
    expect(calls[0].args).toEqual(['-title', 'CTA Engine', '-message', 'line1\nline2']);
  });

  it('falls back to osascript when terminal-notifier is missing', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const sink = new MacosSink({
      execImpl: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'terminal-notifier') { const e = new Error('not found') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; }
      },
    });
    await sink.send('it has "quotes" in it');
    expect(calls[1].cmd).toBe('osascript');
    expect(calls[1].args[1]).toContain('display notification');
    expect(calls[1].args[1]).not.toContain('"quotes"'); // quotes escaped, not raw
  });
});

describe('SinkDispatcher', () => {
  const sink = (name: string, behavior: () => Promise<void>): Sink => ({ name, send: behavior });

  it('returns the names of sinks that accepted; a failing sink never blocks the others', async () => {
    let aCalls = 0;
    const d = new SinkDispatcher({
      sinks: [
        sink('a', async () => { aCalls++; throw new Error('down'); }),
        sink('b', async () => {}),
      ],
      log: nullLogger(), attempts: 3, baseDelayMs: 1, sleep: async () => {},
    });
    const delivered = await d.dispatch('msg');
    expect(delivered).toEqual(['b']);
    expect(aCalls).toBe(3); // 3 attempts then gave up, no throw out of dispatch
  });

  it('retries with backoff and succeeds on a later attempt', async () => {
    let n = 0;
    const delays: number[] = [];
    const d = new SinkDispatcher({
      sinks: [sink('flaky', async () => { if (++n < 3) throw new Error('blip'); })],
      log: nullLogger(), attempts: 3, baseDelayMs: 100, sleep: async (ms) => { delays.push(ms); },
    });
    expect(await d.dispatch('msg')).toEqual(['flaky']);
    expect(delays).toEqual([100, 200]); // exponential
  });

  it('dispatches to all sinks concurrently (not sequentially)', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = new SinkDispatcher({
      sinks: [
        sink('slow', async () => { order.push('slow-start'); await gate; order.push('slow-end'); }),
        sink('fast', async () => { order.push('fast'); }),
      ],
      log: nullLogger(), attempts: 1, baseDelayMs: 1, sleep: async () => {},
    });
    const p = d.dispatch('msg');
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['slow-start', 'fast']); // fast finished while slow is blocked
    release();
    expect(await p).toEqual(['slow', 'fast']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/sinks.test.ts`
Expected: FAIL — cannot resolve sink modules.

- [ ] **Step 3: Implement all five files**

```ts
// apps/server/src/engine/sinks/types.ts
export interface Sink {
  readonly name: string;
  /** Must throw on delivery failure — the dispatcher owns retries. */
  send(text: string): Promise<void>;
}
```

```ts
// apps/server/src/engine/sinks/telegram.ts
import type { Sink } from './types';

export class TelegramSink implements Sink {
  readonly name = 'telegram';
  private f: typeof fetch;
  constructor(private opts: { token: string; chatId: string; fetchImpl?: typeof fetch }) {
    this.f = opts.fetchImpl ?? fetch;
  }
  async send(text: string): Promise<void> {
    const res = await this.f(`https://api.telegram.org/bot${this.opts.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.opts.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram sendMessage failed: ${res.status}`);
  }
}
```

```ts
// apps/server/src/engine/sinks/discord.ts
import type { Sink } from './types';

export class DiscordSink implements Sink {
  readonly name = 'discord';
  private f: typeof fetch;
  constructor(private opts: { webhookUrl: string; fetchImpl?: typeof fetch }) {
    this.f = opts.fetchImpl ?? fetch;
  }
  async send(text: string): Promise<void> {
    const res = await this.f(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 2000) }),
    });
    if (!res.ok) throw new Error(`discord webhook failed: ${res.status}`);
  }
}
```

```ts
// apps/server/src/engine/sinks/macos.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Sink } from './types';

const execFileAsync = promisify(execFile);
type ExecImpl = (cmd: string, args: string[]) => Promise<unknown>;

export class MacosSink implements Sink {
  readonly name = 'macos';
  private exec: ExecImpl;
  constructor(opts: { execImpl?: ExecImpl } = {}) {
    this.exec = opts.execImpl ?? ((cmd, args) => execFileAsync(cmd, args));
  }
  async send(text: string): Promise<void> {
    try {
      await this.exec('terminal-notifier', ['-title', 'CTA Engine', '-message', text]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await this.exec('osascript', ['-e', `display notification "${safe}" with title "CTA Engine"`]);
    }
  }
}
```

```ts
// apps/server/src/engine/sinks/dispatcher.ts
import type { EngineLogger } from '../logger';
import type { Sink } from './types';

export interface SinkDispatcherOptions {
  sinks: Sink[];
  log: EngineLogger;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Fan-out with per-sink retry; never throws; returns the sink names that accepted. */
export class SinkDispatcher {
  private attempts: number;
  private baseDelayMs: number;
  private sleep: (ms: number) => Promise<void>;
  constructor(private opts: SinkDispatcherOptions) {
    this.attempts = opts.attempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get sinkNames(): string[] { return this.opts.sinks.map((s) => s.name); }

  async dispatch(text: string): Promise<string[]> {
    const results = await Promise.all(this.opts.sinks.map(async (sink) => {
      for (let attempt = 0; attempt < this.attempts; attempt++) {
        try {
          await sink.send(text);
          return sink.name;
        } catch (err) {
          if (attempt < this.attempts - 1) {
            await this.sleep(this.baseDelayMs * 2 ** attempt);
          } else {
            this.opts.log.error({ sink: sink.name, err: (err as Error).message }, 'sink delivery failed after retries');
          }
        }
      }
      return null;
    }));
    return results.filter((r): r is string => r !== null);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- run test/sinks.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine/sinks apps/server/test/sinks.test.ts
git commit -m "feat(engine): Telegram/Discord/macOS sinks behind a retrying, isolating dispatcher"
```

**Model:** opus

---

### Task 12: latency metrics + /health extension

Ring-buffer percentile tracker and the `/health` engine block. The 5-minute logging cadence is wired in Task 15.

**Files:**
- Create: `apps/server/src/engine/metrics.ts`
- Modify: `apps/server/src/routes/health.ts` (read it first — it currently returns `{ ok: true }`; keep that shape and add an optional `engine` block)
- Modify: `apps/server/src/app.ts` (pass an optional `engineStatus` provider through to the health route)
- Test: `apps/server/test/metrics.test.ts`, extend `apps/server/test/health.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/metrics.test.ts
import { describe, expect, it } from 'vitest';
import { LatencyTracker } from '../src/engine/metrics';

describe('LatencyTracker', () => {
  it('reports p50/p95/count per metric', () => {
    const m = new LatencyTracker();
    for (let i = 1; i <= 100; i++) m.record('scan', i);
    const p = m.percentiles('scan')!;
    expect(p.count).toBe(100);
    expect(p.p50).toBeGreaterThanOrEqual(50);
    expect(p.p50).toBeLessThanOrEqual(51);
    expect(p.p95).toBeGreaterThanOrEqual(95);
    expect(p.p95).toBeLessThanOrEqual(96);
  });

  it('returns null for unknown metrics and caps the ring buffer', () => {
    const m = new LatencyTracker(10);
    expect(m.percentiles('nope')).toBeNull();
    for (let i = 0; i < 25; i++) m.record('x', i);
    expect(m.percentiles('x')!.count).toBe(10); // only the newest 10 retained
    expect(m.percentiles('x')!.p50).toBeGreaterThanOrEqual(19); // old values evicted
  });

  it('snapshot lists every tracked metric', () => {
    const m = new LatencyTracker();
    m.record('a', 1);
    m.record('b', 2);
    expect(Object.keys(m.snapshot()).sort()).toEqual(['a', 'b']);
  });
});
```

Extend `apps/server/test/health.test.ts` with (match the existing test file's style for building the app):

```ts
it('includes the engine block when a status provider is registered', async () => {
  const app = buildApp({
    engineStatus: () => ({ wsConnected: true, lastTickAgeMs: 120, queueDepth: 0, busyWorkers: 1, coinsTracked: 20, coinsLive: 18, scansCompleted: 42, latencies: {} }),
  });
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.ok).toBe(true);
  expect(body.engine.wsConnected).toBe(true);
  expect(body.engine.scansCompleted).toBe(42);
});

it('omits the engine block when no provider is registered (existing shape unchanged)', async () => {
  const app = buildApp({});
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/metrics.test.ts test/health.test.ts`
Expected: FAIL — metrics module missing; health tests fail on `engineStatus`.

- [ ] **Step 3: Implement metrics**

```ts
// apps/server/src/engine/metrics.ts
export interface Percentiles { p50: number; p95: number; count: number }

export interface HealthSnapshot {
  wsConnected: boolean;
  lastTickAgeMs: number;
  queueDepth: number;
  busyWorkers: number;
  coinsTracked: number;
  coinsLive: number;
  scansCompleted: number;
  latencies: Record<string, Percentiles>;
}

/** Fixed-capacity ring buffer of recent samples per metric name. */
export class LatencyTracker {
  private buffers = new Map<string, { samples: number[]; idx: number; full: boolean }>();
  constructor(private capacity = 512) {}

  record(name: string, ms: number): void {
    let b = this.buffers.get(name);
    if (!b) { b = { samples: new Array<number>(this.capacity), idx: 0, full: false }; this.buffers.set(name, b); }
    b.samples[b.idx] = ms;
    b.idx = (b.idx + 1) % this.capacity;
    if (b.idx === 0) b.full = true;
  }

  percentiles(name: string): Percentiles | null {
    const b = this.buffers.get(name);
    if (!b) return null;
    const live = b.full ? b.samples : b.samples.slice(0, b.idx);
    if (!live.length) return null;
    const sorted = [...live].sort((x, y) => x - y);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { p50: at(0.5), p95: at(0.95), count: sorted.length };
  }

  snapshot(): Record<string, Percentiles> {
    const out: Record<string, Percentiles> = {};
    for (const name of this.buffers.keys()) {
      const p = this.percentiles(name);
      if (p) out[name] = p;
    }
    return out;
  }
}
```

- [ ] **Step 4: Extend health route + app wiring**

`apps/server/src/routes/health.ts` — add the optional provider parameter (keep the existing `{ ok: true }` response when absent):

```ts
import type { FastifyInstance } from 'fastify';
import type { HealthSnapshot } from '../engine/metrics';

export function registerHealthRoute(app: FastifyInstance, engineStatus?: () => HealthSnapshot): void {
  app.get('/health', async () => (engineStatus ? { ok: true, engine: engineStatus() } : { ok: true }));
}
```

`apps/server/src/app.ts` — extend the deps type and pass it through:

```ts
import type { HealthSnapshot } from './engine/metrics';
// AppDeps gains: engineStatus?: () => HealthSnapshot
export function buildApp(deps: Partial<AppDeps> & { routeTimeoutMs?: number; engineStatus?: () => HealthSnapshot } = {}): FastifyInstance {
  // …
  registerHealthRoute(app, deps.engineStatus);
  // … rest unchanged
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cta/server test -- run test/metrics.test.ts test/health.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/engine/metrics.ts apps/server/src/routes/health.ts apps/server/src/app.ts apps/server/test/metrics.test.ts apps/server/test/health.test.ts
git commit -m "feat(engine): latency percentile tracker and /health engine status block"
```

**Model:** opus

### Task 13: backfill orchestrator + universe management

Cold-start/warm-start backfill in 24h-volume order with per-coin readiness (no global barrier), degraded-coin retry, and universe snapshots. The hourly refresh timer and subscription diffing live in Task 15; this class owns the data work.

**Files:**
- Create: `apps/server/src/engine/backfill.ts`
- Test: `apps/server/test/backfill.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/backfill.test.ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '@cta/core';
import { BackfillOrchestrator } from '../src/engine/backfill';
import { nullLogger } from '../src/engine/logger';

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * 900_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));

const fakeMarkets = (rows: { name: string; dayNtlVlm: number }[]) => ({
  getMarkets: async () => ({ markets: rows.map((r) => ({ ...r, szDecimals: 2, maxLeverage: 10 })), updatedAt: 0 }),
});

const mk = (opts: {
  markets: { name: string; dayNtlVlm: number }[];
  failFor?: Set<string>;
  universeCap?: number;
}) => {
  const calls: { coin: string; interval: string }[] = [];
  const failFor = opts.failFor ?? new Set<string>();
  const candleService = {
    getCandles: async (coin: string, interval: string) => {
      calls.push({ coin, interval });
      if (failFor.has(coin)) throw new Error(`boom ${coin}`);
      return candles(100);
    },
  };
  const bf = new BackfillOrchestrator({
    candleService: candleService as never,
    marketsService: fakeMarkets(opts.markets) as never,
    log: nullLogger(),
    timeframes: ['15m', '1h'], lookback: 100,
    universeCap: opts.universeCap ?? 0, concurrency: 1,
  });
  const ready: string[] = [];
  bf.on('coin-ready', (e: { coin: string }) => ready.push(e.coin));
  return { bf, calls, ready, failFor };
};

describe('BackfillOrchestrator', () => {
  it('loads the universe sorted by 24h volume desc with rank map, honoring the cap', async () => {
    const { bf } = mk({ markets: [{ name: 'DOGE', dayNtlVlm: 5 }, { name: 'BTC', dayNtlVlm: 100 }, { name: 'ETH', dayNtlVlm: 50 }], universeCap: 2 });
    const u = await bf.loadUniverse();
    expect(u.coins).toEqual(['BTC', 'ETH']); // capped at 2, DOGE excluded
    expect(u.ranks.get('BTC')).toBe(0);
    expect(u.ranks.get('ETH')).toBe(1);
  });

  it('backfills every timeframe per coin in volume order and emits coin-ready per coin', async () => {
    const { bf, calls, ready } = mk({ markets: [{ name: 'ETH', dayNtlVlm: 50 }, { name: 'BTC', dayNtlVlm: 100 }] });
    const u = await bf.loadUniverse();
    await bf.run(u.coins);
    expect(ready).toEqual(['BTC', 'ETH']); // volume order, each ready as soon as its own data landed
    expect(calls).toEqual([
      { coin: 'BTC', interval: '15m' }, { coin: 'BTC', interval: '1h' },
      { coin: 'ETH', interval: '15m' }, { coin: 'ETH', interval: '1h' },
    ]);
  });

  it('coin-ready carries the fetched series per timeframe', async () => {
    const { bf } = mk({ markets: [{ name: 'BTC', dayNtlVlm: 1 }] });
    const events: { coin: string; series: Map<string, Candle[]> }[] = [];
    bf.on('coin-ready', (e) => events.push(e));
    await bf.run(['BTC']);
    expect(events[0].coin).toBe('BTC');
    expect(events[0].series.get('15m')).toHaveLength(100);
    expect(events[0].series.get('1h')).toHaveLength(100);
  });

  it('a failing coin lands in degraded and does not block the rest', async () => {
    const { bf, ready } = mk({ markets: [{ name: 'BTC', dayNtlVlm: 100 }, { name: 'BAD', dayNtlVlm: 90 }, { name: 'ETH', dayNtlVlm: 50 }], failFor: new Set(['BAD']) });
    const u = await bf.loadUniverse();
    await bf.run(u.coins);
    expect(ready).toEqual(['BTC', 'ETH']);
    expect(bf.degradedCoins).toEqual(['BAD']);
  });

  it('retryDegraded re-attempts and promotes recovered coins', async () => {
    const { bf, ready, failFor } = mk({ markets: [{ name: 'BAD', dayNtlVlm: 1 }], failFor: new Set(['BAD']) });
    await bf.run(['BAD']);
    expect(bf.degradedCoins).toEqual(['BAD']);
    failFor.delete('BAD'); // the API recovered
    await bf.retryDegraded();
    expect(ready).toEqual(['BAD']);
    expect(bf.degradedCoins).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/backfill.test.ts`
Expected: FAIL — cannot resolve `../src/engine/backfill`.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/engine/backfill.ts
import { EventEmitter } from 'node:events';
import type { Candle, Interval } from '@cta/core';
import type { CandleService } from '../services/candleService';
import type { MarketsService } from '../services/marketsService';
import type { EngineLogger } from './logger';

export interface BackfillOptions {
  candleService: CandleService;
  marketsService: MarketsService;
  log: EngineLogger;
  timeframes: Interval[];
  lookback: number;
  universeCap: number;   // 0 = all
  concurrency?: number;  // parallel coins (the rate limiter is the real throttle); default 2
}

export interface UniverseSnapshot { coins: string[]; ranks: Map<string, number> }
export interface CoinReadyEvent { coin: string; series: Map<Interval, Candle[]> }

/**
 * Volume-ordered history loader. Emits 'coin-ready' (CoinReadyEvent) per coin as its data lands —
 * the engine seeds the aggregator and starts analysis per coin, never behind a global barrier.
 */
export class BackfillOrchestrator extends EventEmitter {
  private degraded = new Set<string>();
  constructor(private o: BackfillOptions) { super(); }

  get degradedCoins(): string[] { return [...this.degraded]; }

  async loadUniverse(): Promise<UniverseSnapshot> {
    const { markets } = await this.o.marketsService.getMarkets();
    const sorted = [...markets].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
    const capped = this.o.universeCap > 0 ? sorted.slice(0, this.o.universeCap) : sorted;
    const coins = capped.map((m) => m.name);
    return { coins, ranks: new Map(coins.map((c, i) => [c, i])) };
  }

  /** Fetch history for the given coins (already in priority order). Resolves when all settle. */
  async run(coins: string[]): Promise<void> {
    const queue = [...coins];
    const workers = Array.from({ length: Math.min(this.o.concurrency ?? 2, Math.max(1, queue.length)) }, async () => {
      for (;;) {
        const coin = queue.shift();
        if (!coin) return;
        await this.fetchCoin(coin);
      }
    });
    await Promise.all(workers);
  }

  async retryDegraded(): Promise<void> {
    const coins = [...this.degraded];
    for (const coin of coins) await this.fetchCoin(coin);
  }

  private async fetchCoin(coin: string): Promise<void> {
    try {
      const series = new Map<Interval, Candle[]>();
      for (const tf of this.o.timeframes) {
        series.set(tf, await this.o.candleService.getCandles(coin, tf, this.o.lookback));
      }
      this.degraded.delete(coin);
      this.emit('coin-ready', { coin, series } satisfies CoinReadyEvent);
    } catch (err) {
      this.degraded.add(coin);
      this.o.log.warn({ coin, err: (err as Error).message }, 'backfill failed — coin degraded');
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- run test/backfill.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine/backfill.ts apps/server/test/backfill.test.ts
git commit -m "feat(engine): volume-ordered backfill with per-coin readiness and degraded retry"
```

**Model:** opus

---

### Task 14: provisional evaluator

Tick-path evaluation: for each coin passing the `TickGate`, evaluate all configured timeframes' forming candles against the coin's last-known qualified setups and hand candidate plans to the AlertEngine. The analysis call is injectable so unit tests stay deterministic; the default implementation uses the real core pipeline (covered end-to-end by Task 16).

**Files:**
- Create: `apps/server/src/engine/provisional.ts`
- Test: `apps/server/test/provisional.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/provisional.test.ts
import { describe, expect, it } from 'vitest';
import type { Candle, SetupResult, TradePlan } from '@cta/core';
import { CandleAggregator } from '../src/engine/aggregator';
import { TickGate } from '../src/engine/scheduler';
import { LatencyTracker } from '../src/engine/metrics';
import { ProvisionalEvaluator } from '../src/engine/provisional';
import { nullLogger } from '../src/engine/logger';

const M15 = 900_000;
const series = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * M15, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));
const qualified: SetupResult[] = [{ kinds: ['rsi-oversold'], metrics: { trades: 30, expectancy: 0.4 } as SetupResult['metrics'] }];

const mk = (minCandles = 20) => {
  let now = 100 * M15 + 5_000;
  const aggregator = new CandleAggregator({ timeframes: ['15m', '1h'], lookback: 500, closeGraceMs: 2_000, now: () => now });
  aggregator.seed('BTC', '15m', series(100));
  aggregator.seed('BTC', '1h', series(25).map((c) => ({ ...c, t: c.t * 4 })));
  aggregator.onMid('BTC', 1.5, now); // creates forming candles on both timeframes
  const evaluated: { coin: string; interval: string; candleCount: number }[] = [];
  const alerted: { coin: string; interval: string; plans: TradePlan[] }[] = [];
  const evaluator = new ProvisionalEvaluator({
    aggregator,
    tickGate: new TickGate({ minMovePct: 0.05, minIntervalMs: 0, now: () => now }),
    timeframes: ['15m', '1h'],
    minCandles,
    metrics: new LatencyTracker(),
    log: nullLogger(),
    alert: async (coin, interval, plans) => { alerted.push({ coin, interval, plans }); },
    analyze: (candles) => { 
      evaluated.push({ coin: 'BTC', interval: '?', candleCount: candles.length });
      return [{ setup: ['rsi-oversold'], direction: 'long', signalT: 0, ageCandles: 0, entry: 1.5, stop: 1, target: 2.5, rr: 2, status: 'active', metrics: qualified[0].metrics, confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 } } as TradePlan];
    },
  });
  return { evaluator, aggregator, evaluated, alerted, setNow: (t: number) => { now = t; } };
};

describe('ProvisionalEvaluator', () => {
  it('does nothing for coins with no qualified-setup cache yet', async () => {
    const { evaluator, evaluated } = mk();
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });

  it('evaluates every configured timeframe (closed series + forming appended) once qualified', async () => {
    const { evaluator, evaluated, alerted } = mk();
    evaluator.setQualified('BTC', '15m', qualified);
    evaluator.setQualified('BTC', '1h', qualified);
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(2);            // 15m + 1h
    expect(evaluated[0].candleCount).toBe(101);   // 100 closed + forming
    expect(alerted.map((a) => a.interval).sort()).toEqual(['15m', '1h']);
    expect(alerted[0].plans[0].confidence.score).toBe(80);
  });

  it('respects the tick gate (second tick with negligible move is skipped)', async () => {
    const { evaluator, evaluated } = mk();
    evaluator.setQualified('BTC', '15m', qualified);
    await evaluator.onMids({ BTC: 1.6 });
    const n = evaluated.length;
    await evaluator.onMids({ BTC: 1.6000001 });
    expect(evaluated).toHaveLength(n);
  });

  it('skips timeframes whose series is shorter than minCandles', async () => {
    const { evaluator, evaluated } = mk(50);
    evaluator.setQualified('BTC', '1h', qualified); // 1h has only 25 closed candles < 50
    await evaluator.onMids({ BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });

  it('skips coins the aggregator does not track and empty qualified lists', async () => {
    const { evaluator, evaluated } = mk();
    evaluator.setQualified('BTC', '15m', []);
    await evaluator.onMids({ UNKNOWN: 5, BTC: 1.6 });
    expect(evaluated).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- run test/provisional.test.ts`
Expected: FAIL — cannot resolve `../src/engine/provisional`.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/engine/provisional.ts
import {
  buildDetectorContext, buildTradePlans, detectAll,
} from '@cta/core';
import type {
  Candle, EngineAnalysisConfig, Interval, SetupResult, TradePlan,
} from '@cta/core';
import type { CandleAggregator } from './aggregator';
import type { LatencyTracker } from './metrics';
import type { TickGate } from './scheduler';
import type { EngineLogger } from './logger';

export type AnalyzePlansFn = (candles: Candle[], qualified: SetupResult[]) => TradePlan[];

/** Default tick-path analysis: detector context + detection + plans against cached qualified setups (no backtest re-run). */
export function makePlanAnalyzer(cfg: EngineAnalysisConfig): AnalyzePlansFn {
  return (candles, qualified) => {
    const ctx = buildDetectorContext(candles, cfg.detector);
    const signals = detectAll(candles, ctx);
    return buildTradePlans(candles, ctx, signals, qualified, { ...cfg.backtest, window: cfg.window, weights: cfg.weights });
  };
}

export interface ProvisionalEvaluatorOptions {
  aggregator: CandleAggregator;
  tickGate: TickGate;
  timeframes: Interval[];
  minCandles: number; // MIN_BACKTEST_CANDLES
  metrics: LatencyTracker;
  log: EngineLogger;
  alert: (coin: string, interval: Interval, plans: TradePlan[]) => Promise<void>;
  analyze: AnalyzePlansFn;
  now?: () => number;
}

export class ProvisionalEvaluator {
  private qualified = new Map<string, SetupResult[]>(); // `${coin}|${interval}`
  private now: () => number;
  constructor(private o: ProvisionalEvaluatorOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  /** Engine updates this after every close scan; until then the coin×interval is not provisional-evaluated. */
  setQualified(coin: string, interval: Interval, qualified: SetupResult[]): void {
    this.qualified.set(`${coin}|${interval}`, qualified);
  }

  async onMids(mids: Record<string, number>): Promise<void> {
    for (const [coin, mid] of Object.entries(mids)) {
      if (!this.o.tickGate.shouldEvaluate(coin, mid)) continue;
      await this.evaluateCoin(coin);
    }
  }

  private async evaluateCoin(coin: string): Promise<void> {
    for (const tf of this.o.timeframes) {
      const qualified = this.qualified.get(`${coin}|${tf}`);
      if (!qualified || qualified.length === 0) continue;
      const forming = this.o.aggregator.forming(coin, tf);
      if (!forming) continue;
      const candles = this.o.aggregator.withForming(coin, tf);
      if (candles.length - 1 < this.o.minCandles) continue; // closed history too thin
      const started = this.now();
      try {
        const plans = this.o.analyze(candles, qualified);
        this.o.metrics.record('tick-eval', this.now() - started);
        await this.o.alert(coin, tf, plans);
      } catch (err) {
        this.o.log.error({ coin, tf, err: (err as Error).message }, 'provisional evaluation failed');
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- run test/provisional.test.ts` → PASS, then `pnpm -r test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/engine/provisional.ts apps/server/test/provisional.test.ts
git commit -m "feat(engine): tick-path provisional evaluator with injectable analysis"
```

**Model:** fable

---

### Task 15: Engine composition root + watchdog + server boot

Wires everything: WS → aggregator → (closes → store + queue → pool → alertEngine/qualified-cache) and (mids → aggregator + provisional), backfill/coin-ready → seed + subscribe + initial scans, reconnect gap-fill, hourly universe refresh, degraded retry, closeDue and metrics-log timers, watchdog, `ENGINE_ENABLED` boot, `/health` provider.

**Files:**
- Create: `apps/server/src/engine/watchdog.ts`
- Create: `apps/server/src/engine/engine.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/watchdog.test.ts`, `apps/server/test/engine.test.ts`

- [ ] **Step 1: Write the failing watchdog tests**

```ts
// apps/server/test/watchdog.test.ts
import { describe, expect, it } from 'vitest';
import { Watchdog } from '../src/engine/watchdog';
import { nullLogger } from '../src/engine/logger';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Watchdog', () => {
  it('exits when the WS has been dead longer than wsDeadExitMs', async () => {
    let now = 0;
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => 0, wsDeadExitMs: 1_000, checkMs: 10,
      stallToleranceMs: 60_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 500; await wait(30);
    expect(exits).toEqual([]);
    now = 1_500; await wait(30);
    expect(exits).toEqual([1]);
    wd.stop();
  });

  it('exits when the event loop stalls past tolerance (simulated via clock jump)', async () => {
    let now = 0;
    const exits: number[] = [];
    const wd = new Watchdog({
      wsLastMessageAt: () => now, wsDeadExitMs: 1e9, checkMs: 10,
      stallToleranceMs: 1_000, log: nullLogger(), now: () => now, exit: (c) => { exits.push(c); },
    });
    wd.start();
    now = 50; await wait(30);   // normal drift, no exit
    expect(exits).toEqual([]);
    now += 5_000; await wait(30); // 5s jump between 10ms checks = stall signature
    expect(exits).toEqual([2]);
    wd.stop();
  });
});
```

- [ ] **Step 2: Implement the watchdog**

```ts
// apps/server/src/engine/watchdog.ts
import type { EngineLogger } from './logger';

export interface WatchdogOptions {
  wsLastMessageAt: () => number;
  wsDeadExitMs: number;
  checkMs?: number;          // default 10_000
  stallToleranceMs?: number; // default 30_000
  log: EngineLogger;
  now?: () => number;
  exit?: (code: number) => void;
}

/**
 * Deliberate-exit recovery: launchd KeepAlive restarts the process.
 * Exit 1 = WS dead beyond the limit despite reconnects. Exit 2 = event-loop stall (timer-skew signature).
 */
export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = 0;
  private checkMs: number;
  private stallToleranceMs: number;
  private now: () => number;
  private exit: (code: number) => void;

  constructor(private o: WatchdogOptions) {
    this.checkMs = o.checkMs ?? 10_000;
    this.stallToleranceMs = o.stallToleranceMs ?? 30_000;
    this.now = o.now ?? (() => Date.now());
    this.exit = o.exit ?? ((code) => process.exit(code));
  }

  start(): void {
    this.lastCheck = this.now();
    this.timer = setInterval(() => this.check(), this.checkMs);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private check(): void {
    const t = this.now();
    const gap = t - this.lastCheck;
    this.lastCheck = t;
    if (gap > this.checkMs + this.stallToleranceMs) {
      this.o.log.fatal({ gap }, 'watchdog: event loop stalled — exiting for launchd restart');
      this.exit(2);
      return;
    }
    if (t - this.o.wsLastMessageAt() > this.o.wsDeadExitMs) {
      this.o.log.fatal({ deadMs: t - this.o.wsLastMessageAt() }, 'watchdog: WS dead beyond limit — exiting for launchd restart');
      this.exit(1);
    }
  }
}
```

Run: `pnpm --filter @cta/server test -- run test/watchdog.test.ts` → PASS.

- [ ] **Step 3: Write the failing engine tests**

These use manual fakes for WS/pool/services and drive the engine through its public seams. The point is the *wiring*: closes persist + enqueue + scan + alert; mids reach the evaluator; gap-fill fires on reconnect; universe refresh diffs subscriptions.

```ts
// apps/server/test/engine.test.ts
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { Engine } from '../src/engine/engine';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';

const M15 = 900_000;
/** n candles per step, all CLOSED relative to `now` (anchored at now's bucket, counting backwards). */
const mkCandles = (n: number, step: number, now: number): Candle[] => {
  const anchor = Math.floor(now / step) * step;
  return Array.from({ length: n }, (_, i) => ({ t: anchor - (n - i) * step, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 }));
};

class FakeWs extends EventEmitter {
  coins: string[] = [];
  started = false;
  lastMessageAt = 0;
  connected = true;
  start() { this.started = true; }
  stop() {}
  setCoins(c: string[]) { this.coins = [...c]; }
}

class FakePool {
  jobs: { candleCount: number }[] = [];
  queueDepth = 0; busyCount = 0;
  result: AnalyzeResult = { scanResults: [], plans: [], candleCount: 0, lastCandleT: 0 };
  async run(job: { candles: Candle[] }): Promise<AnalyzeResult> {
    this.jobs.push({ candleCount: job.candles.length });
    return { ...this.result, candleCount: job.candles.length, lastCandleT: job.candles[job.candles.length - 1]?.t ?? 0 };
  }
  async destroy() {}
}

const mkEngine = async (over: { universe?: { name: string; dayNtlVlm: number }[] } = {}) => {
  const db = openDb(':memory:');
  let now = 100 * M15 + 1;
  const universe = over.universe ?? [{ name: 'BTC', dayNtlVlm: 100 }];
  const gapFills: { coin: string; interval: string; force: boolean }[] = [];
  const candleService = {
    getCandles: async (coin: string, interval: string, _lb: number, opts: { force?: boolean } = {}) => {
      if (opts.force) gapFills.push({ coin, interval, force: true });
      return mkCandles(100, interval === '15m' ? M15 : M15 * 4, now); // 100 closed candles per timeframe
    },
  };
  const marketsService = { getMarkets: async () => ({ markets: universe.map((u) => ({ ...u, szDecimals: 2, maxLeverage: 10 })), updatedAt: 0 }) };
  const ws = new FakeWs();
  const pool = new FakePool();
  const config = {
    ...structuredClone(DEFAULT_ENGINE_CONFIG),
    timeframes: ['15m', '1h'] as const, lookback: 200, workerCount: 2,
  };
  const engine = new Engine({
    config: config as never, log: nullLogger(),
    candleService: candleService as never, marketsService: marketsService as never,
    candleStore: new CandleStore(db), alertStore: new AlertStore(db),
    dispatch: async () => ['telegram'],
    ws: ws as never, pool: pool as never,
    now: () => now,
  });
  await engine.start();
  await new Promise((r) => setTimeout(r, 20)); // let async coin-ready handlers settle
  return { engine, ws, pool, db, gapFills, setNow: (t: number) => { now = t; } };
};

describe('Engine wiring', () => {
  it('on start: loads the universe, starts WS, subscribes ready coins, runs initial scans', async () => {
    const { engine, ws, pool } = await mkEngine();
    expect(ws.started).toBe(true);
    expect(ws.coins).toEqual(['BTC']);
    expect(pool.jobs.length).toBe(2); // initial scan per timeframe
    expect(engine.status().coinsLive).toBe(1);
    expect(engine.status().scansCompleted).toBeGreaterThanOrEqual(2);
    await engine.stop();
  });

  it('a WS candle close persists the candle, enqueues a scan, and completes it', async () => {
    const { engine, ws, pool, db } = await mkEngine();
    const before = pool.jobs.length;
    ws.emit('candle', { coin: 'BTC', interval: '15m', candle: { t: 100 * M15, o: 1, h: 2, l: 0.5, c: 1.5, v: 1, n: 1 } });
    ws.emit('candle', { coin: 'BTC', interval: '15m', candle: { t: 101 * M15, o: 1, h: 2, l: 0.5, c: 1.6, v: 1, n: 1 } }); // closes the first
    await new Promise((r) => setTimeout(r, 20));
    expect(pool.jobs.length).toBeGreaterThan(before);
    const stored = new CandleStore(db).get('BTC', '15m', 100 * M15, 100 * M15);
    expect(stored).toHaveLength(1);
    await engine.stop();
  });

  it('reconnect after down gap-fills with force and reseeds', async () => {
    const { engine, ws, gapFills } = await mkEngine();
    ws.emit('down', 'silence');
    ws.emit('open');
    await new Promise((r) => setTimeout(r, 20));
    expect(gapFills).toEqual(expect.arrayContaining([
      { coin: 'BTC', interval: '15m', force: true },
      { coin: 'BTC', interval: '1h', force: true },
    ]));
    await engine.stop();
  });

  it('universe refresh diff adds and removes subscriptions', async () => {
    const { engine, ws } = await mkEngine({ universe: [{ name: 'BTC', dayNtlVlm: 100 }] });
    expect(ws.coins).toEqual(['BTC']);
    await engine.refreshUniverse([{ name: 'ETH', dayNtlVlm: 200 }, { name: 'BTC', dayNtlVlm: 100 }]
      .map((u) => ({ ...u, szDecimals: 2, maxLeverage: 10 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(ws.coins.sort()).toEqual(['BTC', 'ETH']);
    await engine.refreshUniverse([{ name: 'ETH', dayNtlVlm: 200, szDecimals: 2, maxLeverage: 10 }]);
    expect(ws.coins).toEqual(['ETH']); // BTC delisted → unsubscribed and dropped
    expect(engine.status().coinsTracked).toBe(1);
    await engine.stop();
  });

  it('status() reports ws/queue/worker/latency state', async () => {
    const { engine } = await mkEngine();
    const s = engine.status();
    expect(s.wsConnected).toBe(true);
    expect(typeof s.queueDepth).toBe('number');
    expect(typeof s.scansCompleted).toBe('number');
    expect(s.latencies).toBeDefined();
    await engine.stop();
  });
});
```

- [ ] **Step 4: Implement the engine**

```ts
// apps/server/src/engine/engine.ts
import { MIN_BACKTEST_CANDLES } from '../config';
import { qualifySetups } from '@cta/core';
import type { Candle, EngineAnalysisConfig, Interval } from '@cta/core';
import { DEFAULT_DETECTOR_OPTIONS, DEFAULT_BACKTEST_CONFIG } from '@cta/core';
import type { CandleStore } from '../cache/candleStore';
import type { AlertStore } from '../cache/alertStore';
import type { CandleService } from '../services/candleService';
import type { MarketsService } from '../services/marketsService';
import type { MarketRow } from '../cache/marketStore';
import { CandleAggregator } from './aggregator';
import { AlertEngine } from './alertEngine';
import { BackfillOrchestrator } from './backfill';
import type { EngineConfig } from './config';
import type { EngineLogger } from './logger';
import { LatencyTracker, type HealthSnapshot } from './metrics';
import { ProvisionalEvaluator, makePlanAnalyzer } from './provisional';
import { ScanQueue, TickGate } from './scheduler';
import { HyperliquidWs } from './ws';
import { WorkerPool } from './workerPool';
import type { DigestAlert, PlanAlert } from './types';

export interface EngineDeps {
  config: EngineConfig;
  log: EngineLogger;
  candleService: CandleService;
  marketsService: MarketsService;
  candleStore: CandleStore;
  alertStore: AlertStore;
  /** sink fan-out (Task 11 dispatcher.dispatch bound), injectable in tests */
  dispatch: (text: string, alert: PlanAlert | DigestAlert) => Promise<string[]>;
  ws?: HyperliquidWs;       // injectable for tests
  pool?: WorkerPool;        // injectable for tests
  now?: () => number;
}

export function buildAnalysisConfig(cfg: EngineConfig): EngineAnalysisConfig {
  return {
    detector: { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: cfg.analysis.volumeSpikeK },
    backtest: { ...DEFAULT_BACKTEST_CONFIG, confluenceWindow: cfg.analysis.confluenceWindow, minRR: cfg.analysis.minRR },
    gate: cfg.analysis.gate,
    weights: cfg.analysis.weights,
    window: cfg.analysis.window,
  };
}

export class Engine {
  private cfg: EngineConfig;
  private log: EngineLogger;
  private now: () => number;
  private analysisConfig: EngineAnalysisConfig;

  private ws: HyperliquidWs;
  private pool: WorkerPool;
  private aggregator: CandleAggregator;
  private queue = new ScanQueue();
  private metrics = new LatencyTracker();
  private alertEngine: AlertEngine;
  private provisional: ProvisionalEvaluator;
  private backfill: BackfillOrchestrator;

  private live = new Set<string>();          // coins seeded + subscribed
  private ranks = new Map<string, number>();
  private inFlight = 0;
  private scansCompleted = 0;
  private wasDown = false;
  private lastTickAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private prevProvisionalActive = new Set<string>();

  constructor(private deps: EngineDeps) {
    this.cfg = deps.config;
    this.log = deps.log;
    this.now = deps.now ?? (() => Date.now());
    this.analysisConfig = buildAnalysisConfig(this.cfg);

    this.ws = deps.ws ?? new HyperliquidWs({
      log: this.log, silenceMs: this.cfg.wsSilenceMs, now: this.now,
    });
    this.pool = deps.pool ?? new WorkerPool({ size: this.cfg.workerCount, log: this.log });
    this.aggregator = new CandleAggregator({
      timeframes: this.cfg.timeframes, lookback: this.cfg.lookback, closeGraceMs: this.cfg.closeGraceMs, now: this.now,
    });
    this.alertEngine = new AlertEngine({
      store: deps.alertStore, log: this.log, dispatch: deps.dispatch,
      confirmedMinConfidence: this.cfg.confirmedMinConfidence,
      provisionalMinConfidence: this.cfg.provisionalMinConfidence,
      dedupeCooldownMs: this.cfg.dedupeCooldownMs,
      burstLimit: this.cfg.burstLimit, burstWindowMs: this.cfg.burstWindowMs, digestFlushMs: 5_000,
      webOrigin: this.cfg.webOrigin, now: this.now,
    });
    this.provisional = new ProvisionalEvaluator({
      aggregator: this.aggregator,
      tickGate: new TickGate({ minMovePct: this.cfg.tickMinMovePct, minIntervalMs: this.cfg.tickMinIntervalMs, now: this.now }),
      timeframes: this.cfg.timeframes, minCandles: MIN_BACKTEST_CANDLES,
      metrics: this.metrics, log: this.log, now: this.now,
      analyze: makePlanAnalyzer(this.analysisConfig),
      alert: async (coin, interval, plans) => {
        const t0 = this.now();
        await this.alertEngine.onProvisionalPlans(coin, interval, plans);
        this.metrics.record('tick-alert', this.now() - t0);
        this.syncProvisionalActive();
      },
    });
    this.backfill = new BackfillOrchestrator({
      candleService: deps.candleService, marketsService: deps.marketsService, log: this.log,
      timeframes: this.cfg.timeframes, lookback: this.cfg.lookback, universeCap: this.cfg.universeCap,
    });

    this.aggregator.on('close', (e: { coin: string; interval: Interval; candle: Candle }) => {
      this.deps.candleStore.upsert(e.coin, e.interval, [e.candle]);
      this.queue.push({ coin: e.coin, interval: e.interval });
      this.pumpScans();
    });
    this.backfill.on('coin-ready', (e: { coin: string; series: Map<Interval, Candle[]> }) => {
      for (const [tf, candles] of e.series) this.aggregator.seed(e.coin, tf, candles);
      this.live.add(e.coin);
      this.ws.setCoins([...this.live]);
      for (const tf of this.cfg.timeframes) this.queue.push({ coin: e.coin, interval: tf });
      this.pumpScans();
    });
    this.ws.on('candle', (e: { coin: string; candle: Candle }) => this.aggregator.onWsCandle(e.coin, e.candle));
    this.ws.on('mids', (mids: Record<string, number>) => {
      const t = this.now();
      this.lastTickAt = t;
      for (const [coin, mid] of Object.entries(mids)) {
        if (this.live.has(coin)) this.aggregator.onMid(coin, mid, t);
      }
      void this.provisional.onMids(Object.fromEntries(Object.entries(mids).filter(([c]) => this.live.has(c))));
    });
    this.ws.on('down', () => { this.wasDown = true; });
    this.ws.on('open', () => { if (this.wasDown) { this.wasDown = false; void this.gapFill(); } });
  }

  async start(): Promise<void> {
    const universe = await this.backfill.loadUniverse();
    this.ranks = universe.ranks;
    this.queue.setVolumeRanks(this.ranks);
    this.ws.start();
    void this.backfill.run(universe.coins); // per-coin readiness — deliberately not awaited
    this.timers.push(setInterval(() => this.aggregator.closeDue(), 1_000));
    this.timers.push(setInterval(() => this.log.info({ latencies: this.metrics.snapshot(), ...this.counts() }, 'engine metrics'), 5 * 60_000));
    this.timers.push(setInterval(() => { void this.hourlyRefresh(); }, 3_600_000));
    this.timers.push(setInterval(() => { void this.backfill.retryDegraded(); }, 5 * 60_000));
    for (const t of this.timers) t.unref?.();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.ws.stop();
    await this.pool.destroy();
  }

  /** Public for tests; the hourly timer calls this with fresh market rows. */
  async refreshUniverse(markets?: MarketRow[]): Promise<void> {
    const rows = markets ?? (await this.deps.marketsService.getMarkets()).markets;
    const sorted = [...rows].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
    const capped = this.cfg.universeCap > 0 ? sorted.slice(0, this.cfg.universeCap) : sorted;
    const next = new Set(capped.map((m) => m.name));
    this.ranks = new Map([...next].map((c, i) => [c, i]));
    this.queue.setVolumeRanks(this.ranks);
    const added = [...next].filter((c) => !this.live.has(c) && !this.backfill.degradedCoins.includes(c));
    const removed = [...this.live].filter((c) => !next.has(c));
    for (const c of removed) this.live.delete(c);
    if (removed.length) this.ws.setCoins([...this.live]);
    if (added.length) void this.backfill.run(added);
    if (added.length || removed.length) this.log.info({ added, removed }, 'universe refreshed');
  }

  status(): HealthSnapshot {
    return {
      wsConnected: this.ws.connected,
      lastTickAgeMs: this.lastTickAt ? this.now() - this.lastTickAt : -1,
      queueDepth: this.queue.size,
      busyWorkers: this.inFlight,
      coinsTracked: this.live.size,
      coinsLive: this.live.size,
      scansCompleted: this.scansCompleted,
      latencies: this.metrics.snapshot(),
    };
  }

  get wsLastMessageAt(): number { return this.ws.lastMessageAt; }

  private counts(): Record<string, number> {
    return { queueDepth: this.queue.size, inFlight: this.inFlight, live: this.live.size, scansCompleted: this.scansCompleted };
  }

  private async hourlyRefresh(): Promise<void> {
    try { await this.refreshUniverse(); } catch (err) { this.log.warn({ err: (err as Error).message }, 'universe refresh failed'); }
  }

  private async gapFill(): Promise<void> {
    this.log.info({ coins: this.live.size }, 'ws reconnected — gap-filling');
    for (const coin of this.live) {
      for (const tf of this.cfg.timeframes) {
        try {
          const candles = await this.deps.candleService.getCandles(coin, tf, this.cfg.lookback, { force: true });
          this.aggregator.seed(coin, tf, candles);
        } catch (err) {
          this.log.warn({ coin, tf, err: (err as Error).message }, 'gap-fill failed');
        }
      }
      for (const tf of this.cfg.timeframes) this.queue.push({ coin, interval: tf });
    }
    this.pumpScans();
  }

  private syncProvisionalActive(): void {
    const active = this.alertEngine.provisionalActiveCoins();
    for (const c of active) if (!this.prevProvisionalActive.has(c)) this.queue.markProvisionalActive(c, true);
    for (const c of this.prevProvisionalActive) if (!active.has(c)) this.queue.markProvisionalActive(c, false);
    this.prevProvisionalActive = active;
  }

  private pumpScans(): void {
    while (this.inFlight < this.cfg.workerCount) {
      const job = this.queue.pop();
      if (!job) return;
      const candles = this.aggregator.series(job.coin, job.interval);
      if (candles.length < MIN_BACKTEST_CANDLES) continue;
      this.inFlight++;
      const started = this.now();
      void this.pool.run({ candles, config: this.analysisConfig })
        .then(async (result) => {
          this.metrics.record('close-scan', this.now() - started);
          this.scansCompleted++;
          const qualified = qualifySetups(result.scanResults, this.cfg.analysis.gate);
          this.provisional.setQualified(job.coin, job.interval, qualified);
          await this.alertEngine.onCloseScan(job.coin, job.interval, result.plans);
          this.syncProvisionalActive();
        })
        .catch((err) => this.log.error({ ...job, err: (err as Error).message }, 'scan job failed'))
        .finally(() => { this.inFlight--; this.pumpScans(); });
    }
  }
}
```

- [ ] **Step 5: Run the engine tests**

Run: `pnpm --filter @cta/server test -- run test/engine.test.ts` → PASS. Timing-sensitive waits may need widening (the `setTimeout(r, 20)` settles); never weaken assertions.

- [ ] **Step 6: Wire the server boot**

Modify `apps/server/src/server.ts` — after the existing service construction, before `buildApp`:

```ts
import { Engine } from './engine/engine';
import { Watchdog } from './engine/watchdog';
import { loadEngineConfig } from './engine/config';
import { createEngineLogger } from './engine/logger';
import { AlertStore } from './cache/alertStore';
import { SinkDispatcher } from './engine/sinks/dispatcher';
import { TelegramSink } from './engine/sinks/telegram';
import { DiscordSink } from './engine/sinks/discord';
import { MacosSink } from './engine/sinks/macos';
import type { Sink } from './engine/sinks/types';
import type { HealthSnapshot } from './engine/metrics';

let engineStatus: (() => HealthSnapshot) | undefined;
if (process.env.ENGINE_ENABLED === '1') {
  const engineLog = createEngineLogger(process.env.ENGINE_LOG_DIR ?? 'data/logs');
  const engineConfig = loadEngineConfig(process.env.ENGINE_CONFIG ?? 'engine.json');
  const sinks: Sink[] = [];
  if (engineConfig.sinks.telegram) sinks.push(new TelegramSink({ token: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }));
  if (engineConfig.sinks.discord) sinks.push(new DiscordSink({ webhookUrl: process.env.DISCORD_WEBHOOK_URL! }));
  if (engineConfig.sinks.macos) sinks.push(new MacosSink());
  const dispatcher = new SinkDispatcher({ sinks, log: engineLog });
  const engine = new Engine({
    config: engineConfig, log: engineLog,
    candleService, marketsService,
    candleStore: new CandleStore(db), alertStore: new AlertStore(db),
    dispatch: (text) => dispatcher.dispatch(text),
  });
  const watchdog = new Watchdog({
    wsLastMessageAt: () => engine.wsLastMessageAt, wsDeadExitMs: engineConfig.wsDeadExitMs, log: engineLog,
  });
  engine.start()
    .then(() => { watchdog.start(); engineLog.info('engine started'); })
    .catch((err) => { engineLog.fatal({ err: String(err) }, 'engine failed to start'); process.exit(1); });
  engineStatus = () => engine.status();
}

const app = buildApp({ marketsService, analysisService, backtestService, signalsService, engineStatus });
```

Note the `dispatch` adapter drops the alert object (the dispatcher only needs text in 4A; Phase 4B's SSE taps the AlertEngine via the store instead).

- [ ] **Step 7: Boot smoke check (no engine, then engine)**

```bash
pnpm --filter @cta/server exec tsx --eval "import('./src/app.ts').then(m => { const a = m.buildApp({}); return a.inject({ method: 'GET', url: '/health' }); }).then(r => console.log(r.body))"
```
Expected: `{"ok":true}`. Then run the full suite: `pnpm -r test` → green.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/engine/watchdog.ts apps/server/src/engine/engine.ts apps/server/src/server.ts apps/server/test/watchdog.test.ts apps/server/test/engine.test.ts
git commit -m "feat(engine): composition root, watchdog, ENGINE_ENABLED server boot"
```

**Model:** fable

### Task 16: integration test — fake HL WS replay through the real engine

End-to-end plumbing test: a **real** `HyperliquidWs` client connected to the fake WS server, real aggregator/scheduler/AlertEngine/stores, with two deterministic seams: the worker pool (scripted `AnalyzeResult`s) and the provisional analyzer (injected). Rationale: the real kernel is unit-tested (Task 3) and exercised live (Task 18); crafting raw OHLCV that deterministically produces a ≥75-confidence plan through real detectors would make this test brittle for zero added coverage. This task also adds the one prod seam it needs: `EngineDeps.provisionalAnalyze`.

**Files:**
- Modify: `apps/server/src/engine/engine.ts` (one optional dep)
- Test: `apps/server/test/engineIntegration.test.ts`

- [ ] **Step 1: Add the seam to `engine.ts`**

`EngineDeps` gains:

```ts
import type { AnalyzePlansFn } from './provisional';
// in EngineDeps:
  /** test seam: overrides the tick-path analyzer (default: makePlanAnalyzer(analysisConfig)) */
  provisionalAnalyze?: AnalyzePlansFn;
```

and in the `ProvisionalEvaluator` construction: `analyze: deps.provisionalAnalyze ?? makePlanAnalyzer(this.analysisConfig),`

Run: `pnpm --filter @cta/server test -- run test/engine.test.ts` → still PASS.

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/server/test/engineIntegration.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeResult, Candle, SetupResult, TradePlan } from '@cta/core';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import { AlertStore } from '../src/cache/alertStore';
import { Engine } from '../src/engine/engine';
import { HyperliquidWs } from '../src/engine/ws';
import { DEFAULT_ENGINE_CONFIG } from '../src/engine/config';
import { nullLogger } from '../src/engine/logger';
import { startFakeHlWs, type FakeHlWs } from './helpers/fakeHlWs';

const M15 = 900_000;
const until = async (cond: () => boolean, ms = 3_000, step = 20): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};

const qualifiedResult: SetupResult = {
  kinds: ['rsi-oversold'],
  metrics: { trades: 30, expectancy: 0.4 } as SetupResult['metrics'], // passes DEFAULT_GATE
};
const provisionalPlan: TradePlan = {
  setup: ['rsi-oversold'], direction: 'long', signalT: 0, ageCandles: 0,
  entry: 2.5, stop: 2, target: 3.5, rr: 2, status: 'active',
  metrics: qualifiedResult.metrics,
  confidence: { edge: 1, sample: 1, confluence: 0, bracket: 1, score: 80 },
};

describe('engine integration over fake HL WS', () => {
  let fake: FakeHlWs;
  let engine: Engine;
  afterEach(async () => { await engine?.stop(); await fake.close(); });
  beforeEach(async () => { fake = await startFakeHlWs(); });

  it('provisional-new → provisional-withdrawn → reconnect gap-fill, with exact persisted alerts', async () => {
    const bucket = Math.floor(Date.now() / M15) * M15;
    const closed: Candle[] = Array.from({ length: 100 }, (_, i) =>
      ({ t: bucket - (100 - i) * M15, o: 1, h: 1.2, l: 0.9, c: 1, v: 1, n: 1 }));
    const gapFills: { coin: string; interval: string }[] = [];
    const candleService = {
      getCandles: async (coin: string, interval: string, _lb: number, opts: { force?: boolean } = {}) => {
        if (opts.force) gapFills.push({ coin, interval });
        return closed;
      },
    };
    const marketsService = { getMarkets: async () => ({ markets: [{ name: 'BTC', dayNtlVlm: 100, szDecimals: 2, maxLeverage: 10 }], updatedAt: 0 }) };
    const db = openDb(':memory:');
    const alertStore = new AlertStore(db);
    const dispatched: string[] = [];
    const pool = {
      queueDepth: 0, busyCount: 0,
      run: async (job: { candles: Candle[] }): Promise<AnalyzeResult> =>
        ({ scanResults: [qualifiedResult], plans: [], candleCount: job.candles.length, lastCandleT: job.candles[job.candles.length - 1].t }),
      destroy: async () => {},
    };
    const ws = new HyperliquidWs({ url: fake.url, log: nullLogger(), silenceMs: 600_000, pingIntervalMs: 600_000, baseBackoffMs: 20, maxBackoffMs: 50 });
    engine = new Engine({
      config: {
        ...structuredClone(DEFAULT_ENGINE_CONFIG),
        timeframes: ['15m'], lookback: 200, workerCount: 1,
        tickMinMovePct: 0, tickMinIntervalMs: 0, burstLimit: 100, closeGraceMs: 600_000,
      } as never,
      log: nullLogger(),
      candleService: candleService as never, marketsService: marketsService as never,
      candleStore: new CandleStore(db), alertStore,
      dispatch: async (text) => { dispatched.push(text); return ['test-sink']; },
      ws, pool: pool as never,
      provisionalAnalyze: (candles) => (candles[candles.length - 1].c >= 2 ? [provisionalPlan] : []),
    });

    await engine.start();
    await until(() => engine.status().coinsLive === 1 && engine.status().scansCompleted >= 1);

    // forming candle arrives, then a mid spike triggers the provisional path
    fake.sendCandle('BTC', { t: bucket, o: 1, h: 1.1, l: 0.95, c: 1.05, v: 1 });
    fake.sendMids({ BTC: 2.5 });
    await until(() => dispatched.length >= 1);
    expect(dispatched[0]).toContain('PROVISIONAL-NEW');
    expect(dispatched[0]).toContain('coin=BTC');

    // next bucket's candle closes the forming one → close scan (plans: []) → withdrawn
    fake.sendCandle('BTC', { t: bucket + M15, o: 2.5, h: 2.5, l: 2.4, c: 2.45, v: 1 });
    await until(() => dispatched.length >= 2);
    expect(dispatched[1]).toContain('PROVISIONAL-WITHDRAWN');
    expect(dispatched[1].toLowerCase()).toContain('did not exist');

    const kinds = alertStore.recent(10).map((r) => r.kind);
    expect(kinds).toEqual(['provisional-withdrawn', 'provisional-new']); // newest first
    // dedupe persisted for both events
    expect(alertStore.lastFired(alertStore.recent(10)[1].identity, 'provisional-new')).not.toBeNull();

    // network drop → reconnect → forced gap-fill for every live coin×timeframe
    fake.dropClients();
    await until(() => gapFills.length >= 1, 5_000);
    expect(gapFills).toEqual(expect.arrayContaining([{ coin: 'BTC', interval: '15m' }]));
    // the candle store still has a contiguous closed series (gap-fill re-seeded from REST stub)
    const stored = new CandleStore(db).get('BTC', '15m', bucket - 100 * M15, bucket + M15);
    expect(stored.length).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
```

- [ ] **Step 3: Run to verify failure, then green**

Run: `pnpm --filter @cta/server test -- run test/engineIntegration.test.ts`
Expected first run: FAIL (missing `provisionalAnalyze` seam or assertion drift); iterate until PASS **without weakening assertions**. Then `pnpm -r test` → green.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/engine/engine.ts apps/server/test/engineIntegration.test.ts
git commit -m "test(engine): fake-WS integration — provisional lifecycle, persisted alerts, reconnect gap-fill"
```

**Model:** fable

---

### Task 17: launchd plist + ops docs

No code. The deliverables are a lint-clean plist and a runbook another machine could follow.

**Files:**
- Create: `ops/com.cta.engine.plist`
- Create: `docs/ops-mac.md`

- [ ] **Step 1: Write the plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cta.engine</string>
  <key>WorkingDirectory</key><string>__REPO_PATH__</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec pnpm --filter @cta/server start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ENGINE_ENABLED</key><string>1</string>
    <!-- secrets: fill in or leave empty to disable a sink -->
    <key>TELEGRAM_BOT_TOKEN</key><string></string>
    <key>TELEGRAM_CHAT_ID</key><string></string>
    <key>DISCORD_WEBHOOK_URL</key><string></string>
    <key>ENGINE_MACOS_NOTIFY</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>__REPO_PATH__/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>__REPO_PATH__/data/logs/launchd.err.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Write `docs/ops-mac.md`**

Cover, in this order, each as a copy-pasteable command block with a one-line explanation:
1. **Install**: `sed "s|__REPO_PATH__|$(pwd)|g" ops/com.cta.engine.plist > ~/Library/LaunchAgents/com.cta.engine.plist` (run from the repo root), fill the secret strings in the installed copy (never commit secrets), `plutil -lint ~/Library/LaunchAgents/com.cta.engine.plist`.
2. **Start / stop / restart**: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cta.engine.plist`, `launchctl bootout gui/$(id -u)/com.cta.engine`, restart = bootout + bootstrap. `launchctl print gui/$(id -u)/com.cta.engine | head -30` to inspect.
3. **Sleep prevention**: `caffeinate -s` in the plist blocks sleep while the engine runs on AC power; additionally recommend `sudo pmset -c sleep 0 displaysleep 10` and System Settings → Battery → "Prevent automatic sleeping on power adapter". Note: lid-closed operation requires AC power.
4. **Crash recovery semantics**: KeepAlive restarts on any exit; the watchdog exits deliberately (code 1 = WS dead >5 min, code 2 = event-loop stall) precisely to trigger this; warm restart gap-fills from SQLite in seconds (no full backfill).
5. **Health**: `curl -s localhost:3001/health | python3 -m json.tool` — field meanings (wsConnected, lastTickAgeMs, queueDepth, latencies p50/p95); logs at `data/logs/engine.log` (20MB × 5 rotation).
6. **Config**: `cp engine.json.example engine.json`, edit, restart to apply. Env reference table: `ENGINE_ENABLED`, `ENGINE_CONFIG`, `ENGINE_UNIVERSE_CAP`, `ENGINE_TIMEFRAMES`, `ENGINE_WORKERS`, `ENGINE_WEB_ORIGIN`, `ENGINE_LOG_DIR`, `ENGINE_MACOS_NOTIFY`, sink secrets.
7. **VPS portability note**: the engine has no macOS-only code paths; on Linux swap the plist for a systemd unit (KeepAlive→`Restart=always`, caffeinate→nothing).

- [ ] **Step 3: Verify**

```bash
sed "s|__REPO_PATH__|$(pwd)|g" ops/com.cta.engine.plist > /tmp/cta-verify-engine.plist && plutil -lint /tmp/cta-verify-engine.plist
```
Expected: `/tmp/cta-verify-engine.plist: OK`. Also `pnpm -r test` still green (nothing should have changed).

- [ ] **Step 4: Commit**

```bash
git add ops/com.cta.engine.plist docs/ops-mac.md
git commit -m "docs(ops): launchd service + 24/7 Mac runbook for the engine"
```

**Model:** sonnet

---

### Task 18: live e2e — `e2e/phase4a.mjs`

Boots the real server+engine against live Hyperliquid on a reduced universe with permissive thresholds (so alerts actually fire during the run, mirroring the phase-3 e2e's permissive-gate approach), then proves: ticks flow, scans complete inside budget, alerts persist, warm restart resumes. The script owns the server lifecycle (unlike phase2/3 which expect servers running) — document that in the header comment.

**Files:**
- Create: `e2e/phase4a.mjs`

- [ ] **Step 1: Write the script**

```js
// e2e/phase4a.mjs — Phase 4A live engine e2e against real Hyperliquid.
// Unlike phase2/3, this script OWNS the server lifecycle (spawns/kills it). Nothing may be on :3015.
// Run: node e2e/phase4a.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const PORT = 3015;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/e2e-phase4a.sqlite';
const CFG = 'data/e2e-phase4a-engine.json';
const fail = (msg) => { console.error(`FAIL: ${msg}`); cleanup(); process.exit(1); };

let server = null;
const cleanup = () => { server?.kill('SIGTERM'); };
process.on('exit', cleanup);

mkdirSync('data', { recursive: true });
rmSync(DB, { force: true });
// permissive thresholds so live data produces alert rows within the run window
writeFileSync(CFG, JSON.stringify({
  universeCap: 20,
  timeframes: ['15m', '1h'],
  confirmedMinConfidence: 0,
  provisionalMinConfidence: 0,
  analysis: { gate: { minTrades: 1, minExpectancy: -5, topN: 50 }, window: 50 },
}));

const env = {
  ...process.env,
  PORT: String(PORT),
  CACHE_DB_PATH: DB,
  ENGINE_ENABLED: '1',
  ENGINE_CONFIG: CFG,
  ENGINE_LOG_DIR: 'data/logs-e2e',
  // no sink secrets → all push sinks disabled; alerts still persist to SQLite
};
const startServer = () => spawn('pnpm', ['--filter', '@cta/server', 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

const health = async () => {
  try { return await (await fetch(`${BASE}/health`)).json(); } catch { return null; }
};
const until = async (label, cond, timeoutMs, stepMs = 2_000) => {
  const t0 = Date.now();
  for (;;) {
    const h = await health();
    if (h && cond(h)) return h;
    if (Date.now() - t0 > timeoutMs) fail(`${label} (after ${Math.round((Date.now() - t0) / 1000)}s): ${JSON.stringify(h)}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

// 1) cold boot: engine comes up, WS connects, coins go live in volume order, scans complete
server = startServer();
let h = await until('engine never reported live coins', (x) => x.engine && x.engine.coinsLive >= 5, 300_000);
console.log(`PASS: ${h.engine.coinsLive} coins live, wsConnected=${h.engine.wsConnected}`);
if (!h.engine.wsConnected) fail('ws not connected');

h = await until('initial scans did not complete', (x) => x.engine.scansCompleted >= 10, 300_000);
console.log(`PASS: ${h.engine.scansCompleted} scans completed`);

// 2) ticks flow (allMids is high-frequency: tick age must be small)
h = await until('no live ticks', (x) => x.engine.lastTickAgeMs >= 0 && x.engine.lastTickAgeMs < 10_000, 60_000);
console.log(`PASS: lastTickAgeMs=${h.engine.lastTickAgeMs}`);

// 3) latency budget (spec: per-scan p95 < 250ms)
const scan = h.engine.latencies['close-scan'];
if (!scan) fail('no close-scan latency samples');
if (scan.p95 >= 250) fail(`close-scan p95 ${scan.p95}ms breaches the 250ms budget`);
console.log(`PASS: close-scan p50=${scan.p50}ms p95=${scan.p95}ms (n=${scan.count})`);

// 4) alert rows persisted (permissive thresholds make confirmed-new effectively certain on 20 coins)
const { default: Database } = await import('better-sqlite3');
const db = new Database(DB, { readonly: true });
const alertCount = db.prepare('SELECT COUNT(*) AS n FROM alerts').get().n;
db.close();
if (alertCount === 0) fail('no alert rows persisted');
console.log(`PASS: ${alertCount} alert row(s) persisted`);

// 5) warm restart resumes without manual steps, far faster than cold boot
server.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 3_000));
server = startServer();
const t0 = Date.now();
h = await until('warm restart did not resume', (x) => x.engine && x.engine.coinsLive >= 5 && x.engine.wsConnected, 120_000);
console.log(`PASS: warm restart live again in ${Math.round((Date.now() - t0) / 1000)}s`);

console.log('E2E PASS');
cleanup();
process.exit(0);
```

Run from the repo root so the `better-sqlite3` import resolves via the workspace; if it does not, run the script with `node --experimental-vm-modules` unaffected — simply `cd apps/server && node ../../e2e/phase4a.mjs` is the fallback (document whichever works in the script header).

- [ ] **Step 2: Run it twice against live Hyperliquid**

Run: `node e2e/phase4a.mjs`
Expected: 6 `PASS:` lines then `E2E PASS`, twice in a row (second run exercises the warm-cache path from the start). Budget realism: 20 coins × 2 timeframes ≈ 40 backfill snapshots ≈ 2–3 min cold start.

- [ ] **Step 3: Commit**

```bash
git add e2e/phase4a.mjs
git commit -m "test(e2e): phase 4a live engine verification (boot, ticks, budget, alerts, warm restart)"
```

**Model:** fable

---

## Final verification (after all tasks)

- [ ] `pnpm -r test` — full suite green (expect ~270+ tests: 205 baseline + this phase's)
- [ ] `pnpm --filter @cta/web exec tsc --noEmit` — clean (web untouched; sanity)
- [ ] `node e2e/phase4a.mjs` — `E2E PASS` twice
- [ ] Tick every satisfied `- [ ]` in `docs/superpowers/specs/2026-06-11-phase4a-continuous-engine-design.md`
- [ ] Update `HANDOFF.md` per the handoff skill

**Deviation rule:** if reality contradicts this plan (API shapes, timing, tsx/worker quirks), diagnose the root cause, fix it properly, and record the deviation inline in this plan file next to the relevant step — exactly as done in Phases 2/3.





