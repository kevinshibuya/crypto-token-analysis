# Phase 3 — Signal Generation & Confidence Scoring

Turn backtest-validated setups into live trade plans (entry, stop, target, R/R) with a composite confidence score — per coin and across the market via a client-orchestrated top-N-by-volume sweep.

## TODO

### Core — decide module

- [ ] `qualifySetups(results, gate)` keeps only setups with `trades >= minTrades` and `expectancy >= minExpectancy` (boundary values 20 trades / 0.10R qualify with defaults), preserves scan-rank order, and caps at `topN`.
- [ ] `buildTradePlans` emits at most one plan per qualified setup — the most recent triggering occurrence within the freshness window (default 3 closed candles); pair setups reuse the existing confluence pairing at the live edge; setups with no occurrence in the window emit nothing.
- [ ] Each plan's bracket is computed at the latest close via the Phase 2 `computeBracket` with walk-forward pivots and ATR at the latest bar; plans whose recomputed R/R clears `minRR` are `active`, others `expired`.
- [ ] Confidence breakdown matches the spec formulas: edge `clamp(expectancy/0.5, 0, 1)`, sample `trades/(trades+30)`, confluence `min(agreeing/3, 1)` where `agreeing` counts OTHER qualified setups with an active same-direction plan, bracket `clamp(rr/3, 0, 1)`; `score = 100 × Σ(wᵢcᵢ)/Σwᵢ`.
- [ ] Identical candles + config produce identical plans and scores (determinism), and scaling all four weights by the same constant leaves scores unchanged (normalization).

### Server

- [ ] `POST /api/signals` returns `{ coin, interval, plans, qualifiedCount, candleCount, lastCandleT }` for a coin/interval, honoring `gate`, `weights`, and `window` overrides in `config`.
- [ ] Signals validation mirrors backtest: unknown coin → 404, fewer than 50 candles → 422, malformed config → 400; the route-level timeout applies.
- [ ] Changing `gate`/`weights`/`window` does not invalidate the cached backtest scan: a second `/api/signals` request differing only in those fields is served from the existing scan cache (no recomputation).
- [ ] `/api/signals` with `force: true` refetches candles inside the staleness window (same semantics as `/api/analysis`).
- [ ] The markets response includes `dayNtlVlm` (24h notional volume) per coin, sourced from `metaAndAssetCtxs`, cached with the existing 1h TTL.

### Web

- [ ] Toolbar offers Chart | Backtest | Signals tabs; switching preserves the selected coin and interval.
- [ ] The Signals pane auto-loads plans for the selected coin/interval; each card shows direction, confidence score with the 4-component breakdown, setup kinds, entry/stop/target, R/R, age in candles, and an active/expired badge; expired cards render dimmed.
- [ ] The settings strip exposes four weight sliders, gate inputs (min trades, min expectancy, top-N), freshness window, and scanner top-N; values persist to localStorage and a reset button restores defaults.
- [ ] `useSignals` exposes loading/error/data state and aborts in-flight requests on coin/interval/settings change.
- [ ] "Scan market" sweeps the top-N coins by `dayNtlVlm` at the selected interval with at most 3 requests in flight; rows fill incrementally with a `done/total` progress counter and re-sort by best-active-plan confidence; coins with no active plan are omitted from the ranking (still counted in progress); the sweep aborts on interval change or re-scan.
- [ ] A failed coin in the sweep shows an error chip on its row and the sweep continues; coins with thin history (422) render dimmed as "insufficient data" at the bottom.
- [ ] Clicking a scanner row selects that coin (global state) and the signals pane loads it.
- [ ] "View on chart" switches to the Chart tab and draws entry (solid), stop (red dashed), and target (green dashed) price lines at the plan's prices; lines are replaced when another plan is viewed and cleared on coin/interval change.
- [ ] Browser e2e (`e2e/phase3.mjs`): against live Hyperliquid, the Signals tab renders plans (or an explicit no-qualifier state), a top-5 mini-sweep populates the scanner table, and view-on-chart lines are visible in a screenshot.

