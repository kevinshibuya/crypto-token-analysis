# Phase 3 — Signal Generation & Confidence Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn backtest-validated setups into live trade plans (entry/stop/target/R-R) with a composite confidence score, per coin and across the market via a client-orchestrated top-N-by-volume sweep.

**Architecture:** Decision logic is pure functions in `@cta/core` (new `decide/` subfolder) reusing Phase 2 detection, brackets, and scan. `@cta/server` adds one endpoint (`POST /api/signals`) that composes candleService → backtestService (cached scan) → decide, plus 24h volume on `/api/markets`. `@cta/web` adds a split-pane Signals tab (signal cards left, market scanner right), localStorage settings, and entry/stop/target price lines on the chart. Spec: `docs/superpowers/specs/2026-06-10-phase3-decisions-design.md`.

**Tech Stack:** TypeScript 5.4, Vitest 1 (`pnpm --filter <pkg> test`), Fastify 4, better-sqlite3, React 18, lightweight-charts **v4** (do NOT bump to v5), Tailwind. Monorepo via pnpm workspaces; run everything from the repo root.

**Conventions (match Phase 1/2):** 2-space indent, single quotes, semicolons, compact pure functions. Tests in `<pkg>/test/*.test.ts(x)`. Candle shorthand factories in tests. Commit after every task with the message given in the task.

## Per-task model assignment

