# Phase 2 — Pattern Recognition & Backtesting

Detect candlestick + indicator signals on Hyperliquid pairs and backtest them (singles and pairs) with adaptive, structure-based brackets — plus the five Phase 1 polish items.

## TODO

### Core — indicators & signal model

- [x] `@cta/core` exports `atr(candles, period)` (Wilder-smoothed, default 14) whose values match hand-computed references.
- [x] `SUPPORTED_INTERVALS` and the `Interval` union live in `@cta/core`; server config, route validation, and web `intervals.ts` consume them with no duplicated interval list.
- [x] Each of the 10 candle-pattern detectors (bullish/bearish engulfing, hammer, shooting star, doji, morning star, evening star, three white soldiers, three black crows, bullish/bearish harami) returns a correctly-located `Signal` on a positive fixture and nothing on a near-miss fixture.
- [x] RSI detectors emit signals for 30/70 zone exits and bullish/bearish divergence on fixtures.
- [x] MA detectors emit signals for fast/slow golden and death crosses and for price crossing an MA on fixtures.
- [x] Volume-spike detector emits direction-tagged signals when volume > k × volume-SMA (default k = 2) on fixtures.
- [x] S/R detectors emit bounce and break signals against supplied pivot levels on fixtures.
- [x] Running every detector in `DETECTOR_REGISTRY` over a composite fixture yields signals from all five families through the single `detect(candles, context)` interface.

### Core — backtest engine

- [x] A single-signal backtest enters at next candle open, places the stop beyond the nearest opposing pivot and target at the next pivot in trade direction, applies the ATR floor/cap, and skips trades whose computed R/R is below the minimum (default 1.5), counting them as filtered.
- [x] In-trade management is scenario-verified: breakeven move at +1R, structure ratchet to newly cleared pivots, opposite-direction signal closes at next open, a candle touching both stop and target counts as a stop (conservative intrabar rule), and trades open at end of history close at the final candle tagged `end-of-data`.
- [x] With no usable pivot structure near entry, brackets fall back to ATR-only without skipping the trade.
- [x] A scan runs every single plus every same-direction pair (both signals within the confluence window, default 3 candles; entry after the later signal), with at most one open position per run, and returns results ranked by expectancy.
- [x] Each scan result reports trade count, win rate, avg R, profit factor, expectancy, max drawdown (in R), and filtered-trade count — aggregates only, no per-trade lists.
- [x] Identical candles + config produce identical scan output (determinism test).
- [x] No pivot lookahead anywhere in the backtest: S/R signal detection at bar i, the entry bracket, and the in-trade ratchet each use only pivot levels confirmed by that bar (a swing pivot is confirmed `lookback` bars after its extreme). Walk-forward levels come from a memoized per-index provider; full-history levels remain available for chart display.

### Server

- [x] `POST /api/backtest` returns the ranked scan for a coin/interval; a `signalKinds` array in config backtests exactly that custom set.
- [x] Backtest validation: unknown coin → 404, unknown signal kind → 400, fewer than 50 candles → 422 with a clear message.
- [x] Repeating a backtest request with unchanged candles and config is served from the SQLite result cache (keyed by coin/interval/config-hash/last-candle-time); a new candle head triggers recomputation.
- [x] `POST /api/analysis` responses include `signals: Signal[]` from the full detector registry.
- [x] `POST /api/analysis` with `force: true` refetches candles inside the staleness window, and the web Refresh button sends it.
- [x] Unknown coin on `/api/analysis` returns 404 (no more 200-with-zero-candles).
- [x] Minor-batch fixes verified: rate limiter serializes concurrent acquisitions; a route-level timeout caps the HL-outage hang; tail backfill fetches only the missing range; `PivotLevel.touches` counts independent visits; favicon served with no console 404.

### Web