## Context

Phase 1 (merged `f0e1509`) provides candles, indicators, volume S/R, and the chart UI. Phase 2
(merged `4d58928`) provides signal detection (25 kinds across 5 families) and a backtesting engine
whose scan ranks every single + same-direction pair by expectancy, cached in SQLite by
coin/interval/config-hash/last-candle-time. Phase 3 closes the loop promised in the project goal:
**entries, stop-losses, and exits with risk/reward and a confidence score** — using the backtest to
decide *which* signals deserve attention and the live edge of the chart to decide *what to do now*.

Decisions made interactively during brainstorming (2026-06-10):

| Decision | Choice |
|---|---|
| Deliverable | **Both** per-coin active signals and a market-wide scanner |
| Setup gate | Threshold + top-N cap; defaults ≥20 trades, ≥0.10R expectancy, top 10 |
| Confidence | Composite score: edge, sample, confluence, bracket quality — components visible in UI |
| Freshness | K-candle window (default 3) + bracket revalidation at current price; failed revalidation shows as `expired` (dimmed), not hidden |
| Scan universe | Top-N coins by 24h notional volume (default 30, configurable) |
| Scan trigger | On-demand button with per-coin progress; no background jobs |
| Scan interval | The currently selected toolbar interval |
| Weights | UI-tunable sliders (also API-overridable); defaults in core constants |
| Layout | **B** — one Signals tab, split panes: coin signals left, market scanner right (chosen via visual companion) |
| Chart integration | "View on chart" draws entry/stop/target price lines on the Chart tab |
| Settings persistence | localStorage + reset-to-defaults button |
| Sweep orchestration | **Client-orchestrated**: one `POST /api/signals` endpoint; the web app sweeps coins itself with bounded concurrency |

## Design

### Core (`@cta/core/decide/`)

Pure functions, same architectural rules as `patterns/`, `signals/`, `backtest/`.

```ts
interface SetupGate { minTrades: number; minExpectancy: number; topN: number }
interface ConfidenceWeights { edge: number; sample: number; confluence: number; bracket: number }
interface ConfidenceBreakdown { edge: number; sample: number; confluence: number; bracket: number; score: number }

interface TradePlan {
  setup: SignalKind[];            // 1–2 kinds, sorted (scan convention)
  direction: SignalDirection;
  signalT: number;
  ageCandles: number;             // lastIndex − signalIndex
  entry: number;                  // latest close (live proxy for backtest's next-open)
  stop: number;
  target: number;
  rr: number;
  status: 'active' | 'expired';
  metrics: SetupMetrics;          // the setup's backtest aggregates, for the card
  confidence: ConfidenceBreakdown;
}

qualifySetups(results: SetupResult[], gate: SetupGate): SetupResult[];
buildTradePlans(
  candles: Candle[], ctx: DetectorContext, signals: Signal[],
  qualified: SetupResult[], cfg: DecideConfig, // BacktestConfig + window + weights
): TradePlan[];
```

Mechanics:

- **One plan per setup, most recent occurrence.** A setup firing twice inside the window yields
  one plan from the later occurrence. Pairs reuse `pairEntries` at the live edge.
- **Bracket at the live edge.** `computeBracket(latestClose, direction, pivotPricesAt(lastIndex),
  atr[lastIndex], cfg)` — walk-forward pivots only, no lookahead concern. R/R below `minRR` →
  `expired`, still scored and returned.
- **Confluence is a second pass** over built plans (it needs to know which other setups are
  active), then scores finalize. Deterministic, no ordering dependence.
- **No new indicator math.** Detection, ATR, pivots, brackets are all Phase 2 functions; `decide/`
  only orchestrates and scores.