Each task carries a **Difficulty** and a **Model** for the implementing subagent (orchestrator: pass it as the Agent tool's `model` parameter). The ladder ranks from Sonnet 4.6 to Fable 5: easy tasks (complete code in the plan, mostly transcription + test-running) → `sonnet`; standard multi-file integration → `opus`; tasks with deep domain logic, concurrency/abort races, or live-data debugging → `fable`. **Review: ONE consolidated spec+quality reviewer per task, tier-matched to the implementer's model** (sonnet→sonnet, opus→opus, fable→fable). A single review pass replaces Phase 2's two-stage review; the controller still hand-verifies findings before dispatching fixes.

| Task | What | Difficulty | Model |
|---|---|---|---|
| 1 | decide types + constants + `qualifySetups` | Easy | sonnet |
| 2 | `scoreConfidence` | Easy | sonnet |
| 3 | `buildTradePlans` + confluence + determinism | Hard (core logic) | fable |
| 4 | `metaAndAssetCtxs` + `dayNtlVlm` | Medium | opus |
| 5 | `SignalsService` | Medium | opus |
| 6 | `/api/signals` route + wiring | Medium | opus |
| 7 | web API types + client + `ApiError` | Easy | sonnet |
| 8 | signals settings (localStorage) | Easy | sonnet |
| 9 | `useSignals` hook | Medium | opus |
| 10 | `useMarketScan` hook | Hard (concurrency + abort) | fable |
| 11 | Toolbar Signals tab + App shell | Easy | sonnet |
| 12 | SignalsPanel left pane (cards + settings strip) | Medium | opus |
| 13 | Scanner pane | Medium | opus |
| 14 | Chart plan lines | Medium | opus |
| 15 | Browser e2e | Hard (live data) | fable |

---

## File structure

**`packages/core/src`** (new unless marked M = modify)
- `decide/types.ts` — `SetupGate`, `ConfidenceWeights`, `ConfidenceBreakdown`, `TradePlan`, `DecideConfig`, `SignalsResult`
- `decide/constants.ts` — scoring constants + defaults
- `decide/qualify.ts` — `qualifySetups`
- `decide/confidence.ts` — `scoreConfidence`
- `decide/plans.ts` — `buildTradePlans`
- `index.ts` (M) — export everything new

**`apps/server/src`**
- `hyperliquid/client.ts` (M) — `metaAndAssetCtxs()`
- `cache/marketStore.ts` (M) — `dayNtlVlm` on `MarketRow` + read normalization
- `services/marketsService.ts` (M) — volume in market rows
- `services/signalsService.ts` — orchestration + validation
- `routes/signals.ts` — `POST /api/signals`
- `app.ts` (M), `server.ts` (M) — wiring

**`apps/web/src`**
- `api/types.ts` (M) — `Market.dayNtlVlm`, signals types re-export, `SignalsSettings` import
- `api/client.ts` (M) — `ApiError`, `postSignals`
- `state/signalsSettings.ts` — settings type, defaults, load/save, `useSignalsSettings`
- `state/useSignals.ts` — per-coin plans hook
- `state/useMarketScan.ts` — sweep hook
- `components/Toolbar.tsx` (M) — third tab
- `components/SignalsPanel.tsx` — split-pane container + settings strip
- `components/SignalCard.tsx` — plan card
- `components/ScannerPane.tsx` — scan button + ranked table
- `components/Chart.tsx` (M) — plan price lines
- `App.tsx` (M) — view + plan-lines state
- `e2e/phase3.mjs` (repo root `e2e/`) — browser verification

---

### Task 1: decide types, constants, qualifySetups

**Difficulty:** Easy · **Model:** sonnet

**Files:**
- Create: `packages/core/src/decide/types.ts`, `packages/core/src/decide/constants.ts`, `packages/core/src/decide/qualify.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/qualify.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/qualify.test.ts
import { describe, it, expect } from 'vitest';
import { qualifySetups } from '../src/decide/qualify';
import { DEFAULT_GATE } from '../src/decide/constants';
import type { SetupResult } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';

const m = (trades: number, expectancy: number): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0,
});
const r = (kind: string, trades: number, expectancy: number): SetupResult =>
  ({ kinds: [kind], metrics: m(trades, expectancy) }) as SetupResult;

describe('qualifySetups', () => {
  it('keeps boundary values (exactly minTrades / minExpectancy)', () => {
    const out = qualifySetups([r('a', 20, 0.1), r('b', 19, 0.5), r('c', 100, 0.0999)], DEFAULT_GATE);
    expect(out.map((x) => x.kinds[0])).toEqual(['a']);
  });

  it('preserves scan-rank order and caps at topN', () => {
    const results = ['a', 'b', 'c', 'd'].map((k) => r(k, 50, 0.3));
    const out = qualifySetups(results, { minTrades: 20, minExpectancy: 0.1, topN: 2 });
    expect(out.map((x) => x.kinds[0])).toEqual(['a', 'b']);
  });

  it('returns empty when nothing qualifies', () => {
    expect(qualifySetups([r('a', 5, 2)], DEFAULT_GATE)).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test -- qualify`
Expected: FAIL — cannot find module `../src/decide/qualify`

- [x] **Step 3: Implement**

```ts
// packages/core/src/decide/types.ts
import type { SignalDirection, SignalKind } from '../types';
import type { SetupMetrics } from '../backtest/metrics';
import type { BacktestConfig } from '../backtest/scan';

export interface SetupGate {
  minTrades: number;
  minExpectancy: number; // in R units
  topN: number;
}

export interface ConfidenceWeights {
  edge: number;
  sample: number;
  confluence: number;
  bracket: number;
}

export interface ConfidenceBreakdown {
  edge: number;       // each component normalized 0..1
  sample: number;
  confluence: number;
  bracket: number;
  score: number;      // 0..100 weighted blend
}

export interface TradePlan {
  setup: SignalKind[];            // 1–2 kinds, sorted (scan convention)
  direction: SignalDirection;
  signalT: number;                // open time of the triggering candle, ms
  ageCandles: number;             // lastIndex − signalIndex
  entry: number;                  // latest close (live proxy for next-open)
  stop: number;
  target: number;
  rr: number;
  status: 'active' | 'expired';   // expired = recomputed R/R below minRR
  metrics: SetupMetrics;          // the setup's backtest aggregates
  confidence: ConfidenceBreakdown;
}

export interface DecideConfig extends BacktestConfig {
  window: number;                 // freshness window in closed candles
  weights: ConfidenceWeights;
}

export interface SignalsResult {
  coin: string;
  interval: string;
  plans: TradePlan[];
  qualifiedCount: number;
  candleCount: number;
  lastCandleT: number;
}
```

```ts
// packages/core/src/decide/constants.ts
import type { ConfidenceWeights, SetupGate } from './types';

export const EDGE_SCALE = 0.5;     // expectancy (R) at which edge component saturates
export const SAMPLE_HALF = 30;     // trades at which sample component reaches 0.5
export const CONFLUENCE_SAT = 3;   // agreeing setups at which confluence saturates
export const RR_SAT = 3;           // live R/R at which bracket component saturates

export const DEFAULT_GATE: SetupGate = { minTrades: 20, minExpectancy: 0.1, topN: 10 };
export const DEFAULT_WEIGHTS: ConfidenceWeights = { edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 };
export const DEFAULT_WINDOW = 3;
```

```ts
// packages/core/src/decide/qualify.ts
import type { SetupResult } from '../backtest/scan';
import type { SetupGate } from './types';

/** Scan results arrive ranked; the gate filters and caps without reordering. */
export function qualifySetups(results: SetupResult[], gate: SetupGate): SetupResult[] {
  return results
    .filter((r) => r.metrics.trades >= gate.minTrades && r.metrics.expectancy >= gate.minExpectancy)
    .slice(0, gate.topN);
}
```

Add to `packages/core/src/index.ts`:

```ts
export { qualifySetups } from './decide/qualify';
export {
  EDGE_SCALE, SAMPLE_HALF, CONFLUENCE_SAT, RR_SAT,
  DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW,
} from './decide/constants';
export type {
  SetupGate, ConfidenceWeights, ConfidenceBreakdown, TradePlan, DecideConfig, SignalsResult,
} from './decide/types';
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test -- qualify`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/decide packages/core/src/index.ts packages/core/test/qualify.test.ts
git commit -m "feat(core): decide types, scoring constants, setup qualification gate"
```

---

### Task 2: confidence scoring

**Difficulty:** Easy · **Model:** sonnet

**Files:**
- Create: `packages/core/src/decide/confidence.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/confidence.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/confidence.test.ts
import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../src/decide/confidence';
import { DEFAULT_WEIGHTS } from '../src/decide/constants';

describe('scoreConfidence', () => {
  it('computes the spec component formulas', () => {
    // edge: 0.25/0.5 = 0.5; sample: 30/(30+30) = 0.5; confluence: 1/3; bracket: 1.5/3 = 0.5
    const b = scoreConfidence(0.25, 30, 1, 1.5, DEFAULT_WEIGHTS);
    expect(b.edge).toBeCloseTo(0.5, 10);
    expect(b.sample).toBeCloseTo(0.5, 10);
    expect(b.confluence).toBeCloseTo(1 / 3, 10);
    expect(b.bracket).toBeCloseTo(0.5, 10);
    // score = 100 * (.4*.5 + .2*.5 + .2*(1/3) + .2*.5) / 1
    expect(b.score).toBeCloseTo(100 * (0.2 + 0.1 + 0.2 / 3 + 0.1), 8);
  });

  it('clamps saturated components to 1', () => {
    const b = scoreConfidence(2, 600, 9, 10, DEFAULT_WEIGHTS);
    expect(b.edge).toBe(1);
    expect(b.confluence).toBe(1);
    expect(b.bracket).toBe(1);
    expect(b.sample).toBeCloseTo(600 / 630, 10);
  });

  it('is invariant to scaling all weights by a constant', () => {
    const a = scoreConfidence(0.3, 40, 2, 2, DEFAULT_WEIGHTS);
    const w7 = { edge: 0.4 * 7, sample: 0.2 * 7, confluence: 0.2 * 7, bracket: 0.2 * 7 };
    expect(scoreConfidence(0.3, 40, 2, 2, w7).score).toBeCloseTo(a.score, 10);
  });

  it('returns score 0 when all weights are 0 and clamps negative expectancy', () => {
    const b = scoreConfidence(-1, 40, 2, 2, { edge: 0, sample: 0, confluence: 0, bracket: 0 });
    expect(b.score).toBe(0);
    expect(b.edge).toBe(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test -- confidence`
Expected: FAIL — cannot find module `../src/decide/confidence`

- [x] **Step 3: Implement**

```ts
// packages/core/src/decide/confidence.ts
import { CONFLUENCE_SAT, EDGE_SCALE, RR_SAT, SAMPLE_HALF } from './constants';
import type { ConfidenceBreakdown, ConfidenceWeights } from './types';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function scoreConfidence(
  expectancy: number,
  trades: number,
  agreeing: number,
  rr: number,
  w: ConfidenceWeights,
): ConfidenceBreakdown {
  const edge = clamp01(expectancy / EDGE_SCALE);
  const sample = trades / (trades + SAMPLE_HALF);
  const confluence = clamp01(agreeing / CONFLUENCE_SAT);
  const bracket = clamp01(rr / RR_SAT);
  const sum = w.edge + w.sample + w.confluence + w.bracket;
  const score = sum > 0
    ? (100 * (w.edge * edge + w.sample * sample + w.confluence * confluence + w.bracket * bracket)) / sum
    : 0;
  return { edge, sample, confluence, bracket, score };
}
```

Add to `packages/core/src/index.ts`:

```ts
export { scoreConfidence } from './decide/confidence';
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test -- confidence`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/decide/confidence.ts packages/core/src/index.ts packages/core/test/confidence.test.ts
git commit -m "feat(core): composite confidence scoring"
```

---

### Task 3: buildTradePlans

**Difficulty:** Hard (core logic) · **Model:** fable

**Files:**
- Create: `packages/core/src/decide/plans.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/plans.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/core/test/plans.test.ts
import { describe, it, expect } from 'vitest';
import { buildTradePlans } from '../src/decide/plans';
import { DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import { DEFAULT_WEIGHTS } from '../src/decide/constants';
import { DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import type { DetectorContext } from '../src/detectorContext';
import type { Candle, Signal, SignalKind, SignalDirection } from '../src/types';
import type { SetupResult } from '../src/backtest/scan';
import type { SetupMetrics } from '../src/backtest/metrics';
import type { DecideConfig } from '../src/decide/types';

// 10 flat candles closing at 100; entry price = last close = 100
const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
  t: (i + 1) * 1000, o: 100, h: 101, l: 99, c: 100, v: 1,
}));
const last = candles.length - 1;

const ctx = (pivotPrices: number[], atrVal = 2): DetectorContext => ({
  rsi: [], maFast: [], maSlow: [], volumeSma: [],
  atr: candles.map(() => atrVal),
  pivots: [], pivotPricesAt: () => pivotPrices,
  opts: DEFAULT_DETECTOR_OPTIONS,
});

const sig = (kind: SignalKind, index: number, direction: SignalDirection = 'bullish'): Signal =>
  ({ kind, direction, index, t: candles[index].t });

const metrics = (expectancy = 0.3, trades = 40): SetupMetrics => ({
  trades, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy,
  maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0,
});
const setup = (kinds: SignalKind[], e?: number, n?: number): SetupResult =>
  ({ kinds, metrics: metrics(e, n) }) as SetupResult;

const cfg: DecideConfig = { ...DEFAULT_BACKTEST_CONFIG, window: 3, weights: DEFAULT_WEIGHTS };

describe('buildTradePlans', () => {
  // pivots [97, 110], atr 2: stopDist = 100-(97-0.2)=3.2, targetDist = clamp(10)→cap 6, rr = 1.875 ≥ 1.5
  it('builds an active plan from a signal on the last candle', () => {
    const plans = buildTradePlans(candles, ctx([97, 110]), [sig('hammer', last)], [setup(['hammer'])], cfg);
    expect(plans).toHaveLength(1);
    const p = plans[0];
    expect(p.status).toBe('active');
    expect(p.entry).toBe(100);
    expect(p.stop).toBeCloseTo(96.8, 10);
    expect(p.target).toBeCloseTo(106, 10);
    expect(p.rr).toBeCloseTo(1.875, 10);
    expect(p.ageCandles).toBe(0);
    expect(p.confidence.score).toBeGreaterThan(0);
  });

  // pivots [90, 110]: stopDist = clamp(10.2)→cap 6, targetDist = clamp(10)→6, rr = 1 < 1.5 → expired
  it('marks plans below minRR as expired (still returned and scored)', () => {
    const plans = buildTradePlans(candles, ctx([90, 110]), [sig('hammer', last)], [setup(['hammer'])], cfg);
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('expired');
    expect(plans[0].rr).toBeCloseTo(1, 10);
    expect(plans[0].confidence.score).toBeGreaterThan(0);
  });

  it('includes age window-1 and excludes age window', () => {
    const c = ctx([97, 110]);
    const inWin = buildTradePlans(candles, c, [sig('hammer', last - 2)], [setup(['hammer'])], cfg);
    expect(inWin).toHaveLength(1);
    expect(inWin[0].ageCandles).toBe(2);
    const outWin = buildTradePlans(candles, c, [sig('hammer', last - 3)], [setup(['hammer'])], cfg);
    expect(outWin).toEqual([]);
  });

  it('uses only the most recent occurrence per setup', () => {
    const plans = buildTradePlans(
      candles, ctx([97, 110]),
      [sig('hammer', last - 1), sig('hammer', last)], [setup(['hammer'])], cfg,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].ageCandles).toBe(0);
  });

  it('pairs at the live edge via confluence pairing', () => {
    const plans = buildTradePlans(
      candles, ctx([97, 110]),
      [sig('hammer', last - 1), sig('volume-spike-up', last)],
      [setup(['hammer', 'volume-spike-up'])], cfg,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].setup).toEqual(['hammer', 'volume-spike-up']);
    expect(plans[0].ageCandles).toBe(0);
  });

  it('confluence: two active same-direction plans see each other; bearish sees none', () => {
    const signals = [sig('hammer', last), sig('volume-spike-up', last), sig('doji', last, 'bearish')];
    const plans = buildTradePlans(
      candles, ctx([97, 110]), signals,
      [setup(['hammer']), setup(['volume-spike-up']), setup(['doji'])], cfg,
    );
    const bulls = plans.filter((p) => p.direction === 'bullish');
    const bear = plans.find((p) => p.direction === 'bearish');
    expect(bulls).toHaveLength(2);
    for (const b of bulls) expect(b.confidence.confluence).toBeCloseTo(1 / 3, 10);
    // bearish with pivots [97,110]: stopDist = 110.2-100 = 10.2→cap 6, target 100-97=3 → rr .5 → expired
    expect(bear?.status).toBe('expired');
    expect(bear?.confidence.confluence).toBe(0); // active bulls are opposite direction
  });

  it('is deterministic and sorted by score desc', () => {
    const signals = [sig('hammer', last), sig('volume-spike-up', last)];
    const qualified = [setup(['hammer'], 0.5, 100), setup(['volume-spike-up'], 0.15, 25)];
    const a = buildTradePlans(candles, ctx([97, 110]), signals, qualified, cfg);
    const b = buildTradePlans(candles, ctx([97, 110]), signals, qualified, cfg);
    expect(a).toEqual(b);
    expect(a[0].setup).toEqual(['hammer']);
    expect(a[0].confidence.score).toBeGreaterThanOrEqual(a[1].confidence.score);
  });

  it('returns [] when ATR is unusable or candles are empty', () => {
    expect(buildTradePlans(candles, ctx([97, 110], NaN), [sig('hammer', last)], [setup(['hammer'])], cfg)).toEqual([]);
    expect(buildTradePlans([], ctx([97, 110]), [], [setup(['hammer'])], cfg)).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test -- plans`
Expected: FAIL — cannot find module `../src/decide/plans`

- [x] **Step 3: Implement**

```ts
// packages/core/src/decide/plans.ts
import type { Candle, Signal, SignalDirection, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';
import type { SetupMetrics } from '../backtest/metrics';
import type { SetupResult } from '../backtest/scan';
import { pairEntries } from '../backtest/scan';
import { computeBracket } from '../backtest/bracket';
import { scoreConfidence } from './confidence';
import type { DecideConfig, TradePlan } from './types';

interface Draft {
  setup: SignalKind[]; direction: SignalDirection; signalT: number; ageCandles: number;
  stop: number; target: number; rr: number; status: 'active' | 'expired'; metrics: SetupMetrics;
}

export function buildTradePlans(
  candles: Candle[],
  ctx: DetectorContext,
  signals: Signal[],
  qualified: SetupResult[],
  cfg: DecideConfig,
): TradePlan[] {
  if (!candles.length) return [];
  const last = candles.length - 1;
  const atrVal = ctx.atr[last];
  if (!Number.isFinite(atrVal) || atrVal <= 0) return [];
  const entry = candles[last].c;
  const pivotPrices = ctx.pivotPricesAt(last);

  const drafts: Draft[] = [];
  for (const q of qualified) {
    const entries = (q.kinds.length === 1
      ? signals.filter((s) => s.kind === q.kinds[0])
      : pairEntries(signals, q.kinds[0], q.kinds[1], cfg.confluenceWindow)
    ).sort((a, b) => a.index - b.index);
    const recent = entries.filter((s) => last - s.index < cfg.window).pop();
    if (!recent) continue;
    // minRR 0 so the bracket always computes; expiry is decided here, not inside computeBracket
    const bracket = computeBracket(entry, recent.direction, pivotPrices, atrVal, { ...cfg, minRR: 0 });
    if (!bracket) continue;
    drafts.push({
      setup: q.kinds, direction: recent.direction, signalT: recent.t, ageCandles: last - recent.index,
      stop: bracket.stop, target: bracket.target, rr: bracket.rr,
      status: bracket.rr >= cfg.minRR ? 'active' : 'expired', metrics: q.metrics,
    });
  }

  // second pass: confluence needs to know which other setups ended up active
  const plans: TradePlan[] = drafts.map((d) => {
    const agreeing = drafts.filter((o) => o !== d && o.status === 'active' && o.direction === d.direction).length;
    return { ...d, entry, confidence: scoreConfidence(d.metrics.expectancy, d.metrics.trades, agreeing, d.rr, cfg.weights) };
  });
  plans.sort((a, b) =>
    b.confidence.score - a.confidence.score || a.setup.join('+').localeCompare(b.setup.join('+')));
  return plans;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { buildTradePlans } from './decide/plans';
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test -- plans`
Expected: PASS (8 tests)

- [x] **Step 5: Run the full core suite (no regressions)**

Run: `pnpm --filter @cta/core test`
Expected: PASS (Phase 2's 99 + new)

- [x] **Step 6: Commit**

```bash
git add packages/core/src/decide/plans.ts packages/core/src/index.ts packages/core/test/plans.test.ts
git commit -m "feat(core): live trade-plan builder with freshness window and confluence scoring"
```

---

### Task 4: markets 24h volume (metaAndAssetCtxs)

**Difficulty:** Medium · **Model:** opus

**Files:**
- Modify: `apps/server/src/hyperliquid/client.ts`, `apps/server/src/cache/marketStore.ts`, `apps/server/src/services/marketsService.ts`
- Test: `apps/server/test/client.test.ts` (extend), `apps/server/test/markets.test.ts` (extend/update fakes)

- [x] **Step 1: Write the failing tests**

Add to `apps/server/test/client.test.ts` (follow the existing fake-fetch pattern in that file):

```ts
it('metaAndAssetCtxs parses the [meta, ctxs] tuple and numifies dayNtlVlm', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify([
    { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }] },
    [{ dayNtlVlm: '12345.6', funding: '0.0001' }],
  ]))) as unknown as typeof fetch;
  const client = new HyperliquidClient({ baseUrl: 'http://x', fetchImpl });
  const r = await client.metaAndAssetCtxs();
  expect(r.universe[0].name).toBe('BTC');
  expect(r.assetCtxs[0].dayNtlVlm).toBe(12345.6);
});
```

Add to `apps/server/test/markets.test.ts` — update the existing fake client to implement `metaAndAssetCtxs` (the service stops calling `meta()`), and add:

```ts
it('market rows carry dayNtlVlm aligned by index', async () => {
  // fake client returns universe [BTC, ETH] and assetCtxs [{dayNtlVlm: 100}, {dayNtlVlm: 50}]
  const { markets } = await svc.getMarkets();
  expect(markets[0]).toMatchObject({ name: 'BTC', dayNtlVlm: 100 });
  expect(markets[1]).toMatchObject({ name: 'ETH', dayNtlVlm: 50 });
});

it('store normalizes legacy rows without dayNtlVlm to 0', () => {
  // write a MarketRow JSON without the field via store.set cast, then store.get
  expect(store.get()!.markets[0].dayNtlVlm).toBe(0);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cta/server test -- client && pnpm --filter @cta/server test -- markets`
Expected: FAIL — `metaAndAssetCtxs` is not a function

- [x] **Step 3: Implement**

`apps/server/src/hyperliquid/client.ts` — add below `meta()`:

```ts
interface RawAssetCtx { dayNtlVlm: string }

// inside HyperliquidClient:
async metaAndAssetCtxs(): Promise<{ universe: MetaUniverseItem[]; assetCtxs: { dayNtlVlm: number }[] }> {
  const [meta, ctxs] = await this.post<[{ universe: MetaUniverseItem[] }, RawAssetCtx[]]>({ type: 'metaAndAssetCtxs' });
  return { universe: meta.universe, assetCtxs: ctxs.map((c) => ({ dayNtlVlm: +c.dayNtlVlm })) };
}
```

`apps/server/src/cache/marketStore.ts` — extend the row type and normalize legacy cached rows:

```ts
export interface MarketRow {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  dayNtlVlm: number; // 24h notional volume
}
```

In `get()`, replace the parse line:

```ts
return {
  markets: (JSON.parse(row.data) as MarketRow[]).map((m) => ({ dayNtlVlm: 0, ...m })),
  updatedAt: row.updatedAt,
};
```

`apps/server/src/services/marketsService.ts` — replace the `meta()` call:

```ts
await this.deps.rateLimiter.acquire(20);
const { universe, assetCtxs } = await this.deps.client.metaAndAssetCtxs();
const markets: MarketRow[] = universe.map((u, i) => ({
  name: u.name,
  szDecimals: u.szDecimals,
  maxLeverage: u.maxLeverage,
  dayNtlVlm: assetCtxs[i]?.dayNtlVlm ?? 0,
}));
```

- [x] **Step 4: Run the full server suite**

Run: `pnpm --filter @cta/server test`
Expected: PASS (fix any remaining fakes that only implement `meta()`)

- [x] **Step 5: Commit**

```bash
git add apps/server/src/hyperliquid/client.ts apps/server/src/cache/marketStore.ts apps/server/src/services/marketsService.ts apps/server/test/client.test.ts apps/server/test/markets.test.ts
git commit -m "feat(server): 24h notional volume on market rows via metaAndAssetCtxs"
```

---

### Task 5: SignalsService

**Difficulty:** Medium · **Model:** opus

**Files:**
- Create: `apps/server/src/services/signalsService.ts`
- Test: `apps/server/test/signalsService.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/server/test/signalsService.test.ts
import { describe, it, expect } from 'vitest';
import type { Candle } from '@cta/core';
import { SignalsService, type SignalsRequest } from '../src/services/signalsService';
import { BacktestService } from '../src/services/backtestService';
import type { CandleService } from '../src/services/candleService';
import type { BacktestStore } from '../src/cache/backtestStore';

// deterministic wavy fixture: enough candles for ATR/RSI, produces some signals
const fixture = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const base = 100 + 10 * Math.sin(i / 5) + (i % 7 === 0 ? 5 : 0);
    return { t: (i + 1) * 60_000, o: base, h: base + 2, l: base - 2, c: base + (i % 2 ? 1 : -1), v: i % 11 === 0 ? 50 : 10 };
  });

const fakeCandles = (candles: Candle[]) => {
  const calls: { force: boolean }[] = [];
  const svc = {
    getCandles: async (_c: string, _i: string, _l: number, opts: { force?: boolean } = {}) => {
      calls.push({ force: opts.force ?? false });
      return candles;
    },
  } as unknown as CandleService;
  return { svc, calls };
};

const memStore = () => {
  const m = new Map<string, unknown>();
  let sets = 0;
  const store = {
    get: (c: string, i: string, h: string, t: number) => m.get(`${c}|${i}|${h}|${t}`) ?? null,
    set: (c: string, i: string, h: string, t: number, p: unknown) => { sets++; m.set(`${c}|${i}|${h}|${t}`, p); },
  } as unknown as BacktestStore;
  return { store, setCount: () => sets };
};

const req = (over: Partial<SignalsRequest['config']> = {}): SignalsRequest => ({
  coin: 'BTC', interval: '1h', lookback: 300,
  config: {
    confluenceWindow: 3, minRR: 1.5, volumeSpikeK: 2,
    gate: { minTrades: 0, minExpectancy: -100, topN: 5 },
    weights: { edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 },
    window: 3, force: false, ...over,
  },
});

describe('SignalsService', () => {
  it('returns plans + qualifiedCount and basic envelope fields', async () => {
    const { svc: candleSvc } = fakeCandles(fixture(300));
    const { store } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    const r = await signals.run(req());
    expect(r.coin).toBe('BTC');
    expect(r.candleCount).toBe(300);
    expect(r.lastCandleT).toBe(300 * 60_000);
    expect(r.qualifiedCount).toBeLessThanOrEqual(5);
    expect(Array.isArray(r.plans)).toBe(true);
    for (const p of r.plans) expect(['active', 'expired']).toContain(p.status);
  });

  it('reuses the cached scan when only gate/weights/window change', async () => {
    const { svc: candleSvc } = fakeCandles(fixture(300));
    const { store, setCount } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    await signals.run(req());
    await signals.run(req({ weights: { edge: 1, sample: 0, confluence: 0, bracket: 0 }, window: 10, gate: { minTrades: 1, minExpectancy: 0, topN: 2 } }));
    expect(setCount()).toBe(1); // second run hit the scan cache
  });

  it('passes force to the candle fetch', async () => {
    const { svc: candleSvc, calls } = fakeCandles(fixture(300));
    const { store } = memStore();
    const signals = new SignalsService(candleSvc, new BacktestService(candleSvc, store));
    await signals.run(req({ force: true }));
    expect(calls[0].force).toBe(true);
  });

  it('404s on unknown coin and 422s under 50 candles', async () => {
    const { store } = memStore();
    const empty = new SignalsService(fakeCandles([]).svc, new BacktestService(fakeCandles([]).svc, store));
    await expect(empty.run(req())).rejects.toMatchObject({ statusCode: 404 });
    const thinFake = fakeCandles(fixture(30)).svc;
    const thin = new SignalsService(thinFake, new BacktestService(thinFake, store));
    await expect(thin.run(req())).rejects.toMatchObject({ statusCode: 422 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test -- signalsService`
Expected: FAIL — cannot find module `../src/services/signalsService`

- [x] **Step 3: Implement**

```ts
// apps/server/src/services/signalsService.ts
import {
  buildDetectorContext, detectAll, qualifySetups, buildTradePlans,
  DEFAULT_BACKTEST_CONFIG, DEFAULT_DETECTOR_OPTIONS,
} from '@cta/core';
import type { ConfidenceWeights, DecideConfig, DetectorOptions, SetupGate, SignalsResult } from '@cta/core';
import type { CandleService } from './candleService';
import type { BacktestService } from './backtestService';
import { httpError } from '../errors';
import { MIN_BACKTEST_CANDLES } from '../config';

export interface SignalsRequest {
  coin: string;
  interval: string;
  lookback: number;
  config: {
    confluenceWindow: number;
    minRR: number;
    volumeSpikeK: number;
    gate: SetupGate;
    weights: ConfidenceWeights;
    window: number;
    force: boolean;
  };
}

export class SignalsService {
  constructor(private candleService: CandleService, private backtestService: BacktestService) {}

  async run(req: SignalsRequest): Promise<SignalsResult> {
    const { coin, interval, lookback, config } = req;
    // force-fetch first so the backtest's own (non-force) candle read sees a fresh head
    const candles = await this.candleService.getCandles(coin, interval, lookback, { force: config.force });
    if (candles.length === 0) throw httpError(404, `no candles for coin ${coin}`);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      throw httpError(422, `signals need at least ${MIN_BACKTEST_CANDLES} candles; got ${candles.length} for ${coin} ${interval}`);
    }

    // only the scan-relevant subset reaches the backtest cache key — gate/weights/window never invalidate it
    const scan = await this.backtestService.run({
      coin, interval, lookback,
      config: { confluenceWindow: config.confluenceWindow, minRR: config.minRR, volumeSpikeK: config.volumeSpikeK },
    });

    const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: config.volumeSpikeK };
    const ctx = buildDetectorContext(candles, opts);
    const signals = detectAll(candles, ctx);
    const qualified = qualifySetups(scan.results, config.gate);
    const cfg: DecideConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      confluenceWindow: config.confluenceWindow,
      minRR: config.minRR,
      window: config.window,
      weights: config.weights,
    };
    const plans = buildTradePlans(candles, ctx, signals, qualified, cfg);
    return {
      coin, interval, plans,
      qualifiedCount: qualified.length,
      candleCount: candles.length,
      lastCandleT: candles[candles.length - 1].t,
    };
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/server test -- signalsService`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add apps/server/src/services/signalsService.ts apps/server/test/signalsService.test.ts
git commit -m "feat(server): signals service composing cached scan, gate, and trade plans"
```

---

### Task 6: /api/signals route + wiring

**Difficulty:** Medium · **Model:** opus

**Files:**
- Create: `apps/server/src/routes/signals.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/server.ts`
- Test: `apps/server/test/signalsRoute.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/server/test/signalsRoute.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import type { SignalsService } from '../src/services/signalsService';

const fakeSvc = (impl: (req: unknown) => unknown) => ({ run: async (r: unknown) => impl(r) }) as unknown as SignalsService;

describe('POST /api/signals', () => {
  it('applies schema defaults and returns the service payload', async () => {
    let seen: any;
    const app = buildApp({ signalsService: fakeSvc((r) => { seen = r; return { coin: 'BTC', interval: '1h', plans: [], qualifiedCount: 0, candleCount: 100, lastCandleT: 1 }; }) });
    const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(200);
    expect(seen.config.gate).toEqual({ minTrades: 20, minExpectancy: 0.1, topN: 10 });
    expect(seen.config.weights).toEqual({ edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 });
    expect(seen.config.window).toBe(3);
    expect(seen.config.force).toBe(false);
    expect(seen.lookback).toBe(2000);
  });

  it('rejects malformed config with 400', async () => {
    const app = buildApp({ signalsService: fakeSvc(() => ({})) });
    for (const payload of [
      { coin: 'BTC', interval: 'nope' },
      { coin: 'BTC', interval: '1h', config: { gate: { minTrades: -1 } } },
      { coin: 'BTC', interval: '1h', config: { weights: { edge: -0.1 } } },
      { coin: 'BTC', interval: '1h', config: { bogus: 1 } },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/signals', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('propagates service status codes (404/422)', async () => {
    for (const code of [404, 422]) {
      const app = buildApp({ signalsService: fakeSvc(() => { throw Object.assign(new Error('x'), { statusCode: code }); }) });
      const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'Z', interval: '1h' } });
      expect(res.statusCode).toBe(code);
    }
  });

  it('times out via the shared route timeout (504)', async () => {
    const app = buildApp({
      signalsService: fakeSvc(() => new Promise(() => {})),
      routeTimeoutMs: 20,
    });
    const res = await app.inject({ method: 'POST', url: '/api/signals', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(504);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test -- signalsRoute`
Expected: FAIL — 404 (route not registered)

- [x] **Step 3: Implement**

```ts
// apps/server/src/routes/signals.ts
import type { FastifyInstance } from 'fastify';
import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from '@cta/core';
import type { SignalsService, SignalsRequest } from '../services/signalsService';
import { SUPPORTED_INTERVALS, BACKTEST_DEFAULT_LOOKBACK, ROUTE_TIMEOUT_MS } from '../config';
import { withTimeout } from '../util/withTimeout';

const bodySchema = {
  type: 'object',
  required: ['coin', 'interval'],
  additionalProperties: false,
  properties: {
    coin: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: SUPPORTED_INTERVALS as unknown as string[] },
    lookback: { type: 'integer', minimum: 1, maximum: 20000, default: BACKTEST_DEFAULT_LOOKBACK },
    config: {
      type: 'object', default: {}, additionalProperties: false,
      properties: {
        confluenceWindow: { type: 'integer', minimum: 0, maximum: 20, default: 3 },
        minRR: { type: 'number', minimum: 0, default: 1.5 },
        volumeSpikeK: { type: 'number', exclusiveMinimum: 0, default: 2 },
        window: { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_WINDOW },
        force: { type: 'boolean', default: false },
        gate: {
          type: 'object', default: {}, additionalProperties: false,
          properties: {
            minTrades: { type: 'integer', minimum: 0, default: DEFAULT_GATE.minTrades },
            minExpectancy: { type: 'number', default: DEFAULT_GATE.minExpectancy },
            topN: { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_GATE.topN },
          },
        },
        weights: {
          type: 'object', default: {}, additionalProperties: false,
          properties: {
            edge: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.edge },
            sample: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.sample },
            confluence: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.confluence },
            bracket: { type: 'number', minimum: 0, default: DEFAULT_WEIGHTS.bracket },
          },
        },
      },
    },
  },
} as const;

export function registerSignalsRoute(app: FastifyInstance, svc: SignalsService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/signals', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.run(req.body as SignalsRequest), timeoutMs, 'signals'));
}
```

`apps/server/src/app.ts` — add the import, the `AppDeps` field, and the registration (mirror backtest):

```ts
import { registerSignalsRoute } from './routes/signals';
import type { SignalsService } from './services/signalsService';
// in AppDeps:
  signalsService: SignalsService;
// in buildApp, after the backtest line:
  if (deps.signalsService) registerSignalsRoute(app, deps.signalsService, deps.routeTimeoutMs);
```

`apps/server/src/server.ts` — construct and wire (after `backtestService`):

```ts
import { SignalsService } from './services/signalsService';
// after backtestService:
const signalsService = new SignalsService(candleService, backtestService);
// in buildApp call:
const app = buildApp({ marketsService, analysisService, backtestService, signalsService });
```

- [x] **Step 4: Run the full server suite**

Run: `pnpm --filter @cta/server test`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/server/src/routes/signals.ts apps/server/src/app.ts apps/server/src/server.ts apps/server/test/signalsRoute.test.ts
git commit -m "feat(server): POST /api/signals route with gate/weights/window config"
```

---

### Task 7: web API types + client + ApiError

**Difficulty:** Easy · **Model:** sonnet

**Files:**
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/api/client.ts`, `apps/web/test/toolbar.test.tsx` (fixture gains `dayNtlVlm`)
- Test: `apps/web/test/client.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/web/test/client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postSignals, ApiError } from '../src/api/client';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

afterEach(() => vi.unstubAllGlobals());

describe('postSignals', () => {
  it('serializes gate/weights/window (not scanTopN) and parses the response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ coin: 'BTC', plans: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await postSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS);
    expect(r.coin).toBe('BTC');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.config.gate).toEqual(DEFAULT_SIGNALS_SETTINGS.gate);
    expect(body.config.weights).toEqual(DEFAULT_SIGNALS_SETTINGS.weights);
    expect(body.config.window).toBe(DEFAULT_SIGNALS_SETTINGS.window);
    expect(body.config.scanTopN).toBeUndefined();
    expect(body.config.force).toBeUndefined();
  });

  it('throws ApiError carrying the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 422 })));
    await expect(postSignals('XX', '1h', DEFAULT_SIGNALS_SETTINGS)).rejects.toMatchObject(
      { status: 422, constructor: ApiError },
    );
  });
});
```

Note: this test imports `DEFAULT_SIGNALS_SETTINGS` from Task 8's module. **Implement the minimal `signalsSettings.ts` constants here if Task 8 hasn't run yet** — Task 8 then fills in load/save. (If executing in order, write the type + default object in this task and let Task 8 extend the file.)

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- client`
Expected: FAIL — `postSignals` is not exported

- [x] **Step 3: Implement**

`apps/web/src/api/types.ts` — extend the core re-export list and `Market`:

```ts
// add to the `export type { ... } from '@cta/core'` list:
//   TradePlan, ConfidenceBreakdown, ConfidenceWeights, SetupGate, SignalsResult
export interface Market { name: string; szDecimals: number; maxLeverage: number; dayNtlVlm: number; }
```

`apps/web/src/state/signalsSettings.ts` (minimal version; Task 8 completes it):

```ts
import { DEFAULT_GATE, DEFAULT_WEIGHTS, DEFAULT_WINDOW } from '@cta/core';
import type { ConfidenceWeights, SetupGate } from '@cta/core';

export interface SignalsSettings {
  weights: ConfidenceWeights;
  gate: SetupGate;
  window: number;
  scanTopN: number;
}

export const DEFAULT_SIGNALS_SETTINGS: SignalsSettings = {
  weights: DEFAULT_WEIGHTS, gate: DEFAULT_GATE, window: DEFAULT_WINDOW, scanTopN: 30,
};
```

`apps/web/src/api/client.ts` — add:

```ts
import type { SignalsResult } from './types';
import type { SignalsSettings } from '../state/signalsSettings';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function postSignals(
  coin: string,
  interval: Interval,
  s: SignalsSettings,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<SignalsResult> {
  const res = await fetch('/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      coin, interval,
      config: {
        gate: s.gate, weights: s.weights, window: s.window,
        ...(opts.force ? { force: true } : {}),
      },
    }),
  });
  if (!res.ok) throw new ApiError(`signals failed: ${res.status}`, res.status);
  return res.json();
}
```

`apps/web/test/toolbar.test.tsx` — `Market` now requires `dayNtlVlm`; update the MarketPicker fixture objects to include `dayNtlVlm: 0`.

- [x] **Step 4: Run tests + types**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS / clean

- [x] **Step 5: Commit**

```bash
git add apps/web/src/api apps/web/src/state/signalsSettings.ts apps/web/test/client.test.ts apps/web/test/toolbar.test.tsx
git commit -m "feat(web): signals API client with typed errors and volume-aware Market type"
```

---

### Task 8: signals settings persistence

**Difficulty:** Easy · **Model:** sonnet

**Files:**
- Modify: `apps/web/src/state/signalsSettings.ts` (complete the Task 7 stub)
- Test: `apps/web/test/signalsSettings.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/web/test/signalsSettings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

beforeEach(() => localStorage.clear());

describe('signals settings persistence', () => {
  it('round-trips through localStorage', () => {
    const custom = { ...DEFAULT_SIGNALS_SETTINGS, window: 7, scanTopN: 12 };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it('returns defaults when nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SIGNALS_SETTINGS);
  });

  it('survives corrupt JSON and partial objects', () => {
    localStorage.setItem('cta:signals-settings:v1', '{nope');
    expect(loadSettings()).toEqual(DEFAULT_SIGNALS_SETTINGS);
    localStorage.setItem('cta:signals-settings:v1', JSON.stringify({ window: 9 }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SIGNALS_SETTINGS, window: 9 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- signalsSettings`
Expected: FAIL — `loadSettings` is not exported

- [x] **Step 3: Implement** (append to `signalsSettings.ts`)

```ts
import { useCallback, useState } from 'react';

const KEY = 'cta:signals-settings:v1';

export function loadSettings(): SignalsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SIGNALS_SETTINGS;
    const p = JSON.parse(raw) as Partial<SignalsSettings>;
    return {
      weights: { ...DEFAULT_SIGNALS_SETTINGS.weights, ...p.weights },
      gate: { ...DEFAULT_SIGNALS_SETTINGS.gate, ...p.gate },
      window: p.window ?? DEFAULT_SIGNALS_SETTINGS.window,
      scanTopN: p.scanTopN ?? DEFAULT_SIGNALS_SETTINGS.scanTopN,
    };
  } catch {
    return DEFAULT_SIGNALS_SETTINGS;
  }
}

export function saveSettings(s: SignalsSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota: settings just don't persist */ }
}

export function useSignalsSettings(): [SignalsSettings, (s: SignalsSettings) => void] {
  const [settings, set] = useState<SignalsSettings>(loadSettings);
  const update = useCallback((s: SignalsSettings) => { set(s); saveSettings(s); }, []);
  return [settings, update];
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/web test -- signalsSettings`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add apps/web/src/state/signalsSettings.ts apps/web/test/signalsSettings.test.ts
git commit -m "feat(web): signals settings with localStorage persistence"
```

---

### Task 9: useSignals hook

**Difficulty:** Medium · **Model:** opus

**Files:**
- Create: `apps/web/src/state/useSignals.ts`
- Test: `apps/web/test/useSignals.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/web/test/useSignals.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSignals } from '../src/state/useSignals';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

afterEach(() => vi.unstubAllGlobals());

const ok = (coin: string) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans: [], qualifiedCount: 0, candleCount: 100, lastCandleT: 1 }));

