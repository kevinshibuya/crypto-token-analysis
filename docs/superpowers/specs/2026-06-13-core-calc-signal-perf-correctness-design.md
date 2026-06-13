# Core Calculation & Signal Performance + Correctness Fixes

Six fixes to `packages/core`: four performance refactors on the hot analysis path (walk-forward
pivots, MA-optimizer context reuse, `detectAll` dedupe, single `detectAll` per `analyzeCoin`) and
two calculation-correctness fixes (RSI flat-window value, `expectancy` definition). The four perf
changes are strictly behavior-preserving; the two correctness changes are intentional, narrow
output changes covered by new tests.

## TODO

- [ ] A fully-flat RSI window (≥ `period` candles of equal closes → zero gains and zero losses) yields RSI `50`, not `100`; any window with real movement is unchanged.
- [ ] `computeMetrics(...).expectancy` equals `avgR` (`sum(r)/n`, `0` when `n=0`) for every trade set, including sets containing break-even (`r === 0`) trades; `winRate`, `profitFactor`, and all other fields are unchanged.
- [ ] `detectAll` invokes each underlying base detector at most once per call (S/R detector once, RSI-divergence once, every two-kind pattern detector once) and returns signal output byte-identical to the previous per-`SignalKind` dispatch.
- [ ] `runScan` accepts an optional precomputed `signals` argument and returns identical results whether `signals` is supplied or computed internally; `analyzeCoin` computes `detectAll` exactly once per call and threads it into both `runScan` and `buildTradePlans`.
- [ ] Walk-forward pivots are produced from a single full-history raw-pivot pass: `pivotPricesAt(i)` returns a result identical to the legacy `pivots(candles.slice(0, i + 1)).map(p => p.price)` for every `i` across a fixture, and is memoized by confirmed-pivot count rather than recomputed per index.
- [ ] When `pivots` is configured with `volumeWindow > lookback`, `pivotPricesAt` falls back to the legacy per-slice computation and still returns correct results (default config, where `volumeWindow` is unset, uses the fast path).
- [ ] `optimizeMaForSeries` computes the MA-invariant detector context (RSI, ATR, volume SMA, pivots, and the `pivotPricesAt` memo) once and reuses it across all grid combos; `optimizeMaForSeries` and `evaluateMaSetups` output (decision, selection, best/baseline metrics, splitIndex) is unchanged versus the per-combo rebuild.
- [ ] `evaluateMaSetups` keeps its current exported signature and behavior.
- [ ] `pnpm -r test` is green; `pnpm --filter @cta/core` behavior is unchanged except the two intentional changes above.

## Context

`packages/core` is the pure compute kernel (`analyzeCoin` is the documented Rust-port seam). The
continuous engine drives it two ways:

1. **Per close scan** — `analyzeCoin` → `runScan` (all single + pair setups) + `buildTradePlans`.
2. **Per mid-tick** — `apps/server/src/engine/provisional.ts` `makePlanAnalyzer` rebuilds a **fresh**
   `DetectorContext` and runs `detectAll` on every gated tick (`tickMinIntervalMs: 1000`,
   `lookback: 2000` ⇒ ~2000 candles, × ~20 coins × 3 timeframes). Nothing is cached between ticks.

The HANDOFF documents `analyzeCoin` p95 ~255–280 ms breaching the 250 ms budget on the 8 GB M1, plus
process-wide freezes under load attributed to swap pressure. The dominant avoidable cost is the
walk-forward pivot machinery (below), which is **O(n²·lookback)** in time and **O(n²)** in
allocations and is re-paid from scratch on every tick.

No timing-based gate is added: per the HANDOFF, the M1 freezes make wall-clock assertions
unreliable. Correctness is locked by an equivalence test instead; the perf win follows from the
complexity/allocation reduction.

## Design

### ① Walk-forward pivots — O(n²·lookback) → ~O(n·lookback) + O(P² log P)

