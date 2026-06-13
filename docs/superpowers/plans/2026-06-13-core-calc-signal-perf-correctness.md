# Core Calculation & Signal Perf + Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the O(n²) walk-forward pivot cost (and three smaller redundancies) on the hot analysis path of `@cta/core`, and fix two calculation-correctness bugs, all without changing any signal/trade semantics beyond the two intentional fixes.

**Architecture:** Six isolated commits. ⑤/⑥ are tiny intentional output changes with new red→green tests. ③/④/①/② are behavior-preserving refactors guarded by characterization/equivalence tests plus the existing 131-test core suite. ① splits `pivots()` into a one-time raw-pivot pass + a cheap per-prefix merge; ② shares the MA-invariant context across the 76-combo MA grid.

**Tech Stack:** TypeScript (ESM), Vitest, pnpm workspaces. All work is in `packages/core`.

**Spec:** `docs/superpowers/specs/2026-06-13-core-calc-signal-perf-correctness-design.md`

## Task → Model

| # | Task | Model | Reviewer |
|---|------|-------|----------|
| 1 | ⑤ RSI flat-window → 50 | sonnet | sonnet |
| 2 | ⑥ `expectancy = avgR` | sonnet | sonnet |
| 3 | ③ `detectAll` runs each base detector once | sonnet | sonnet |
| 4 | ④ single `detectAll` per `analyzeCoin` | sonnet | sonnet |
| 5 | ① walk-forward pivots O(n²)→~O(n) | opus | opus |
| 6 | ② MA optimizer shared base context | opus | opus |

> **Note:** Fable is no longer available; opus is the top of the ladder. Task 5 (deep domain logic, normally a fable task) runs on opus with an opus reviewer.

Per CLAUDE.md: ONE consolidated spec+quality reviewer per task, tier-matched to the implementer model; the controller hand-verifies findings before dispatching fixes.

## Sequencing & dependencies

Run in order 1 → 6. Tasks 1–4 are mutually independent. **Task 6 depends on Task 5** (it calls the module-local `makePivotPricesAt` introduced in Task 5 and the `buildBaseDetectorContext`/`withMa` split). Tasks 1, 2, 3, 5 are independent of each other.

## Branch / working tree

Working tree currently has an uncommitted `M HANDOFF.md` on `main`. Before starting, stash or commit it so it doesn't ride along onto the feature branch unexpectedly (per CLAUDE.md git-checkout lessons: verify `git status --porcelain` and assert the branch after switching). All six commits land on one feature branch off `main`.

## Test commands (verified)

- Single file: `pnpm --filter @cta/core exec vitest run test/<file>.test.ts`
- All core: `pnpm --filter @cta/core test`
- Whole repo gate: `pnpm -r test`  ·  Web types (should be unaffected): `pnpm --filter @cta/web exec tsc --noEmit`

---

### Task 1: ⑤ RSI returns neutral 50 for a fully flat window

**Model:** sonnet

**Files:**
- Modify: `packages/core/src/rsi.ts:7-8`
- Test: `packages/core/test/rsi.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('rsi', …)` in `packages/core/test/rsi.test.ts` (the `c` helper already exists in that file):

```ts
  it('returns 50 (neutral) for a fully flat window — zero gains and zero losses', () => {
    const candles = Array.from({ length: 20 }, (_, i) => c(i + 1, 100));
    const out = rsi(candles, 14);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(p.value).toBe(50);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core exec vitest run test/rsi.test.ts`
Expected: FAIL — the new test gets `100`, expected `50`. The existing "is 100 when every change is a gain" test still PASSES.

- [ ] **Step 3: Write minimal implementation** — change the `fromAverages` helper in `packages/core/src/rsi.ts` (lines 7-8):