describe('useSignals', () => {
  it('fetches when enabled and exposes data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok('BTC')));
    const { result } = renderHook(() => useSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS, true, 0));
    await waitFor(() => expect(result.current.data?.coin).toBe('BTC'));
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch while disabled, fetches on activation', async () => {
    const fetchMock = vi.fn(async () => ok('BTC'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHook(
      ({ enabled }) => useSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS, enabled, 0),
      { initialProps: { enabled: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('aborts the in-flight request when coin changes', async () => {
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => {
      seen.push(init.signal as AbortSignal);
      return new Promise<Response>((resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        setTimeout(() => resolve(ok('?')), 50);
      });
    }));
    const { rerender, result } = renderHook(
      ({ coin }) => useSignals(coin, '1h', DEFAULT_SIGNALS_SETTINGS, true, 0),
      { initialProps: { coin: 'BTC' } },
    );
    await waitFor(() => expect(seen.length).toBe(1));
    rerender({ coin: 'ETH' });
    await waitFor(() => expect(seen[0].aborted).toBe(true));
    await waitFor(() => expect(result.current.error).toBeNull()); // aborted request must not surface as error
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- useSignals`
Expected: FAIL — cannot find module `../src/state/useSignals`

- [x] **Step 3: Implement**

```ts
// apps/web/src/state/useSignals.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { postSignals } from '../api/client';
import type { Interval, SignalsResult } from '../api/types';
import type { SignalsSettings } from './signalsSettings';

export interface UseSignals {
  data: SignalsResult | null;
  loading: boolean;
  error: string | null;
  reload: () => void; // refetch with force: true
}

export function useSignals(
  coin: string,
  interval: Interval,
  settings: SignalsSettings,
  enabled: boolean,
  debounceMs = 300,
): UseSignals {
  const [data, setData] = useState<SignalsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const forceRef = useRef(false);

  const reload = useCallback(() => { forceRef.current = true; setNonce((n) => n + 1); }, []);
  // scanTopN is scanner-only: exclude it so dragging it doesn't refetch the coin's plans
  const key = JSON.stringify({ coin, interval, gate: settings.gate, weights: settings.weights, window: settings.window });

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const force = forceRef.current;
      forceRef.current = false;
      try {
        const r = await postSignals(coin, interval, settings, { force, signal: c.signal });
        if (!c.signal.aborted) setData(r);
      } catch (e) {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, debounceMs);
    return () => { clearTimeout(timer); c.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, enabled]);

  return { data, loading, error, reload };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/web test -- useSignals`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add apps/web/src/state/useSignals.ts apps/web/test/useSignals.test.ts
git commit -m "feat(web): useSignals hook with debounce, abort, and enable gating"
```

---

### Task 10: useMarketScan hook

**Difficulty:** Hard (concurrency + abort) · **Model:** fable

**Files:**
- Create: `apps/web/src/state/useMarketScan.ts`
- Test: `apps/web/test/useMarketScan.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// apps/web/test/useMarketScan.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMarketScan } from '../src/state/useMarketScan';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';
import type { Market } from '../src/api/types';

afterEach(() => vi.unstubAllGlobals());

const mk = (name: string, vol: number): Market => ({ name, szDecimals: 2, maxLeverage: 50, dayNtlVlm: vol });
const markets = [mk('LOW', 1), mk('BTC', 100), mk('ETH', 50), mk('SOL', 25)];
const settings = { ...DEFAULT_SIGNALS_SETTINGS, scanTopN: 3 };

const plan = (score: number, status = 'active') => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status,
  metrics: {}, confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score },
});

const respondWith = (byCoin: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const { coin } = JSON.parse(init.body as string);
    return byCoin[coin]();
  });

const ok = (coin: string, plans: unknown[]) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans, qualifiedCount: 1, candleCount: 100, lastCandleT: 1 }));

describe('useMarketScan', () => {
  it('sweeps top-N by volume, counts progress, ranks by best active plan, omits no-active coins', async () => {
    vi.stubGlobal('fetch', respondWith({
      BTC: () => ok('BTC', [plan(80)]),
      ETH: () => ok('ETH', [plan(40, 'expired')]),   // no active plan → omitted from ranking
      SOL: () => ok('SOL', [plan(90)]),
    }));
    const { result } = renderHook(() => useMarketScan(markets, '1h', settings));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.total).toBe(3);            // LOW (lowest volume) not scanned
    expect(result.current.done).toBe(3);
    const ranked = result.current.rows.filter((r) => r.status === 'ok' && r.plan);
    expect(ranked.map((r) => r.coin).sort()).toEqual(['BTC', 'SOL']);
  });

  it('classifies 422 as thin and other failures as error rows, sweep continues', async () => {
    vi.stubGlobal('fetch', respondWith({
      BTC: () => ok('BTC', [plan(80)]),
      ETH: () => new Response('thin', { status: 422 }),
      SOL: () => new Response('boom', { status: 500 }),
    }));
    const { result } = renderHook(() => useMarketScan(markets, '1h', settings));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.done).toBe(3));
    expect(result.current.rows.find((r) => r.coin === 'ETH')?.status).toBe('thin');
    expect(result.current.rows.find((r) => r.coin === 'SOL')?.status).toBe('error');
    expect(result.current.rows.find((r) => r.coin === 'BTC')?.status).toBe('ok');
  });

  it('aborts and resets when the interval changes mid-scan', async () => {
    let resolveBTC!: () => void;
    vi.stubGlobal('fetch', respondWith({
      BTC: () => new Promise<Response>((res) => { resolveBTC = () => res(ok('BTC', [plan(80)])); }),
      ETH: () => ok('ETH', [plan(40)]),
      SOL: () => ok('SOL', [plan(90)]),
    }));
    const { result, rerender } = renderHook(
      ({ interval }) => useMarketScan(markets, interval, settings),
      { initialProps: { interval: '1h' as const } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.total).toBe(3));
    rerender({ interval: '4h' as const });
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.scanning).toBe(false);
    resolveBTC(); // late resolution must not resurrect state
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.rows).toEqual([]);
  });

  it('caps in-flight requests at 3', async () => {
    let inFlight = 0;
    let peak = 0;
    const many = [...markets, mk('AAA', 10), mk('BBB', 9)];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      const { coin } = JSON.parse(init.body as string);
      return ok(coin, [plan(50)]);
    }));
    const { result } = renderHook(() => useMarketScan(many, '1h', { ...settings, scanTopN: 6 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.current.done).toBe(6);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- useMarketScan`
Expected: FAIL — cannot find module `../src/state/useMarketScan`

- [x] **Step 3: Implement**

```ts
// apps/web/src/state/useMarketScan.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, postSignals } from '../api/client';
import type { Interval, Market, TradePlan } from '../api/types';
import type { SignalsSettings } from './signalsSettings';

const CONCURRENCY = 3;

export interface ScanRow {
  coin: string;
  status: 'ok' | 'thin' | 'error';
  plan?: TradePlan; // best ACTIVE plan (plans arrive sorted by score desc)
  error?: string;
}

export interface UseMarketScan {
  rows: ScanRow[];
  done: number;
  total: number;
  scanning: boolean;
  start: () => void;
}

export function useMarketScan(markets: Market[], interval: Interval, settings: SignalsSettings): UseMarketScan {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  // interval change invalidates the sweep (spec: abort on interval change or re-scan)
  useEffect(() => {
    ctrl.current?.abort();
    setRows([]);
    setDone(0);
    setTotal(0);
    setScanning(false);
  }, [interval]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const start = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const coins = [...markets]
      .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm)
      .slice(0, settings.scanTopN)
      .map((m) => m.name);
    setRows([]);
    setDone(0);
    setTotal(coins.length);
    setScanning(coins.length > 0);

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= coins.length || c.signal.aborted) return;
        const coin = coins[i];
        let row: ScanRow;
        try {
          const r = await postSignals(coin, interval, settings, { signal: c.signal });
          row = { coin, status: 'ok', plan: r.plans.find((p) => p.status === 'active') };
        } catch (e) {
          if (c.signal.aborted) return;
          row = e instanceof ApiError && e.status === 422
            ? { coin, status: 'thin' }
            : { coin, status: 'error', error: e instanceof Error ? e.message : String(e) };
        }
        if (c.signal.aborted) return;
        setRows((rs) => [...rs, row]);
        setDone((d) => d + 1);
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, coins.length) }, worker)).then(() => {
      if (!c.signal.aborted) setScanning(false);
    });
  }, [markets, interval, settings]);

  return { rows, done, total, scanning, start };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/web test -- useMarketScan`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add apps/web/src/state/useMarketScan.ts apps/web/test/useMarketScan.test.ts
git commit -m "feat(web): useMarketScan hook with bounded concurrency and abort-on-interval-change"
```

---

### Task 11: Toolbar Signals tab + App shell

**Difficulty:** Easy · **Model:** sonnet

**Files:**
- Create: `apps/web/src/components/SignalsPanel.tsx` (shell only)
- Modify: `apps/web/src/components/Toolbar.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/test/toolbar.test.tsx` (extend)

- [x] **Step 1: Write the failing test** (add to the `Toolbar tabs` describe block)

```ts
it('offers a Signals tab', () => {
  const onView = vi.fn();
  render(<Toolbar {...base} view="chart" onView={onView} />);
  fireEvent.click(screen.getByRole('button', { name: 'Signals' }));
  expect(onView).toHaveBeenCalledWith('signals');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- toolbar`
Expected: FAIL — no button named "Signals"

- [x] **Step 3: Implement**

`apps/web/src/components/Toolbar.tsx`:

```ts
export type View = 'chart' | 'backtest' | 'signals';
// in the tab row:
<div className="flex gap-1">{tab('chart', 'Chart')}{tab('backtest', 'Backtest')}{tab('signals', 'Signals')}</div>
```

`apps/web/src/components/SignalsPanel.tsx` (shell — Tasks 12–14 flesh it out):

```tsx
import type { Interval, Market, TradePlan } from '../api/types';

export interface SignalsPanelProps {
  coin: string;
  interval: Interval;
  markets: Market[];
  active: boolean;
  onCoin: (c: string) => void;
  onViewPlan: (p: TradePlan) => void;
}

export function SignalsPanel({ coin, interval }: SignalsPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3 text-xs text-slate-400">
      Signals for {coin} {interval} — coming in Tasks 12–14.
    </div>
  );
}
```

`apps/web/src/App.tsx` — import `SignalsPanel`, and add a third hidden-div pane after the backtest one (same preserve-state pattern):

```tsx
<div className={view === 'signals' ? 'flex min-h-0 flex-1' : 'hidden'}>
  <SignalsPanel
    coin={config.coin}
    interval={config.interval}
    markets={markets}
    active={view === 'signals'}
    onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
    onViewPlan={() => {}}
  />
</div>
```

- [x] **Step 4: Run tests + types**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS / clean (note: `SignalsPanel` intentionally ignores most props until Task 12; destructure only what it uses)

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/Toolbar.tsx apps/web/src/components/SignalsPanel.tsx apps/web/src/App.tsx apps/web/test/toolbar.test.tsx
git commit -m "feat(web): Signals tab with state-preserving pane shell"
```

---

### Task 12: SignalsPanel left pane — settings strip + signal cards

**Difficulty:** Medium · **Model:** opus

**Files:**
- Create: `apps/web/src/components/SignalCard.tsx`
- Modify: `apps/web/src/components/SignalsPanel.tsx`
- Test: `apps/web/test/signalsPanel.test.tsx`

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/test/signalsPanel.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignalsPanel } from '../src/components/SignalsPanel';
import type { TradePlan } from '../src/api/types';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 1,
  entry: 100, stop: 96.8, target: 106, rr: 1.875, status: 'active',
  metrics: { trades: 40, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy: 0.3, maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0 },
  confidence: { edge: 0.6, sample: 0.57, confluence: 0.33, bracket: 0.62, score: 56 },
  ...over,
});

const stubSignals = (plans: TradePlan[]) =>
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ coin: 'BTC', interval: '1h', plans, qualifiedCount: 2, candleCount: 500, lastCandleT: 1 }))));