- [x] Toolbar offers Chart | Backtest tabs; switching tabs preserves the selected coin and interval.
- [x] Chart tab renders signal markers (▲ bullish below / ▼ bearish above, short labels) and the indicator drawer toggles each signal family independently.
- [x] Backtest tab shows a config strip (min R/R, confluence window, volume-spike k, Run scan) and a sortable results table defaulting to expectancy rank; rows with < 20 trades render dimmed with a low-sample badge.
- [x] Selecting signal kinds in the custom-set tester and hitting "Test selection" pins that result row above the scan ranking.
- [x] `useBacktest` exposes loading/error/result state, aborts in-flight scans on coin/interval change, and the Backtest tab shows a scan-in-flight state.
- [x] Browser e2e (puppeteer-core + system Chrome): markers are visibly rendered on the chart and a live scan against Hyperliquid data populates the results table.

## Context

Phase 1 (merged, `f0e1509`) provides candles via a Fastify server with a SQLite cache, pure-TS indicators in `@cta/core` (SMA, EMA, Wilder RSI, volume, volume profile, volume-weighted pivots), and a lightweight-charts v4 UI. Phase 2 adds the analysis layer: signal detection and a backtesting engine that measures which signal combinations actually work per pair — feeding Phase 3 (signal generation + confidence scoring).

Decisions made interactively during brainstorming (2026-06-10):

| Decision | Choice |
|---|---|
| Spec scope | One spec covering patterns + backtesting |
| Candle patterns | Core ~10 |
| Indicator families | RSI, MA, volume, S/R pivots (all four) |
| Trade model | Bracket trades |
| Bracket derivation | Structure-based (pivots) + ATR floor; **adaptive, not fixed presets** (user explicitly rejected fixed parameters) |
| In-trade management | Breakeven at +1R, structure ratchet, opposite-signal exit (no ATR trail, no fixed time stop) |
| Direction | Long + short (perps) |
| Combo scan | Singles + pairs; custom sets on demand via API |
| Metrics | Win rate, avg R, profit factor, expectancy, max DD, sample count; aggregates only |
| Confluence window | 3 candles, configurable |
| Execution | Synchronous `POST /api/backtest` + SQLite result cache |
| Polish items | All five folded in |
| UI | Layout A — separate Backtest tab |
| Architecture | Pure functions in `@cta/core` under subfolders (`patterns/`, `signals/`, `backtest/`) |
| Pivot lookahead (2026-06-10 checkpoint, after T14) | **Walk-forward everywhere** — user chose "fix now" over "accept & document", scope "all three": S/R signal detection, entry brackets, and the in-trade ratchet all consume only pivots confirmed by the current bar. Full-history pivots stay in `ctx.pivots` for chart display. |

## Design

### Signal model (`@cta/core`)

```ts
type SignalKind = /* union of all detectable kinds, e.g. */
  | 'bullish-engulfing' | 'bearish-engulfing' | 'hammer' | 'shooting-star'
  | 'doji' | 'morning-star' | 'evening-star'
  | 'three-white-soldiers' | 'three-black-crows'
  | 'bullish-harami' | 'bearish-harami'
  | 'rsi-oversold-exit' | 'rsi-overbought-exit'
  | 'rsi-bullish-divergence' | 'rsi-bearish-divergence'
  | 'ma-golden-cross' | 'ma-death-cross'
  | 'price-cross-ma-up' | 'price-cross-ma-down'
  | 'volume-spike-up' | 'volume-spike-down'
  | 'sr-bounce-support' | 'sr-bounce-resistance'
  | 'sr-break-up' | 'sr-break-down';

interface Signal {
  kind: SignalKind;
  direction: 'bullish' | 'bearish';
  index: number;        // candle index where the signal completes
  t: number;            // candle open time
  meta?: Record<string, number>; // detector-specific extras (e.g. level price)
}

interface DetectorContext {
  rsi: IndicatorPoint[];
  movingAverages: MovingAverageResult[];
  volume: VolumeResult;
  pivots: PivotLevel[];
  atr: IndicatorPoint[];
}

type Detector = (candles: Candle[], ctx: DetectorContext) => Signal[];
const DETECTOR_REGISTRY: Record<SignalKind, Detector>;
```

One flat `Signal` shape for both families keeps the engine family-agnostic. Detectors are pure; the caller precomputes `DetectorContext` once per scan. Candle-pattern geometry (body/wick ratios, doji thresholds) lives in named, tested constants. File layout: `packages/core/src/patterns/` (candle patterns), `signals/` (indicator detectors), `backtest/` (engine + scan), keeping each file focused.

