# Phase 4B — Live Dashboard + Nightly MA Optimizer

On top of the Phase 4A engine: a nightly walk-forward MA optimizer (per coin×timeframe, replacing the fixed EMA50/SMA200 when it provably wins out-of-sample), an SSE-driven live web dashboard (auto-updating scanner, alert feed, health chip), and 24/7 static serving of the web app so alert deep links work unattended.

## TODO

- [x] Nightly at 00:10 UTC the MA optimizer grid-searches fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200} (fast period < slow period) per coin×timeframe over MA-involved setups only, at low priority in the existing worker pool
- [x] An MA challenger replaces the EMA50/SMA200 baseline only when it beats the baseline's expectancy on the held-out newest 30% of candles with ≥20 train trades and ≥8 validation trades; selections are stored with their train/validation/baseline metrics in a `ma_selection` table
- [x] Engine scans use the stored MA selection for that coin×timeframe via the `analyzeCoin` config override, falling back to EMA50/SMA200 when none exists
- [x] `GET /live` (SSE) streams scanner-ranking updates (as each scan completes), alert-feed entries, and engine-health events to any number of concurrent clients, replaying a snapshot (current rankings + last 50 alerts) on connect
- [x] The web scanner pane has a Live mode (default when the engine SSE is connected): rows update in place without clicking Scan market; the manual button remains as fallback
- [x] A web alert-feed pane lists alerts chronologically with ⚠/✓/✗ badges; clicking an alert loads that coin+timeframe on the chart with the plan's entry/stop/target lines
- [x] A toolbar health chip reflects engine state (WS connected, last-tick age, scan-queue depth) and visibly degrades when the feed is down
- [x] The server serves the built web app (`apps/web/dist`) via `@fastify/static`, so the dashboard works 24/7 without a vite dev server
- [x] The web app parses `?coin=&interval=` URL params on load, so alert deep links (from Telegram/Discord and the feed) open the right chart
- [x] `node e2e/phase4b.mjs` passes against live Hyperliquid: dashboard rows update live without clicks, health chip green, a deep-link URL opens the right coin+timeframe, and a forced optimizer run on a few coins writes auditable `ma_selection` rows (amended, user-approved: rows exist only when a challenger beats baseline out-of-sample — market-dependent — so the e2e hard-asserts zero `failed` decisions and exact challenger⇔row agreement, auditing rows whenever ≥1 challenger exists; see Task 19 deviation 2 in the plan)

## Context

Phase 4A (see `2026-06-11-phase4a-continuous-engine-design.md`) delivers the 24/7 engine: WS ingestion, worker-pool scans on candle close, tick-level provisional checks, and Telegram/Discord/macOS alerts persisted to SQLite. 4B makes the engine *visible* (live dashboard instead of click-to-scan) and *self-tuning* (nightly MA selection). 4B builds strictly on 4A's modules and runs in the same server process.

Decisions from the shared brainstorm: MA selection per coin×timeframe, nightly, walk-forward validated, baseline fallback; UI gets a live dashboard (auto-updating scanner + alert feed + health chip); all engine knobs in `engine.json`.

## Design

### MA optimizer

Nightly job at 00:10 UTC (right after the daily close), queued at low priority into the 4A worker pool:

- Per coin×timeframe: grid = fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200}, fast period < slow period (≈80 combos). Each combo backtests only MA-involved setups (ma-crosses, price-cross-ma singles and their pairs) over the cached 2000 candles — cheap relative to a full scan; the whole universe fits comfortably overnight.
- **Walk-forward:** train on the oldest 70% of candles, validate on the newest 30%. The best train-expectancy combo wins only if its *validation* expectancy beats the EMA50/SMA200 baseline's validation expectancy, with ≥20 train trades and ≥8 validation trades. Otherwise the baseline is kept.
- Result rows in `ma_selection` (coin, timeframe, fast/slow spec, train/validation metrics, baseline metrics, selected-at) — every selection auditable.
- The engine's `analyzeCoin` config injects the stored pair. On-demand `/signals` (UI) keeps using defaults; UI controls for MA overrides stay out of scope.
- A manual trigger (`POST /engine/optimize-ma?coins=…`, local only) exists for testing and the e2e.

### Live dashboard

- **Server:** `GET /live` (SSE). Event types: `scan` (coin, timeframe, best active plan summary, confidence — emitted as each scan job completes), `alert` (alert row), `health` (WS state, last-tick age, queue depth, latency percentiles), with a snapshot replay of current rankings + last 50 alerts on connect. Multiple concurrent clients supported; a slow client never blocks the engine (per-client buffer with drop-oldest).
- **Web:** scanner pane Live mode (default when SSE connected) — rows keyed by coin, updated in place, sorted by confidence; manual Scan button stays as fallback. New alert-feed pane (chronological, ⚠/✓/✗ badges, click → chart with plan lines, reusing the Phase 3 view-on-chart path). Toolbar health chip (green/amber/red from health events). The web app parses `?coin=&interval=` URL params on load so alert deep links open the right chart.

### Serving the UI 24/7

The server serves the built web app (`apps/web/dist`) via `@fastify/static` at its origin; alert deep links from 4A already carry `?coin=&interval=` against the server origin, so links work on the unattended Mac. `pnpm --filter @cta/web build` becomes part of the deploy step in `docs/ops-mac.md`. The vite dev server remains the dev workflow (proxying API as today).

## Error handling

- Optimizer job failure for one coin×timeframe → logged, skipped, baseline retained; never affects live scanning.
- SSE client errors/disconnects → client dropped silently; engine unaffected.
- Missing `apps/web/dist` → server logs a warning and serves API only (dev mode unaffected).

## Testing

- **Unit:** walk-forward split + gating logic (challenger wins/loses/min-trade gates), `ma_selection` persistence + `analyzeCoin` override plumbing, SSE serialization + connect snapshot + slow-client drop, scanner Live-mode reducer, alert-feed rendering + click-through, health chip state mapping, URL-param parsing.
- **Integration:** drive the 4A fake-WS engine harness with SSE attached → assert `scan`/`alert`/`health` events arrive in order with a correct connect snapshot.
- **Live e2e:** `e2e/phase4b.mjs` per the TODO above, following the phase 2/3 harness patterns (system Chrome, screenshots to `e2e/out/`).

## Out of scope (deferred)

- **Phase 5:** trade execution.
- Plan lifecycle alerts, engine-health push alerts, quiet hours.
- UI controls for per-coin MA overrides; on-demand `/signals` continues to use default MAs.
- Rust kernel port (triggered only by the 4A latency-budget breach rule).