- Named constants in `decide/constants.ts`: `EDGE_SCALE = 0.5`, `SAMPLE_HALF = 30`,
  `CONFLUENCE_SAT = 3`, `RR_SAT = 3`, `DEFAULT_GATE = { minTrades: 20, minExpectancy: 0.1,
  topN: 10 }`, `DEFAULT_WEIGHTS = { edge: 0.4, sample: 0.2, confluence: 0.2, bracket: 0.2 }`,
  `DEFAULT_WINDOW = 3`.

### Server (`@cta/server`)

- **`POST /api/signals`** `{ coin, interval, lookback?, config? }` where `config` extends the
  backtest config with `gate`, `weights`, `window`, `force`. Flow: candles via `candleService`
  (staleness window; `force` bypasses) → scan via `backtestService` — **only the scan-relevant
  config subset feeds its cache key**, so slider/gate changes never invalidate the cached scan →
  `qualifySetups` + `buildTradePlans`. Validation: 404 unknown coin, 422 under 50 candles,
  400 malformed (schema), shared route timeout. No new cache table: plan computation after a warm
  scan is sub-millisecond.
- **Markets volume:** `HyperliquidClient` gains `metaAndAssetCtxs()` (single info call; asset
  contexts align by index with the universe). `MarketRow` gains `dayNtlVlm`; same store and 1h TTL.
  The server stays unaware the scanner exists.
- Shared response/request types for signals live in `@cta/core` (avoid repeating the Phase 2
  duplicate-types papercut noted at retro).

### Web (`@cta/web`)

- **Signals tab (layout B, split panes).** Left: settings strip above signal cards for the
  selected coin, auto-loaded on tab open / coin / interval / settings change (cheap when the scan
  is warm). Right: market scanner — "Scan market" button, progress `done/total`, rows fill
  incrementally and re-sort by confidence; row click selects that coin.
- **Hooks.** `useSignals` mirrors `useAnalysis` (abort on context change). `useMarketScan` sweeps
  the top-N-by-volume list through `/api/signals` with concurrency 3, accumulates per-coin rows
  (best active plan; coins with no active plan are omitted from the ranking but counted in
  progress), aborts on interval change or re-scan.
- **Chart lines.** "View on chart" switches tabs and draws three `createPriceLine`s on the candle
  series (entry solid, stop red dashed, target green dashed); replaced on new selection, cleared on
  coin/interval change.
- **Settings persistence.** One localStorage key (`cta:signals-settings:v1`), reset button
  restores `decide/constants` defaults.
- **Errors.** Sweep: per-coin error chip, sweep continues; 422 → dimmed "insufficient data" rows
  at the bottom. Signals pane reuses the existing error banner.

### Testing

- **Core:** gate boundary tests (exactly 20 trades / 0.10R, cap order); plan fixtures (active vs
  expired via price run-away, window edge at exactly K candles, most-recent-only, pair at live
  edge); confluence second-pass; weight normalization (scale-invariance, zero-weight); determinism.
- **Server:** injected fakes (Phase 1/2 pattern); validation codes; scan-cache reuse across
  slider-only config changes; `force` passthrough; `dayNtlVlm` in markets payload.
- **Web:** hook abort behavior, sweep progress/error/abort, localStorage round-trip + reset,
  scanner row click, chart line draw/replace/clear with a mocked chart (vitest + testing-library).
- **e2e:** `e2e/phase3.mjs` (puppeteer-core + system Chrome, servers on :3001/:5173): Signals tab
  against live Hyperliquid, top-5 mini-sweep fills the scanner, view-on-chart screenshot shows the
  three price lines. Screenshots inspected at pixel level (Phase 2 lesson — don't trust prose
  claims about canvas).

### Out of scope (Phase 4+)

Multi-interval sweeps and cross-timeframe ranking, alerts/notifications, background/scheduled
scanning, order placement or live trading, regime classification, watchlists, server-side settings,
backtest-vs-live signal correlation tracking.