Today `detectorContext.ts` builds `pivotPricesAt(i)` as
`pivots(candles.slice(0, i + 1), opts.pivots).map(p => p.price)`, memoized per `i`. `detectSrSignals`
and `simulate` query it for essentially every candle, so a single pass costs
`Σ O(i·lookback)` time and `Σ O(i)` array-copy allocations ≈ O(n²). The fresh context per tick means
this is redone every tick.

**Refactor `pivots.ts`** into two pure parts (composed by the unchanged public `pivots()`):

- `collectRawPivots(candles, opts) → RawPivot[]` — the expensive swing-scan + per-pivot strength
  sum, in candle-index order. Each `RawPivot` carries `{ price, strength, index, confirmIdx }` where
  `confirmIdx = index + lookback` (the earliest candle at which the pivot is knowable walk-forward).
- `mergeRankSlice(raw, opts, currentClose) → PivotLevel[]` — the greedy price-merge (strength-
  weighted), rank by strength, `slice(0, maxLevels)`, and support/resistance typing. Identical to
  the tail of today's `pivots()`.
- `pivots(candles, opts) = mergeRankSlice(collectRawPivots(candles, opts), opts, lastClose)` — same
  external behavior; still used for `ctx.pivots` (display) and `backtestService`.

**In `buildDetectorContext`**, when `volumeWindow ?? lookback <= lookback` (always true for the
default, which leaves `volumeWindow` unset):

- Compute `allRaw = collectRawPivots(candles, opts.pivots)` **once**. `allRaw` is already sorted by
  `confirmIdx` ascending (since `index` ascends and `lookback` is constant).
- `pivotPricesAt(i)`: binary-search the count `k` of raw pivots with `confirmIdx <= i`; the confirmed
  set is exactly the prefix `allRaw[0..k)`. Return `mergeRankSlice(prefix, opts, candles[i].c)`
  `.map(p => p.price)`. **Memoize by `k`** (not `i`) — many indices share a `k`, so at most `P`
  distinct merges happen, where `P = allRaw.length`.

**Fallback:** when `volumeWindow > lookback`, strength is query-index-dependent in the legacy code,
so `pivotPricesAt` uses the existing per-slice `pivots(candles.slice(0, i + 1))` implementation
(memoized per `i`). This path is never exercised by current config but guarantees correctness.

**Equivalence proof (drives the fixture test).** For the fast path with `vWin <= lookback`:
- The legacy `pivots(slice(0, i+1))` considers candidate indices `[lookback, i+1-lookback)`, i.e.
  exactly `{ p : p + lookback <= i }` = `{ confirmIdx <= i }` — the same prefix.
- Prices are `candles[p].h / .l` — identical.
- Strength sums `candles[j].v` over `[max(0, p-vWin), min(sliceLen-1, p+vWin)]`. At any confirmed
  `i ≥ p+lookback ≥ p+vWin`, `min(i, p+vWin) = p+vWin = min(n-1, p+vWin)` — identical to the
  full-array sum used by `collectRawPivots`.
- `mergeRankSlice` then sorts by price (stable) and merges/ranks identically. Bit-identical output.
- `pivotPricesAt` consumes only `.price`, so typing/`touches` differences are irrelevant.

### ② MA-optimizer shared base context

`evaluateMaSetups` calls `buildDetectorContext` fresh for each of 76 combos, recomputing RSI, ATR,
volume SMA, pivots, and the entire `pivotPricesAt` memo — all MA-invariant. Only `maFast`/`maSlow`
differ per combo.

- Add an internal `evaluateMaSetupsWithBase(candles, base, maFast, maSlow, backtest, splitIndex,
  minTrainTrades)` where `base` holds the shared invariant context fields (`rsi`, `volumeSma`,
  `atr`, `pivots`, `pivotPricesAt`, and base `opts`). It constructs the per-combo context by reusing
  those references and computing only `maFast`/`maSlow` (via `maPoints`) plus an `opts` with the
  combo's `maFast`/`maSlow` specs.