const props = {
  coin: 'BTC', interval: '1h' as const, markets: [], active: true,
  onCoin: vi.fn(), onViewPlan: vi.fn(),
};

describe('SignalsPanel cards', () => {
  it('renders active and dimmed expired cards with confidence breakdown', async () => {
    stubSignals([plan(), plan({ setup: ['doji'], status: 'expired', confidence: { edge: 0.2, sample: 0.4, confluence: 0, bracket: 0.3, score: 24 } })]);
    render(<SignalsPanel {...props} />);
    const cards = await screen.findAllByTestId('sig-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('▲ LONG');
    expect(cards[0].textContent).toContain('56');
    expect(cards[0].textContent).toContain('edge');
    expect(cards[1].className).toContain('opacity-50');
    expect(cards[1].textContent).toContain('expired');
  });

  it('shows the empty state when no plans qualify', async () => {
    stubSignals([]);
    render(<SignalsPanel {...props} />);
    expect(await screen.findByTestId('sig-empty')).toBeTruthy();
  });

  it('fires onViewPlan with the plan when View on chart is clicked', async () => {
    const p = plan();
    stubSignals([p]);
    const onViewPlan = vi.fn();
    render(<SignalsPanel {...props} onViewPlan={onViewPlan} />);
    fireEvent.click(await screen.findByText('View on chart'));
    expect(onViewPlan).toHaveBeenCalledWith(expect.objectContaining({ entry: 100, stop: 96.8, target: 106 }));
  });

  it('persists settings changes and resets to defaults', async () => {
    stubSignals([]);
    render(<SignalsPanel {...props} />);
    await screen.findByTestId('sig-empty');
    fireEvent.change(screen.getByTestId('sig-window'), { target: { value: '7' } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('cta:signals-settings:v1')!).window).toBe(7));
    fireEvent.click(screen.getByTestId('sig-reset'));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('cta:signals-settings:v1')!).window).toBe(3));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- signalsPanel`
Expected: FAIL — no `sig-card` elements

- [x] **Step 3: Implement**

```tsx
// apps/web/src/components/SignalCard.tsx
import type { TradePlan } from '../api/types';

const fmtPrice = (p: number): string => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(3) : p.toPrecision(4));