New indicator: `atr(candles, period = 14)`, Wilder-smoothed, exported alongside the existing math.

### Backtest engine (`@cta/core/backtest`)

A **setup** = 1–2 `SignalKind`s + management policy. Simulation per setup over the full candle history:

1. **Signal → entry.** Singles: every occurrence. Pairs: both kinds, same direction, within the confluence window (default 3 candles); entry signal is the later one. Entry fills at the next candle open. One open position per run; same-direction signals during a trade are ignored.
2. **Bracket at entry (adaptive).** Stop just beyond the nearest opposing pivot; target at the next pivot in trade direction. ATR(14) floors the stop distance (min 1.0×ATR) and caps it (max 3.0×ATR); same for the target. No pivots in range → ATR-only fallback (never skip for missing structure). Computed R/R < minimum (default 1.5) → skip, count as filtered.
3. **Per-candle management.** In order: opposite-signal exit at next open → structure ratchet (stop to just beyond each newly cleared pivot) → breakeven at +1R → stop/target touch checks. A candle touching both stop and target counts as a **stop** (conservative). End of history → close at final close, tagged `end-of-data`.
4. **Metrics (R units).** Trade count, win rate, avg R, profit factor, expectancy, max drawdown over the trade-sequence equity curve, filtered count. Aggregates only.

The scan enumerates all singles + all viable same-direction pairs (~hundreds of runs; pure TS, expected a few seconds per coin/timeframe) and ranks by expectancy. Everything is deterministic.

### Server (`@cta/server`)

- **`POST /api/backtest`** `{ coin, interval, config? }` → ranked `BacktestScanResult`. `config.signalKinds` runs one custom setup instead of the scan. Validation: 404 unknown coin, 400 unknown kind, 422 under 50 candles.
- **Result cache:** new table in the existing better-sqlite3 db, keyed `(coin, interval, configHash, lastCandleT)`. Hit → cached JSON; new candle head changes the key (natural invalidation, no TTL).
- **`/api/analysis`** gains `signals: Signal[]` (full registry) in the response and accepts `force: true` to bypass the staleness window.
- **Polish:** 404 unknown coin on analysis; shared `Interval` from core in config + validation; rate-limiter serialization; route-level timeout for HL outages; tail-only backfill; `touches` = independent visits; favicon.

### Web (`@cta/web`)

- **Tabs:** `Chart | Backtest` in the toolbar; coin/interval state lives above the tabs and survives switching.
- **Chart tab:** lightweight-charts v4 `setMarkers` for signals (▲ below bullish / ▼ above bearish, short codes like ENG, RSI÷); per-family visibility toggles in the indicator drawer.
- **Backtest tab:** config strip (min R/R, confluence window, volume-spike k, Run scan), custom-set multi-select with "Test selection" (pins its row), sortable results table (rank, setup, direction, trades, win %, avg R, PF, expectancy, max DD, filtered), expectancy-ranked by default, < 20-trade rows dimmed with a low-sample badge.
- **State:** `useBacktest` hook mirroring `useAnalysis` — request state, error banner reuse, abort on coin/interval change.

### Testing

- **Core:** fixture-based detector tests (positive + near-miss per pattern); scenario-based engine tests (clean target, stop-first intrabar, breakeven save, ratchet, opposite exit, end-of-data, R/R filter, pair windowing); ATR reference values; determinism check.
- **Server:** injected fake candle store (Phase 1 pattern); cache hit/miss; all error codes; force-refresh behavior.
- **Web:** table sorting/dimming, tab state preservation, marker toggles (vitest + testing-library).
- **e2e:** puppeteer-core + system Chrome against live Hyperliquid before merge — verify markers actually render and a real scan populates the table (Phase 1 lesson: probe DOM geometry, don't trust unit tests for canvas overlays).

### Out of scope (Phase 3)

Signal generation for live trading, confidence scoring, backtest-vs-live correlation, per-trade detail payloads/trade-on-chart plotting, triple-combo scans, regime classification, lightweight-charts v5 upgrade.