- `optimizeMaForSeries` builds the shared base **once** and calls the internal variant for the
  baseline and every combo. The shared `pivotPricesAt` memo means the walk-forward pivots (and their
  merges) are computed once for the whole optimizer run on a coin.
- The exported `evaluateMaSetups(candles, detector, backtest, combo, splitIndex, minTrainTrades)`
  stays as a thin wrapper (builds a base from `detector`+`combo`, delegates) — signature and
  behavior unchanged.
- Sharing is safe: `detectAll` and `simulate` only read `ctx`; nothing mutates the shared fields.

### ③ `detectAll` dedupe

`detectAll` currently iterates all 26 `SignalKind`s through `only(kind, fn)`, which re-runs each
multi-kind base detector once per kind (S/R 4×, divergence 2×, engulfing/harami/stars/crows/
ma-cross/price-cross/volume 2× each). Replace the loop body with a single pass over the 13 unique
base detector functions (`BASE_DETECTORS`), concatenating their full output, then the existing
`out.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind))`. The per-kind
`DETECTOR_REGISTRY` and `only()` stay (used by `runSetup`/selective callers). Output is identical:
the sort is total over the unique `(index, kind)` pairs every detector emits.

### ④ Single `detectAll` per `analyzeCoin`

`analyzeCoin` calls `detectAll` once directly and again inside `runScan`. Add an optional
`signals?: Signal[]` parameter to `runScan` (`const signals = provided ?? detectAll(candles, ctx)`).
`analyzeCoin` computes `detectAll` once and passes it to both `runScan` and `buildTradePlans`.
Backward-compatible: the existing `backtestService` caller omits the argument and is unaffected.

### ⑤ RSI flat-window value

`rsi.ts` `fromAverages` returns `100` whenever `avgLoss === 0`, including the all-flat case
(`avgGain === 0 && avgLoss === 0`), which mis-reads a flat series as max-overbought and can spuriously
fire `rsi-overbought-exit` on the next down-tick. Change to: `avgLoss === 0 ? (avgGain === 0 ? 50 : 100)
: 100 - 100 / (1 + avgGain / avgLoss)`. Only the zero-gain-and-zero-loss case changes.

### ⑥ `expectancy` = `avgR`

`metrics.ts` computes `expectancy = winRate*avgWin - (1-winRate)*avgLoss`, which diverges from `avgR`
when break-even (`r === 0`) trades exist (reachable via the break-even stop in `simulate`): such
trades inflate the `(1-winRate)` loss weight but are excluded from `avgLoss`, over-penalizing.
`expectancy` drives `byRank` (scan), the qualify gate (`minExpectancy`), and the confidence `edge`.
Set `expectancy: avgR` directly (it already equals the intended mean-R-per-trade and restores the
documented invariant). `winRate` and `profitFactor` are unchanged.

## Testing

- ⑤, ⑥: new red→green unit tests (flat-series RSI = 50; expectancy = avgR with a trade set
  containing an `r === 0` trade).
- ①: an equivalence fixture test asserting `pivotPricesAt(i) === pivots(slice(0, i+1)).map(price)`
  for all `i` (default opts); plus a `volumeWindow > lookback` case that still returns correct
  results via the fallback.
- ③, ④, ②: rely on existing tests staying green (behavior-preserving), augmented with a targeted
  assertion where cheap (e.g. `detectAll` output equality before/after; `runScan` with vs. without
  `signals`).
- Gate: `pnpm -r test` green; `pnpm --filter @cta/web exec tsc --noEmit` unaffected.

## Out of scope

- Phase 5 (execution), the engine/server tick scheduler, dashboard, and notification sinks.
- Volume-profile performance (display-only, not on the signal path).
- Any change to detector thresholds, signal semantics, gate/weight defaults, or trade-plan logic
  beyond the `expectancy` definition.

## Rollback

Each task is an isolated commit and independently revertible. ② benefits from ① (the shared pivot
memo compounds with the cheaper pivots) but does not depend on it — ② shares whatever
`pivotPricesAt` exists, so either can be reverted alone. The two correctness commits (⑤, ⑥) are
trivially independent.