export function SignalCard({ plan, onView }: { plan: TradePlan; onView: (p: TradePlan) => void }) {
  const long = plan.direction === 'bullish';
  const pct = (x: number) => `${Math.round(x * 100)}`;
  return (
    <div
      data-testid="sig-card"
      className={`rounded border border-slate-800 bg-slate-900 p-2 text-xs ${plan.status === 'expired' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className={long ? 'text-green-400' : 'text-red-400'}>{long ? '▲ LONG' : '▼ SHORT'}</span>
        <span className="text-lg font-semibold text-slate-100">{Math.round(plan.confidence.score)}</span>
        <span className="text-slate-400">{plan.setup.join(' + ')}</span>
        {plan.status === 'expired' && <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">expired</span>}
        <span className="ml-auto text-slate-500">{plan.ageCandles}c ago</span>
      </div>
      <div className="mt-1 text-slate-300">
        entry {fmtPrice(plan.entry)} · stop {fmtPrice(plan.stop)} · target {fmtPrice(plan.target)} · R/R {plan.rr.toFixed(2)}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
        <span>edge {pct(plan.confidence.edge)}</span>
        <span>sample {pct(plan.confidence.sample)}</span>
        <span>confl {pct(plan.confidence.confluence)}</span>
        <span>bracket {pct(plan.confidence.bracket)}</span>
        <button
          onClick={() => onView(plan)}
          className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700"
        >
          View on chart
        </button>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/SignalsPanel.tsx (replace the shell)
import { useSignals } from '../state/useSignals';
import { useSignalsSettings, DEFAULT_SIGNALS_SETTINGS, type SignalsSettings } from '../state/signalsSettings';
import { SignalCard } from './SignalCard';
import type { Interval, Market, TradePlan } from '../api/types';

export interface SignalsPanelProps {
  coin: string;
  interval: Interval;
  markets: Market[];
  active: boolean;
  onCoin: (c: string) => void;
  onViewPlan: (p: TradePlan) => void;
}

function SettingsStrip({ s, onChange }: { s: SignalsSettings; onChange: (s: SignalsSettings) => void }) {
  const slider = (label: string, key: keyof SignalsSettings['weights']) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        data-testid={`sig-w-${key}`} type="range" min={0} max={100}
        value={Math.round(s.weights[key] * 100)}
        onChange={(e) => onChange({ ...s, weights: { ...s.weights, [key]: Number(e.target.value) / 100 } })}
        className="w-20"
      />
    </label>
  );
  const num = (testid: string, label: string, value: number, set: (n: number) => void, step = 1) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        data-testid={testid} type="number" step={step} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) set(n); }}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right text-slate-200"
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-slate-800 bg-slate-900 p-2">
      {slider('edge', 'edge')}
      {slider('sample', 'sample')}
      {slider('confl', 'confluence')}
      {slider('bracket', 'bracket')}
      {num('sig-mintrades', 'min trades', s.gate.minTrades, (n) => onChange({ ...s, gate: { ...s.gate, minTrades: n } }))}
      {num('sig-minexp', 'min exp (R)', s.gate.minExpectancy, (n) => onChange({ ...s, gate: { ...s.gate, minExpectancy: n } }), 0.05)}
      {num('sig-topn', 'top N setups', s.gate.topN, (n) => onChange({ ...s, gate: { ...s.gate, topN: n } }))}
      {num('sig-window', 'window', s.window, (n) => onChange({ ...s, window: n }))}
      {num('sig-scantopn', 'scan coins', s.scanTopN, (n) => onChange({ ...s, scanTopN: n }))}
      <button
        data-testid="sig-reset"
        onClick={() => onChange(DEFAULT_SIGNALS_SETTINGS)}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
      >
        Reset
      </button>
    </div>
  );
}

export function SignalsPanel({ coin, interval, active, onViewPlan }: SignalsPanelProps) {
  const [settings, setSettings] = useSignalsSettings();
  const { data, loading, error, reload } = useSignals(coin, interval, settings, active);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
      <div className="flex w-[30rem] shrink-0 flex-col gap-2 overflow-auto">
        <SettingsStrip s={settings} onChange={setSettings} />
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{coin} · {interval}</span>
          {loading && <span>loading…</span>}
          <button onClick={reload} className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700">↻ force</button>
        </div>
        {error && <div className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>}
        {data && data.plans.length === 0 && !loading && (
          <p data-testid="sig-empty" className="text-xs text-slate-500">
            No signals in the last {settings.window} candles from {data.qualifiedCount} qualifying setup(s).
          </p>
        )}
        {data?.plans.map((p) => (
          <SignalCard key={p.setup.join('+') + p.direction} plan={p} onView={onViewPlan} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto text-xs text-slate-500">
        Scanner — Task 13.
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run tests + types**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS / clean

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/SignalCard.tsx apps/web/src/components/SignalsPanel.tsx apps/web/test/signalsPanel.test.tsx
git commit -m "feat(web): signal cards with confidence breakdown and persisted settings strip"
```

---

### Task 13: Scanner pane

**Difficulty:** Medium · **Model:** opus

**Files:**
- Create: `apps/web/src/components/ScannerPane.tsx`
- Modify: `apps/web/src/components/SignalsPanel.tsx` (replace the Task 13 placeholder)
- Test: `apps/web/test/scannerPane.test.tsx`

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/test/scannerPane.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScannerPane } from '../src/components/ScannerPane';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';
import type { Market } from '../src/api/types';

afterEach(() => vi.unstubAllGlobals());

const mk = (name: string, vol: number): Market => ({ name, szDecimals: 2, maxLeverage: 50, dayNtlVlm: vol });
const markets = [mk('BTC', 100), mk('ETH', 50), mk('SOL', 25)];
const settings = { ...DEFAULT_SIGNALS_SETTINGS, scanTopN: 3 };

const plan = (score: number, status = 'active') => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status,
  metrics: {}, confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score },
});
const ok = (coin: string, plans: unknown[]) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans, qualifiedCount: 1, candleCount: 100, lastCandleT: 1 }));