```ts
  const fromAverages = (avgGain: number, avgLoss: number): number =>
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cta/core exec vitest run test/rsi.test.ts`
Expected: PASS (all rsi tests, including the all-gains→100 case).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rsi.ts packages/core/test/rsi.test.ts
git commit -m "fix(core): RSI returns neutral 50 for a fully flat window, not 100"
```

---

### Task 2: ⑥ expectancy equals avgR (correct with break-even trades)

**Model:** sonnet

**Files:**
- Modify: `packages/core/src/backtest/metrics.ts:23-43`
- Test: `packages/core/test/metrics.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe('computeMetrics', …)` in `packages/core/test/metrics.test.ts` (the `tr` helper already exists; `tr(0)` makes an `r === 0` trade):

```ts
  it('expectancy equals avgR even when break-even (r=0) trades are present', () => {
    // r = [2, -1, 0]: avgR = 1/3; the old decomposition mis-computed this as 0
    const m = computeMetrics([tr(2), tr(-1, 'bearish'), tr(0)], 0);
    expect(m.avgR).toBeCloseTo(1 / 3, 10);
    expect(m.expectancy).toBeCloseTo(m.avgR, 10);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core exec vitest run test/metrics.test.ts`
Expected: FAIL — old `expectancy` = `(1/3)*2 − (2/3)*1 = 0`, but `avgR = 1/3`. Existing "computes the aggregate set" test (expectancy `0.375`) still PASSES (no r=0 trades there).

- [ ] **Step 3: Write minimal implementation** — in `packages/core/src/backtest/metrics.ts`, remove the now-unused `avgWin`/`avgLoss` locals (lines 25-26) and set `expectancy` to `avgR`. The locals block (lines 23-26) becomes:

```ts
  const avgR = n ? rs.reduce((a, b) => a + b, 0) / n : 0;
  const winRate = n ? wins.length / n : 0;
```

and the `expectancy` field in the returned object (line 43) becomes:

```ts
    expectancy: avgR,
```

(Leave `grossWin`/`grossLoss` — still used by `profitFactor`. Removing `avgWin`/`avgLoss` avoids a `noUnusedLocals` tsc error.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cta/core exec vitest run test/metrics.test.ts`
Expected: PASS (new test + existing aggregate/null/empty cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/backtest/metrics.ts packages/core/test/metrics.test.ts
git commit -m "fix(core): expectancy = avgR so break-even trades don't skew ranking/confidence"
```

---

### Task 3: ③ detectAll runs each base detector once

**Model:** sonnet

**Files:**
- Modify: `packages/core/src/detectors.ts:54-59`
- Test: `packages/core/test/detectors.test.ts`

- [ ] **Step 1: Write the characterization test** — append a new `describe` to `packages/core/test/detectors.test.ts` (imports `DETECTOR_REGISTRY, SIGNAL_KINDS, detectAll` already exist there; `candle`/`ctxWith` come from `./fixtures`, `PivotLevel` is already imported):

```ts
describe('detectAll dedupe', () => {
  it('output equals the per-kind registry dispatch (behavior-preserving)', () => {
    const level: PivotLevel = { price: 100, type: 'support', strength: 1, touches: 1 };
    const candles = [
      candle(1, 102, 103, 101.5, 102, 1),
      candle(2, 102, 102.5, 100.2, 101, 1),
      candle(3, 101.5, 102, 100.9, 101, 9),
      candle(4, 101, 101.2, 100.2, 100.3, 1),
      candle(5, 100.2, 101.6, 100.1, 101.5, 1),
    ];
    const ctx = ctxWith({
      rsi: [NaN, 25, 35, 40, 45],
      maFast: [99, 99.5, 100.5, 100.4, 100.6],
      maSlow: [100, 100, 100, 100, 100],
      volumeSma: [4, 4, 4, 4, 4],
      atr: [2, 2, 2, 2, 2],
      pivots: [level],
    });
    const viaRegistry = SIGNAL_KINDS
      .flatMap((kind) => DETECTOR_REGISTRY[kind](candles, ctx))
      .sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
    expect(detectAll(candles, ctx)).toEqual(viaRegistry);
  });
});
```

- [ ] **Step 2: Run test to verify it passes on current code**

Run: `pnpm --filter @cta/core exec vitest run test/detectors.test.ts`
Expected: PASS. (This pins current behavior; the refactor must keep it green. `viaRegistry` reproduces the current per-kind dispatch.)

- [ ] **Step 3: Refactor detectAll** — in `packages/core/src/detectors.ts`, replace the `detectAll` function (lines 54-59) with a single pass over the 13 unique base detectors. All these functions are already imported at the top of the file for the registry; leave the registry and `only()` untouched:

```ts
const BASE_DETECTORS: Detector[] = [
  detectDoji, detectHammer, detectShootingStar,
  detectEngulfing, detectHarami,
  detectStars, detectSoldiersCrows,
  detectRsiZoneExits, detectRsiDivergence,
  detectMaCross, detectPriceMaCross,
  detectVolumeSpike, detectSrSignals,
];

export function detectAll(candles: Candle[], ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (const detect of BASE_DETECTORS) out.push(...detect(candles, ctx));
  out.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return out;
}
```

Output is identical because each `SignalKind` is emitted by exactly one base detector and the final sort over the globally-unique `(index, kind)` pairs is a total order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cta/core exec vitest run test/detectors.test.ts`
Expected: PASS (dedupe characterization + existing registry/family/detectAll tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/detectors.ts packages/core/test/detectors.test.ts
git commit -m "perf(core): detectAll runs each base detector once instead of per-kind"
```

---

### Task 4: ④ compute detectAll once per analyzeCoin

**Model:** sonnet

**Files:**
- Modify: `packages/core/src/backtest/scan.ts:62-63` (optional `signals` param)
- Modify: `packages/core/src/analyze.ts:41-55`
- Test: `packages/core/test/scan.test.ts`

- [ ] **Step 1: Write the characterization test** — add inside `describe('runScan', …)` in `packages/core/test/scan.test.ts`, and add `detectAll` to the imports. Change the top import line to:

```ts
import { pairEntries, runScan, runSetup, DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import { buildDetectorContext, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { detectAll } from '../src/detectors';
```

Add the test (the `candles`/`ctx` consts are in the `describe('runScan')` scope):

```ts
  it('accepts precomputed signals and returns identical results', () => {
    const internal = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    const provided = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG, detectAll(candles, ctx));
    expect(JSON.stringify(provided)).toBe(JSON.stringify(internal));
  });
```

- [ ] **Step 2: Run test to verify it passes on current code**

Run: `pnpm --filter @cta/core exec vitest run test/scan.test.ts`
Expected: PASS. (Vitest transpiles without type-checking, so the extra arg is ignored today; this characterizes the contract the refactor must honor.)

- [ ] **Step 3: Add the optional param to runScan** — in `packages/core/src/backtest/scan.ts`, change the signature (line 62) and delete the internal `detectAll` line (line 63). `Signal` and `detectAll` are already imported at the top of the file. The function head becomes:

```ts
export function runScan(
  candles: Candle[], ctx: DetectorContext, cfg: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  signals: Signal[] = detectAll(candles, ctx),
): ScanResult {
  const present = SIGNAL_KINDS.filter((k) => signals.some((s) => s.kind === k));
```

(The rest of the body is unchanged. The default param means the existing 3-arg caller in `backtestService.ts` is unaffected.)

- [ ] **Step 4: Thread signals through analyzeCoin** — in `packages/core/src/analyze.ts`, compute `detectAll` once and pass it to both `runScan` and `buildTradePlans`. `detectAll` is already imported (line 4). Replace the `analyzeCoin` body (lines 42-54) with:

```ts
  const ctx = buildDetectorContext(candles, cfg.detector);
  const signals = detectAll(candles, ctx);
  const scan = runScan(candles, ctx, cfg.backtest, signals);
  const qualified = qualifySetups(scan.results, cfg.gate);
  const plans = buildTradePlans(candles, ctx, signals, qualified, {
    ...cfg.backtest, window: cfg.window, weights: cfg.weights,
  });
  return {
    scanResults: scan.results,
    plans,
    candleCount: scan.candleCount,
    lastCandleT: scan.lastCandleT,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @cta/core exec vitest run test/scan.test.ts test/analyze.test.ts`
Expected: PASS (optional-signals characterization + existing analyzeCoin behavior).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/backtest/scan.ts packages/core/src/analyze.ts packages/core/test/scan.test.ts
git commit -m "perf(core): compute detectAll once per analyzeCoin, thread into runScan"
```

---

### Task 5: ① walk-forward pivots — one raw-pivot pass + confirmed-prefix merge

**Model:** opus (would be fable, but fable is unavailable; opus is the top tier)

**Files:**
- Modify: `packages/core/src/pivots.ts` (split into `collectRawPivots` + `mergeRankSlice`, keep `pivots()`)
- Modify: `packages/core/src/detectorContext.ts:55-78` (`makePivotPricesAt` fast path + fallback)
- Test: `packages/core/test/detectorContext.test.ts`

**Invariants to preserve (existing tests assert these):** `pivotPricesAt(i)` clamps `i` to `[0, length-1]`; repeated calls with the same `i` return the **same array reference**; `pivotPricesAt(hugeI)` deep-equals `ctx.pivots.map(p => p.price)`; pivots not yet confirmed at `i` are excluded (`detectorContext.test.ts:38-56`). `pivots()` output (prices, strength, type, touches, maxLevels) must stay byte-identical (`pivots.test.ts`).

- [ ] **Step 1: Write the equivalence + fallback tests** — append to `packages/core/test/detectorContext.test.ts`. Add `pivots` to the imports at the top:

```ts
import { pivots } from '../src/pivots';
```

Then append:

```ts
describe('pivotPricesAt fast-path equivalence', () => {
  const series: Candle[] = Array.from({ length: 80 }, (_, i) => {
    const base = 100 + Math.sin(i / 4) * 8 + Math.cos(i / 9) * 4;
    const h = base + 1 + (i % 5 === 0 ? 3 : 0);
    const l = base - 1 - (i % 7 === 0 ? 3 : 0);
    return { t: i * 60000, o: base, h, l, c: base, v: 1 + (i % 6) };
  });
  const opts = {
    ...DEFAULT_DETECTOR_OPTIONS,
    pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003 },
  };

  it('matches the legacy per-slice computation for every index', () => {
    const ctx = buildDetectorContext(series, opts);
    for (let i = 0; i < series.length; i++) {
      const legacy = pivots(series.slice(0, i + 1), opts.pivots).map((p) => p.price);
      expect(ctx.pivotPricesAt(i)).toEqual(legacy);
    }
  });

  it('falls back to the legacy path (still correct) when volumeWindow > lookback', () => {
    const opts2 = {
      ...DEFAULT_DETECTOR_OPTIONS,
      pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003, volumeWindow: 12 },
    };
    const ctx = buildDetectorContext(series, opts2);
    for (let i = 0; i < series.length; i += 3) {
      const legacy = pivots(series.slice(0, i + 1), opts2.pivots).map((p) => p.price);
      expect(ctx.pivotPricesAt(i)).toEqual(legacy);
    }
  });
});
```

- [ ] **Step 2: Run the new tests on current code**

Run: `pnpm --filter @cta/core exec vitest run test/detectorContext.test.ts`
Expected: PASS (today's `pivotPricesAt` literally is `pivots(slice)`, so equivalence holds; this characterizes what the refactor must keep).

- [ ] **Step 3: Refactor `pivots.ts`** — split the swing-scan and the merge, keeping the public `pivots()` as their composition. Replace the entire body of `packages/core/src/pivots.ts` (keep the existing imports and `PivotOptions` interface) with:

```ts
import type { Candle, PivotLevel, PivotType } from './types';

export interface PivotOptions {
  lookback: number; // bars on each side
  maxLevels: number;
  mergeTolerance: number; // fraction of price, e.g. 0.003
  volumeWindow?: number; // bars each side summed for strength (default = lookback)
}

/** A raw, unmerged pivot. `confirmIdx = index + lookback` is the earliest candle at which the
 *  pivot is knowable walk-forward (lookback bars must exist after it). */
export interface RawPivot {
  price: number;
  strength: number;
  index: number;
  confirmIdx: number;
}

/** Single full-history swing-scan. Output is in candle-index order, hence also confirmIdx order. */
export function collectRawPivots(candles: Candle[], opts: PivotOptions): RawPivot[] {
  const { lookback } = opts;
  if (lookback <= 0) throw new Error('pivots: lookback must be > 0');
  const vWin = opts.volumeWindow ?? lookback;
  const raw: RawPivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    let strength = 0;
    for (let j = Math.max(0, i - vWin); j <= Math.min(candles.length - 1, i + vWin); j++) {
      strength += candles[j].v;
    }
    const confirmIdx = i + lookback;
    if (isHigh) raw.push({ price: candles[i].h, strength, index: i, confirmIdx });
    if (isLow) raw.push({ price: candles[i].l, strength, index: i, confirmIdx });
  }
  return raw;
}

/** Greedy price-merge (strength-weighted) → rank by strength → top maxLevels. Does not mutate `raw`. */
export function mergeRankSlice(raw: RawPivot[], opts: PivotOptions, current: number): PivotLevel[] {
  const { lookback, maxLevels, mergeTolerance } = opts;
  const sorted = [...raw].sort((a, b) => a.price - b.price);
  const merged: { price: number; strength: number; indices: number[] }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(r.price - last.price) / last.price <= mergeTolerance) {
      const total = last.strength + r.strength;
      last.price = (last.price * last.strength + r.price * r.strength) / total;
      last.strength = total;
      last.indices.push(r.index);
    } else {
      merged.push({ price: r.price, strength: r.strength, indices: [r.index] });
    }
  }

  const visitGap = 2 * lookback;
  const countVisits = (indices: number[]): number => {
    const s = [...indices].sort((a, b) => a - b);
    let visits = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] - s[i - 1] > visitGap) visits++;
    }
    return visits;
  };

  const levels: PivotLevel[] = merged.map((m) => ({
    price: m.price,
    type: (m.price >= current ? 'resistance' : 'support') as PivotType,
    strength: m.strength,
    touches: countVisits(m.indices),
  }));
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}

export function pivots(candles: Candle[], opts: PivotOptions): PivotLevel[] {
  const current = candles.length ? candles[candles.length - 1].c : 0;
  return mergeRankSlice(collectRawPivots(candles, opts), opts, current);
}
```

- [ ] **Step 4: Verify `pivots()` behavior is unchanged**

Run: `pnpm --filter @cta/core exec vitest run test/pivots.test.ts`
Expected: PASS (all merge/touches/strength/maxLevels/tied-plateau cases).

- [ ] **Step 5: Rewrite `pivotPricesAt` in `detectorContext.ts`** — replace the `buildDetectorContext` function (lines 55-78) and add a module-local `makePivotPricesAt`. Update the `pivots` import (line 7) to also pull in the new helpers:

```ts
import { pivots, collectRawPivots, mergeRankSlice, type PivotOptions } from './pivots';
```

Then:

```ts
/** Walk-forward pivot prices at candle i. Fast path (vWin <= lookback): collect raw pivots once,
 *  then merge only the prefix confirmed by i, memoized by confirmed-pivot count. Fallback
 *  (vWin > lookback): legacy per-slice recomputation, memoized per index. */
function makePivotPricesAt(candles: Candle[], pivotOpts: PivotOptions): (i: number) => number[] {
  const lookback = pivotOpts.lookback;
  const vWin = pivotOpts.volumeWindow ?? lookback;
  const clamp = (i: number): number => Math.max(0, Math.min(i, candles.length - 1));

  if (vWin > lookback) {
    const memo = new Map<number, number[]>();
    return (i: number): number[] => {
      const key = clamp(i);
      const hit = memo.get(key);
      if (hit) return hit;
      const prices = pivots(candles.slice(0, key + 1), pivotOpts).map((p) => p.price);
      memo.set(key, prices);
      return prices;
    };
  }

  const raw = collectRawPivots(candles, pivotOpts); // confirmIdx-ascending
  const byCount = new Map<number, number[]>();
  const confirmedCount = (i: number): number => {
    let lo = 0;
    let hi = raw.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (raw[mid].confirmIdx <= i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (i: number): number[] => {
    const key = clamp(i);
    const k = confirmedCount(key);
    const hit = byCount.get(k);
    if (hit) return hit;
    const prices = mergeRankSlice(raw.slice(0, k), pivotOpts, candles[key].c).map((p) => p.price);
    byCount.set(k, prices);
    return prices;
  };
}

export function buildDetectorContext(
  candles: Candle[],
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): DetectorContext {
  return {
    rsi: alignToCandles(candles, rsi(candles, opts.rsiPeriod)),
    maFast: alignToCandles(candles, maPoints(candles, opts.maFast)),
    maSlow: alignToCandles(candles, maPoints(candles, opts.maSlow)),
    volumeSma: alignToCandles(candles, volume(candles, opts.volumeSmaPeriod).sma),
    atr: alignToCandles(candles, atr(candles, opts.atrPeriod)),
    pivots: pivots(candles, opts.pivots),
    pivotPricesAt: makePivotPricesAt(candles, opts.pivots),
    opts,
  };
}
```

Note on memo-by-count: prices depend only on the confirmed raw prefix (`k`), not on `current` (which affects only `type`, discarded here), so caching by `k` is exact. Repeated same-`i` calls hit the same `k` → same array reference (preserves the existing reference-stability test).

- [ ] **Step 6: Run the detectorContext + full core suite**

Run: `pnpm --filter @cta/core exec vitest run test/detectorContext.test.ts && pnpm --filter @cta/core test`
Expected: PASS — equivalence (all 80 indices), fallback, the existing confirmation/memo/clamp tests, and every other core test.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pivots.ts packages/core/src/detectorContext.ts packages/core/test/detectorContext.test.ts
git commit -m "perf(core): walk-forward pivots via one raw-pivot pass + confirmed-prefix merge (O(n^2)->~O(n))"
```

---

### Task 6: ② MA optimizer reuses the MA-invariant context across the grid

**Model:** opus

**Files:**
- Modify: `packages/core/src/detectorContext.ts` (add `buildBaseDetectorContext` + `withMa`; route `buildDetectorContext` through them)
- Modify: `packages/core/src/optimize/maGrid.ts` (build base once; internal `evaluateMaSetupsWithCtx`)
- Test: `packages/core/test/maGrid.test.ts`

**Depends on Task 5** (uses `makePivotPricesAt`). Sharing is safe: `detectAll`/`simulate` only read the context; nothing mutates the shared arrays or the `pivotPricesAt` closure/memo.

- [ ] **Step 1: Write the baseline cross-check test** — add `evaluateMaSetups` to the maGrid import in `packages/core/test/maGrid.test.ts` and add a test asserting the shared-base baseline equals an independent per-combo evaluation. Inside the existing `describe('optimizeMaForSeries', …)` (which already defines `candles`, `input`), add:

```ts
  it('baseline from the shared-base optimizer matches an independent evaluateMaSetups', () => {
    const gates = DEFAULT_MA_GRID_GATES;
    const splitIndex = Math.floor(candles.length * (1 - gates.validationFraction));
    const baseCombo = { fast: input.detector.maFast, slow: input.detector.maSlow };
    const direct = evaluateMaSetups(
      candles, input.detector, input.backtest, baseCombo, splitIndex, gates.minTrainTrades,
    );
    expect(optimizeMaForSeries(candles, input).baseline).toEqual(direct);
  });
```

Ensure the import line includes `evaluateMaSetups` and `DEFAULT_MA_GRID_GATES`:

```ts
import {
  buildMaGrid, decideChallenger, optimizeMaForSeries, evaluateMaSetups, DEFAULT_MA_GRID_GATES,
} from '../src/optimize/maGrid';
```

- [ ] **Step 2: Run it on current code**

Run: `pnpm --filter @cta/core exec vitest run test/maGrid.test.ts`
Expected: PASS today (both paths build equivalent contexts). It must stay green after the refactor — that's the equivalence lock.

- [ ] **Step 3: Add `buildBaseDetectorContext` + `withMa` to `detectorContext.ts`** — add these exports and route `buildDetectorContext` through them (keeps `buildDetectorContext` output identical). Place after `makePivotPricesAt`:

```ts
/** The MA-invariant slice of a DetectorContext — reusable across MA-grid combos. */
export interface BaseDetectorContext {
  rsi: number[];
  volumeSma: number[];
  atr: number[];
  pivots: PivotLevel[];
  pivotPricesAt: (i: number) => number[];
}

export function buildBaseDetectorContext(candles: Candle[], opts: DetectorOptions): BaseDetectorContext {
  return {
    rsi: alignToCandles(candles, rsi(candles, opts.rsiPeriod)),
    volumeSma: alignToCandles(candles, volume(candles, opts.volumeSmaPeriod).sma),
    atr: alignToCandles(candles, atr(candles, opts.atrPeriod)),
    pivots: pivots(candles, opts.pivots),
    pivotPricesAt: makePivotPricesAt(candles, opts.pivots),
  };
}

/** Layer the MA arrays for `opts` onto a shared base, producing a full DetectorContext. */
export function withMa(base: BaseDetectorContext, candles: Candle[], opts: DetectorOptions): DetectorContext {
  return {
    rsi: base.rsi,
    maFast: alignToCandles(candles, maPoints(candles, opts.maFast)),
    maSlow: alignToCandles(candles, maPoints(candles, opts.maSlow)),
    volumeSma: base.volumeSma,
    atr: base.atr,
    pivots: base.pivots,
    pivotPricesAt: base.pivotPricesAt,
    opts,
  };
}
```

Then replace `buildDetectorContext`'s body (from Task 5) with the composition:

```ts
export function buildDetectorContext(
  candles: Candle[],
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): DetectorContext {
  return withMa(buildBaseDetectorContext(candles, opts), candles, opts);
}
```

`PivotLevel` is already imported in `detectorContext.ts` (line 1).

- [ ] **Step 4: Verify detectorContext is unchanged**

Run: `pnpm --filter @cta/core exec vitest run test/detectorContext.test.ts`
Expected: PASS (the composition produces the same arrays as before).

- [ ] **Step 5: Refactor `maGrid.ts` to share the base** — extract the post-context body of `evaluateMaSetups` into an internal `evaluateMaSetupsWithCtx`, keep `evaluateMaSetups`'s exported signature as a thin wrapper, and build the base once in `optimizeMaForSeries`. Update the import (line 3) and the two functions:

```ts
import { buildDetectorContext, buildBaseDetectorContext, withMa } from '../detectorContext';
```

Replace `evaluateMaSetups` (lines 83-121) with:

```ts
function evaluateMaSetupsWithCtx(
  candles: Candle[], ctx: DetectorContext, backtest: BacktestConfig,
  splitIndex: number, minTrainTrades: number,
): SplitEvaluation | null {
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

export function evaluateMaSetups(
  candles: Candle[], detector: DetectorOptions, backtest: BacktestConfig,
  combo: MaCombo, splitIndex: number, minTrainTrades: number,
): SplitEvaluation | null {
  const opts: DetectorOptions = { ...detector, maFast: combo.fast, maSlow: combo.slow };
  const ctx = buildDetectorContext(candles, opts);
  return evaluateMaSetupsWithCtx(candles, ctx, backtest, splitIndex, minTrainTrades);
}
```

This needs a `DetectorContext` type import — add it to the existing `detectorContext` type import (line 2):

```ts
import type { DetectorOptions, MaSpec, DetectorContext } from '../detectorContext';
```

Then replace the two `evaluateMaSetups(...)` calls in `optimizeMaForSeries` (lines 127 and 134) by building the base once. Replace the body of `optimizeMaForSeries` (lines 124-152) with:

```ts
export function optimizeMaForSeries(candles: Candle[], input: MaGridInput): MaOptimizationResult {
  const gates = input.gates ?? DEFAULT_MA_GRID_GATES;
  const splitIndex = Math.floor(candles.length * (1 - gates.validationFraction));
  const baseCombo: MaCombo = { fast: input.detector.maFast, slow: input.detector.maSlow };

  const base = buildBaseDetectorContext(candles, input.detector);
  const ctxFor = (combo: MaCombo): DetectorContext =>
    withMa(base, candles, { ...input.detector, maFast: combo.fast, maSlow: combo.slow });

  const baseline = evaluateMaSetupsWithCtx(
    candles, ctxFor(baseCombo), input.backtest, splitIndex, gates.minTrainTrades,
  );

  let best: (SplitEvaluation & { combo: MaCombo }) | null = null;
  let bestQualified = false;
  for (const combo of buildMaGrid()) {
    if (combo.fast.type === baseCombo.fast.type && combo.fast.period === baseCombo.fast.period
      && combo.slow.type === baseCombo.slow.type && combo.slow.period === baseCombo.slow.period) continue;
    const ev = evaluateMaSetupsWithCtx(candles, ctxFor(combo), input.backtest, splitIndex, gates.minTrainTrades);
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

- [ ] **Step 6: Run maGrid + full core suite**

Run: `pnpm --filter @cta/core exec vitest run test/maGrid.test.ts && pnpm --filter @cta/core test`
Expected: PASS — baseline cross-check, determinism, challenger/flat cases, and the whole core suite.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/detectorContext.ts packages/core/src/optimize/maGrid.ts packages/core/test/maGrid.test.ts
git commit -m "perf(core): MA optimizer reuses MA-invariant context across grid combos"
```

---

## Final verification (after Task 6)

- [ ] `pnpm -r test` — whole workspace green (core + server + web).
- [ ] `pnpm --filter @cta/web exec tsc --noEmit` — web types unaffected.
- [ ] `git log --oneline -6` — six commits present in order.

No wall-clock perf gate (per spec: M1 freezes make timing assertions unreliable). The perf win is structural — verified by the equivalence test (① no longer re-scans the prefix per index) and code review.

## Self-review (against the spec)

- **Spec coverage:** ⑤→T1, ⑥→T2, ③→T3, ④→T4, ① (incl. fallback + memo-by-count)→T5, ② (incl. `evaluateMaSetups` signature preserved)→T6. All nine spec TODOs map to a task. ✓
- **Placeholders:** none — every code step shows complete code and exact commands. ✓
- **Type consistency:** `RawPivot`/`collectRawPivots`/`mergeRankSlice` (T5) are consumed by `makePivotPricesAt` (T5) and `buildBaseDetectorContext` (T6); `BaseDetectorContext`/`withMa` (T6) consumed by `optimizeMaForSeries` (T6); `evaluateMaSetupsWithCtx` signature matches both call sites. `runScan`'s optional `signals` (T4) matches `analyzeCoin`'s call. ✓