const stub = () => vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
  const { coin } = JSON.parse(init.body as string);
  if (coin === 'BTC') return ok('BTC', [plan(80)]);
  if (coin === 'ETH') return new Response('thin', { status: 422 });
  return ok('SOL', [plan(90)]);
}));

describe('ScannerPane', () => {
  it('runs a sweep, ranks by confidence, dims thin rows, and reports progress', async () => {
    stub();
    render(<ScannerPane markets={markets} interval="1h" settings={settings} onCoin={vi.fn()} />);
    fireEvent.click(screen.getByTestId('scan-start'));
    await waitFor(() => expect(screen.getByTestId('scan-progress').textContent).toBe('3/3'));
    const rows = screen.getAllByTestId('scan-row');
    expect(rows[0].textContent).toContain('SOL'); // 90 ranks above 80
    expect(rows[1].textContent).toContain('BTC');
    const skipped = screen.getAllByTestId('scan-skip');
    expect(skipped[0].textContent).toContain('ETH');
    expect(skipped[0].textContent).toContain('insufficient data');
    expect(skipped[0].className).toContain('opacity-50');
  });

  it('clicking a ranked row selects the coin', async () => {
    stub();
    const onCoin = vi.fn();
    render(<ScannerPane markets={markets} interval="1h" settings={settings} onCoin={onCoin} />);
    fireEvent.click(screen.getByTestId('scan-start'));
    await waitFor(() => expect(screen.getAllByTestId('scan-row').length).toBe(2));
    fireEvent.click(screen.getAllByTestId('scan-row')[0]);
    expect(onCoin).toHaveBeenCalledWith('SOL');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- scannerPane`
Expected: FAIL — cannot find module `../src/components/ScannerPane`

- [x] **Step 3: Implement**

```tsx
// apps/web/src/components/ScannerPane.tsx
import { useMarketScan } from '../state/useMarketScan';
import type { Interval, Market } from '../api/types';
import type { SignalsSettings } from '../state/signalsSettings';

export function ScannerPane({ markets, interval, settings, onCoin }: {
  markets: Market[];
  interval: Interval;
  settings: SignalsSettings;
  onCoin: (c: string) => void;
}) {
  const { rows, done, total, scanning, start } = useMarketScan(markets, interval, settings);
  const ranked = rows
    .filter((r) => r.status === 'ok' && r.plan)
    .sort((a, b) => b.plan!.confidence.score - a.plan!.confidence.score);
  const skipped = rows.filter((r) => r.status !== 'ok');

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          data-testid="scan-start"
          onClick={start}
          disabled={scanning || markets.length === 0}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Scan market
        </button>
        <span className="text-xs text-slate-400">top {settings.scanTopN} by 24h volume · {interval}</span>
        {total > 0 && <span data-testid="scan-progress" className="text-xs text-slate-400">{done}/{total}</span>}
      </div>
      <table className="w-full border-collapse text-xs text-slate-200">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-2 py-1">#</th><th className="px-2 py-1">coin</th><th className="px-2 py-1">dir</th>
            <th className="px-2 py-1 text-right">conf</th><th className="px-2 py-1">setup</th>
            <th className="px-2 py-1 text-right">R/R</th><th className="px-2 py-1 text-right">age</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
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
          {skipped.map((r) => (
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
      {!scanning && total > 0 && ranked.length === 0 && (
        <p className="text-xs text-slate-500">No active signals among the scanned coins.</p>
      )}
    </div>
  );
}
```

In `SignalsPanel.tsx`, replace the right-pane placeholder with:

```tsx
<ScannerPane markets={markets} interval={interval} settings={settings} onCoin={onCoin} />
```

(restore `markets` and `onCoin` to the destructured props).

- [x] **Step 4: Run tests + types**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS / clean

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/ScannerPane.tsx apps/web/src/components/SignalsPanel.tsx apps/web/test/scannerPane.test.tsx
git commit -m "feat(web): market scanner pane with progress, ranking, and skip rows"
```

---

### Task 14: chart plan lines (view on chart)

**Difficulty:** Medium · **Model:** opus

**Files:**
- Modify: `apps/web/src/components/Chart.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/test/appPlanLines.test.tsx`

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/test/appPlanLines.test.tsx
// Chart is canvas-heavy; assert App-level behavior with Chart mocked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const chartProps: unknown[] = [];
vi.mock('../src/components/Chart', () => ({
  Chart: (props: { plan: unknown }) => { chartProps.push(props.plan); return <div data-testid="chart-mock" />; },
}));
import { App } from '../src/App';

afterEach(() => { vi.unstubAllGlobals(); chartProps.length = 0; });

const plan = {
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 96.8, target: 106, rr: 1.875, status: 'active',
  metrics: { trades: 40, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy: 0.3, maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0 },
  confidence: { edge: 0.6, sample: 0.57, confluence: 0.33, bracket: 0.62, score: 56 },
};

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/api/markets') return new Response(JSON.stringify({ markets: [], updatedAt: 1 }));
  if (url === '/api/signals') return new Response(JSON.stringify({ coin: 'BTC', interval: '1h', plans: [plan], qualifiedCount: 1, candleCount: 500, lastCandleT: 1 }));
  // /api/analysis
  return new Response(JSON.stringify({
    coin: 'BTC', interval: '1h', candles: [], rsi: [], movingAverages: [], volume: { bars: [], sma: [] },
    volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } }, pivots: [], signals: [],
    meta: { lastUpdated: 1, candleCount: 0 },
  }));
}));

describe('view on chart', () => {
  it('passes plan prices to Chart, switches to the Chart tab, and clears on coin change', async () => {
    stubFetch();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Signals' }));
    fireEvent.click(await screen.findByText('View on chart'));
    await waitFor(() =>
      expect(chartProps.at(-1)).toEqual({ entry: 100, stop: 96.8, target: 106 }));
    expect(screen.getByRole('button', { name: 'Chart' }).className).toContain('bg-blue-600');
    // the clearing effect keys on config.coin/interval — interval change covers it
    fireEvent.click(screen.getByText('4h'));
    await waitFor(() => expect(chartProps.at(-1)).toBeNull());
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test -- appPlanLines`
Expected: FAIL — Chart mock receives `undefined` plan / no plan prop exists

- [x] **Step 3: Implement**

`apps/web/src/App.tsx`:

```tsx
import type { TradePlan } from './api/types';
// state:
const [plan, setPlan] = useState<{ entry: number; stop: number; target: number } | null>(null);
useEffect(() => { setPlan(null); }, [config.coin, config.interval]);
const onViewPlan = (p: TradePlan) => {
  setPlan({ entry: p.entry, stop: p.stop, target: p.target });
  setView('chart');
};
// pass plan={plan} to <Chart />, and onViewPlan={onViewPlan} to <SignalsPanel />
```

`apps/web/src/components/Chart.tsx` — add a `plan` prop and a price-line effect:

```tsx
// props: { data, maColors, markers, plan }: { ...; plan: { entry: number; stop: number; target: number } | null }
const planRefs = useRef<IPriceLine[]>([]);

useEffect(() => {
  const c = candle.current;
  if (!c) return;
  for (const pl of planRefs.current) c.removePriceLine(pl);
  planRefs.current = [];
  if (plan) {
    planRefs.current = [
      c.createPriceLine({ price: plan.entry, color: '#e2e8f0', lineStyle: LineStyle.Solid, lineWidth: 1, axisLabelVisible: true, title: 'entry' }),
      c.createPriceLine({ price: plan.stop, color: '#ef4444', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'stop' }),
      c.createPriceLine({ price: plan.target, color: '#22c55e', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'target' }),
    ];
  }
  if (import.meta.env.DEV) {
    (window as unknown as { __planLineCount?: number }).__planLineCount = planRefs.current.length;
  }
}, [plan, data]);
```

(Also add `planRefs.current = []` to the chart-teardown cleanup alongside `pivotLines.current = []`.)

- [x] **Step 4: Run tests + types**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS / clean

- [x] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/Chart.tsx apps/web/test/appPlanLines.test.tsx
git commit -m "feat(web): entry/stop/target price lines on chart via view-on-chart"
```

---

### Task 15: browser e2e

**Difficulty:** Hard (live data) · **Model:** fable

**Files:**
- Create: `e2e/phase3.mjs`

No unit test — this IS the verification step. Prereqs: `pnpm --filter @cta/server start` (:3001) and `pnpm --filter @cta/web dev` (:5173) running; system Chrome at the default macOS path.

- [x] **Step 1: Write the script**

```js
// e2e/phase3.mjs — Signals tab, market sweep, and chart plan lines against live Hyperliquid.
// Prereqs: `pnpm --filter @cta/server start` and `pnpm --filter @cta/web dev` running.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.WEB_URL ?? 'http://localhost:5173';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

mkdirSync('e2e/out', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 950 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => fail(`cannot reach ${URL}`));

const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) fail(`button "${text}" not found`);
};
const setField = async (testid, value) => {
  const sel = `[data-testid="${testid}"]`;
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, String(value));
};

// 1) Signals tab with permissive settings (BTC 1h should yield plans)
await clickByText('Signals');
await setField('sig-mintrades', 1);
await setField('sig-minexp', -5);
await setField('sig-window', 50);
await page.waitForSelector('[data-testid="sig-card"]', { timeout: 120_000 })
  .catch(() => fail('no signal cards rendered'));
const cards = (await page.$$('[data-testid="sig-card"]')).length;
console.log(`PASS: ${cards} signal card(s) for BTC`);
await page.screenshot({ path: 'e2e/out/signals.png' });

// 2) market sweep, top 5
await setField('sig-scantopn', 5);
await page.click('[data-testid="scan-start"]');
await page.waitForFunction(() => {
  const el = document.querySelector('[data-testid="scan-progress"]');
  if (!el) return false;
  const [d, t] = el.textContent.split('/').map(Number);
  return t > 0 && d === t;
}, { timeout: 300_000 }).catch(() => fail('market scan did not finish'));
const ranked = (await page.$$('[data-testid="scan-row"]')).length;
const skipped = (await page.$$('[data-testid="scan-skip"]')).length;
console.log(`PASS: scan finished — ${ranked} ranked, ${skipped} skipped`);
await page.screenshot({ path: 'e2e/out/scanner.png' });

// 3) view on chart → three price lines
await clickByText('View on chart');
await page.waitForFunction(() => window.__planLineCount === 3, { timeout: 15_000 })
  .catch(() => fail('plan lines not rendered on chart'));
console.log('PASS: entry/stop/target lines on chart');
await page.screenshot({ path: 'e2e/out/chart-lines.png' });

await browser.close();
console.log('E2E PASS');
```

- [x] **Step 2: Run it**

Run (both servers up): `node e2e/phase3.mjs`
Expected output ends with `E2E PASS`. If `sig-card` never appears, check `POST /api/signals` in the server log / network tab before touching the script — a cold scan on BTC 1h × 2000 candles takes seconds, not minutes.

- [x] **Step 3: Controller verification (NOT the subagent)**

The controller inspects `e2e/out/signals.png`, `e2e/out/scanner.png`, `e2e/out/chart-lines.png` at pixel level: cards show breakdown chips, scanner table has ranked rows, chart shows three horizontal lines labeled entry/stop/target. **Do not accept subagent prose about screenshot content** (Phase 2 lesson: reports embellished twice).

- [x] **Step 4: Commit**

```bash
git add e2e/phase3.mjs
git commit -m "test(e2e): phase 3 browser verification (signals, sweep, plan lines)"
```

---

## Final verification (after Task 15)

- [x] `pnpm -r test` → all green (159 from Phase 2 + ~30 new)
- [x] `pnpm --filter @cta/web exec tsc --noEmit` → clean
- [x] `node e2e/phase3.mjs` → `E2E PASS`, controller-inspected screenshots
- [x] Tick the spec TODOs in `docs/superpowers/specs/2026-06-10-phase3-decisions-design.md` as their acceptance criteria pass
