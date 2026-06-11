# Phase 4 — Continuous Market Analysis Engine

A 24/7 engine inside the server process that ingests Hyperliquid data by WebSocket push, re-analyzes every monitored coin×timeframe the moment data changes (provisional intra-candle + confirmed at close), pushes high-confidence trade-plan alerts to Telegram/Discord/macOS, selects the best MA pair per coin×timeframe nightly, and streams a live dashboard to the web UI.

## TODO

- [ ] Engine boots with no manual trigger, backfills missing candles via REST (rate-limited), and begins analyzing coins in 24h-volume order; coins become live one by one rather than after a global barrier
- [ ] Engine maintains live 15m candles via one WS connection (`candle@15m` per coin + `allMids`) and locally aggregates exact UTC-aligned 1h/4h/1d candles from them
- [ ] Forming candles update from `allMids` mid-price ticks between candle messages
- [ ] WS silence >30s (config) triggers reconnect with exponential backoff, resubscribe, and REST gap-fill; the candle store afterwards has no gaps or duplicates
- [ ] All engine analysis flows through a single pure `analyzeCoin(candles, config) → { scanResults, plans }` entry point in `@cta/core` (the Rust-portable kernel boundary)
- [ ] A candle close enqueues exactly one scan job per affected coin×timeframe into the worker pool; duplicate pending jobs coalesce; jobs run in volume-rank priority with provisional-active coins jumping the queue
- [ ] Tick-triggered provisional evaluation runs on the main thread only for coins whose mid moved >0.05% since last check, at most once per second per coin (both config)
- [ ] A provisional plan with confidence ≥75 (config) fires a ⚠ provisional alert; at candle close it is followed by exactly one ✓ confirmed or ✗ withdrawn follow-up
- [ ] A confirmed plan with confidence ≥65 (config) fires a confirmed alert with coin, timeframe, direction, setup kinds, entry/stop/target, R/R, confidence, and a chart deep link that opens the web app preloaded to that coin+timeframe (web app reads `?coin=&interval=` URL params)
- [ ] An alert identity `(coin, timeframe, direction, kinds, entry rounded to 0.1%)` never fires twice while its plan is alive, and not again within a 6h cooldown after expiry; dedupe state survives restart (SQLite)
- [ ] More than 10 alerts queued within 60s collapse into a single digest message per sink
- [ ] Each sink (Telegram, Discord webhook, macOS notification) delivers independently with 3 retried attempts and backoff; a failing sink never blocks the engine or other sinks
- [ ] Every alert (including digests, confirmations, withdrawals) is persisted to a SQLite `alerts` table and survives restart
- [ ] Nightly at 00:10 UTC the MA optimizer grid-searches fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200} (fast period < slow period) per coin×timeframe over MA-involved setups only
- [ ] An MA challenger replaces the EMA50/SMA200 baseline only when it beats the baseline's expectancy on the held-out newest 30% of candles with ≥20 train trades and ≥8 validation trades; selections are stored with their metrics in a `ma_selection` table
- [ ] Engine scans use the stored MA selection for that coin×timeframe, falling back to EMA50/SMA200 when none exists
- [ ] `GET /live` (SSE) streams scanner-ranking updates, alert-feed entries, and engine-health events to any number of concurrent clients
- [ ] The web scanner pane has a Live mode (default when engine connected): rows update in place from SSE without clicking Scan market; the manual button remains as fallback
- [ ] A web alert-feed pane lists alerts chronologically with ⚠/✓/✗ badges; clicking an alert loads that coin+timeframe on the chart with the plan's entry/stop/target lines
- [ ] A toolbar health chip reflects engine state (WS connected, last-tick age, scan-queue depth) and visibly degrades when the feed is down
- [ ] Latency metrics (tick→provisional, close→scan per coin, close→universe complete) are recorded and logged as p50/p95 percentiles; the live e2e asserts the budget table
- [ ] An in-process watchdog exits the process if the WS stays dead >5 min or the event loop stalls; a documented launchd setup (plist + caffeinate) restarts it and the engine resumes warm (gap-fill + full scan cycle) with no manual steps
- [ ] Engine activity and health transitions write structured logs to `data/logs/` with size-capped rotation
- [ ] The server serves the built web app via `@fastify/static`, so the dashboard and alert deep links work 24/7 without a vite dev server
- [ ] Integration test: a fake Hyperliquid WS replaying a scripted message sequence drives the full engine and produces exactly the expected alerts and SSE events, including a provisional→withdrawn case and a reconnect gap-fill
- [ ] `node e2e/phase4.mjs` passes against live Hyperliquid: ticks flow, scans complete within budget, dashboard updates live, health chip green

## Context

Phases 1–3 built an on-demand analyser: a human clicks, the browser sweeps up to 400 coins through `POST /signals` (3 concurrent), each call REST-fetching candles and running backtest→qualify→plans. Analysis freshness is bounded by human clicks and HTTP round-trips.

Phase 4 inverts the model: data arrives pushed, analysis runs the moment anything changes, and the human is notified. The end-to-end goal is "price moves → phone buzzes" in about a second for forming-candle (provisional) events, with confirmed-at-close events analysed across the whole universe within seconds of the close.

**Decisions made during brainstorming (with the user):**

| Decision | Choice |
|---|---|
| Scope slice | Engine + notifications + MA selection + live UI now; trade execution is Phase 5 (this engine's plan output must be execution-ready) |
| Deployment | Always-on Mac at home; launchd keep-alive; design stays env-portable for a later VPS move |
| Cadence semantics | Hybrid: provisional alerts intra-candle, confirmed/withdrawn at candle close (no silent repaint) |
| Universe | All listed Hyperliquid perp coins (~200–400), config-capped by volume rank |
| Timeframes | 15m, 1h, 4h, 1d continuously analysed; others remain on-demand in the UI |
| Alert channels | Telegram bot + Discord webhook + macOS notifications (pluggable sinks) |
| Alert events | New confirmed plan, new provisional plan (+confirm/withdraw follow-up). No lifecycle or health push alerts (health is logged + dashboard only) |
| Confidence bars | Confirmed ≥65, provisional ≥75 (both config) |
| MA selection | Per coin×timeframe, nightly, walk-forward validated, EMA50/SMA200 fallback |
| UI | Live dashboard: auto-updating scanner + alert feed + health chip |
| Throttling | No quiet hours; burst digest >10 alerts/min; alert history persisted |
| Architecture | Approach C: TypeScript engine reusing `@cta/core`, compute kernel behind a narrow interface with an explicit latency budget as the documented Rust-port trigger |

## Design

### Topology

The engine is a module in `apps/server/src/engine/`, started by the existing Fastify server process. One Node process serves the REST API, the SSE dashboard, and the engine. Rationale: shares the SQLite candle store and in-memory state with the API, makes SSE trivial, and keeps ops to a single launchd service on the Mac.

Heavy scans run in a `worker_threads` pool sized `max(1, cpus − 2)` (config). Workers import `@cta/core` and execute only the kernel function.

### Data ingestion

One WebSocket connection to `wss://api.hyperliquid.xyz/ws`:

- **`candle` subscription at 15m per monitored coin** (~400 subs; HL limit 1000). 15m is the lowest analysed timeframe. Candle messages update the forming 15m candle authoritatively and deliver the close.
- **`allMids`** (1 sub): mid prices for every coin ~2×/sec; updates forming candles (c, h, l) between candle messages and drives provisional checks.
- **Local aggregation:** 1h/4h/1d candles are built from 15m candles. Hyperliquid candles are UTC-aligned so the roll-up boundaries are exact; an aggregated candle closes when its last constituent 15m candle closes.

**Cold start:** for each coin×timeframe missing history, REST-backfill 2000 candles through the existing `CandleService` + rate limiter (1200 weight/min). Per HL docs, `candleSnapshot` weighs **20 base + 1 per 60 candles returned** (~54 for a 2000-candle request); the current `CandleService` only counts the per-60 part and must be corrected as part of this phase. Full-universe cold start is therefore ~75 min; the engine starts analysing each coin as soon as its data lands, in 24h-volume order, so majors are live within the first minutes. **Warm restart** gap-fills only the candles since the latest stored — seconds.

**Resilience:** heartbeat watchdog; no message for 30s → tear down, reconnect with exponential backoff (1s→60s cap), resubscribe, REST gap-fill the blackout window per coin×timeframe. All transitions logged. The market universe (coin list) refreshes from `metaAndAssetCtxs` hourly; newly listed coins join the subscriptions and backfill lazily, delisted coins unsubscribe and drop out of analysis.

### Compute kernel (the Rust escape hatch)

```ts
// @cta/core
analyzeCoin(candles: Candle[], config: EngineAnalysisConfig): { scanResults: ScanResult; plans: TradePlan[] }
```

A pure wrapper over the existing `runScan` → `qualifySetups` → `buildTradePlans` pipeline (plus the MA-selection override in `config`). Workers call only this. The latency budget below is the documented trigger for porting this one function to Rust (napi-rs) behind the same signature; nothing outside it would change.

### Scheduler

Two paths:

1. **Candle close → full scan.** Closing a coin's 15m/1h/4h/1d candle enqueues `{coin, timeframe}` into the worker-pool queue. Coalescing: a job already pending for the same key is not duplicated. Priority: 24h-volume rank, with coins holding live provisional alerts at the front. Worst case is the aligned 00:00 UTC close (~1,600 jobs ≈ 16s on 8 workers at ~80ms/job); top coins finish in the first second, and results stream out as each job completes.
2. **Tick → provisional check.** Per `allMids` batch, the main thread updates forming candles, then re-evaluates only coins whose mid moved >0.05% since their last evaluation, at most once/sec per coin (both config). An eligible coin's evaluation covers all four timeframes' forming candles. Evaluation appends the forming candle to the closed series and runs detection incrementally; if a qualifying setup triggers at the forming index and yields a plan with confidence ≥ provisional threshold, an alert event is emitted. At the candle's close, path 1 settles it: the setup either exists on the closed candle (→ confirmed) or doesn't (→ withdrawn).

### Latency budget

| Metric | Budget |
|---|---|
| Candle close → top-20-by-volume coins scanned | < 2s |
| Candle close → full universe scanned | < 30s (p95) |
| Single coin×timeframe full scan in a worker | < 250ms (p95) |
| Tick → provisional alert dispatched to sinks | < 1s |

Instrumented in-process; p50/p95 logged every 5 min and exposed on `/health` and the SSE health event. Sustained breach (p95 over budget for 24h of operation) is the documented Rust-port trigger.

### Alerting

`AlertEngine` consumes analysis output and emits to sinks:

- **Events:** `provisional-new` (conf ≥75), `provisional-confirmed`, `provisional-withdrawn`, `confirmed-new` (conf ≥65). Thresholds config. Each event type fires at most once per alert identity: a plan that went provisional→confirmed does **not** additionally fire `confirmed-new`. The follow-up is `provisional-confirmed` when the closed-candle scan yields the same identity as an active plan with confidence ≥ the confirmed threshold; otherwise `provisional-withdrawn` (the message notes when the setup still existed but scored under the bar).
- **Identity/dedupe:** identity = `(coin, timeframe, direction, sorted setup kinds, entry rounded to 0.1%)`. One fire per identity while the plan is alive; 6h cooldown after expiry. Dedupe table in SQLite so restarts don't re-fire.
- **Burst guard:** if >10 alerts queue within any 60s window, they collapse into one digest message (count, coins, top 5 by confidence) per sink.
- **Sinks:** Telegram bot (BotFather token + chat id), Discord webhook URL, macOS notification via `terminal-notifier` (fallback `osascript`). Per-sink delivery: 3 attempts, exponential backoff, failure logged and dropped — never blocks the engine or other sinks. Sinks configured via env; absent config disables that sink.
- **Message content:** coin, timeframe, direction, setup kinds, entry/stop/target, R/R, confidence, ⚠/✓/✗ marker, and a deep link (`http://<host>:5173/?coin=X&interval=Y`) to the chart.
- **Persistence:** `alerts` table (id, ts, event, identity fields, plan JSON, confidence, sinks delivered) in the existing SQLite db.

### MA optimizer

Nightly job at 00:10 UTC, queued at low priority into the same worker pool:

- Per coin×timeframe: grid = fast {SMA,EMA}×{9,12,21,34,50} × slow {SMA,EMA}×{50,100,150,200}, fast period < slow period (≈ 80 combos). Each combo backtests only MA-involved setups (ma-crosses, price-cross-ma singles and their pairs) over the cached 2000 candles.
- **Walk-forward:** train on the oldest 70%, validate on the newest 30%. The best train-expectancy combo wins only if its *validation* expectancy beats the EMA50/SMA200 baseline's validation expectancy, with ≥20 train trades and ≥8 validation trades. Otherwise the baseline is kept.
- Result rows in `ma_selection` (coin, timeframe, fast/slow spec, train/validation metrics, baseline metrics, selected-at). The engine's `analyzeCoin` config injects the stored pair; UI/API on-demand analysis keeps using defaults unless it opts in (out of scope to change UI controls here).

### Live dashboard

- **Server:** `GET /live` (SSE). Event types: `scan` (coin, timeframe, best active plan summary, confidence — emitted as each scan job completes), `alert` (alert row), `health` (WS state, last-tick age, queue depth, latency percentiles), with a snapshot replay of current rankings + last 50 alerts on connect.
- **Web:** scanner pane Live mode (default when SSE connected) — rows keyed by coin, updated in place, sorted by confidence; manual Scan button stays as fallback. New alert-feed pane (chronological, ⚠/✓/✗ badges, click → chart with plan lines, reusing the Phase 3 view-on-chart path). Toolbar health chip (green/amber/red from health events). The web app parses `?coin=&interval=` URL params on load so alert deep links (from Telegram/Discord and the feed) open the right chart.

### Reliability & ops

- **State:** SQLite is the only durable state (candles, alerts, dedupe, MA selections). Everything in memory rebuilds on boot: gap-fill → first scan cycle repopulates rankings.
- **Watchdog:** in-process; exits deliberately if WS is dead >5 min despite reconnects or the event loop stalls (timer-skew detector). launchd `KeepAlive` restarts it; restart is the recovery path.
- **launchd:** documented plist (RunAtLoad + KeepAlive) running the server under `caffeinate -s`; setup instructions in `docs/ops-mac.md`, including `pmset` notes. Design stays env-portable (no macOS-only code paths in the engine itself) for a later VPS move.
- **Logging:** structured (pino or equivalent) to `data/logs/engine.log`, size-capped rotation (e.g. 20MB × 5 files). Health transitions, scan latencies, sink failures, watchdog exits.
- **Config:** `engine.json` at repo root (universe cap, timeframes, alert thresholds, tick-throttle values, worker count, sink toggles, and the analysis knobs the UI settings strip exposes: gate minTrades/minExpectancy/topN, window, confluenceWindow, minRR, volumeSpikeK) + secrets via env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`). Read at boot; restart to apply.
- **Serving the UI 24/7:** the server serves the built web app (`apps/web/dist`) via `@fastify/static`, so the dashboard and alert deep links work without a vite dev server; deep links use the server's origin.

## Error handling

- WS errors/disconnects → reconnect loop + gap-fill (never crash on feed errors).
- REST errors during backfill/gap-fill → existing client retry/backoff; a coin that repeatedly fails is marked degraded, skipped, retried on a 5-min cycle, logged.
- Worker crash → pool respawns the worker, in-flight job re-queued once, then dropped + logged.
- Sink errors → per-sink retry then drop (alert still persisted in SQLite with delivery status).
- Malformed WS messages → logged + skipped, never throw on the hot path.

## Testing

- **Unit:** aggregator (15m→1h/4h/1d boundaries, partial windows after gaps), scheduler (coalescing, priority, provisional throttle), AlertEngine (thresholds, identity dedupe incl. restart-persistence, cooldown, burst digest, provisional lifecycle), sinks (mocked HTTP/exec; retry/never-block), MA optimizer (walk-forward split, baseline fallback, min-trade gates), SSE serialization + connect snapshot.
- **Integration:** fake HL WS server replays a scripted sequence (ticks, candle closes, a disconnect) against a real engine instance with mocked sinks → assert exact alert + SSE output, including provisional→withdrawn and reconnect gap-fill (REST mocked).
- **Live e2e:** `e2e/phase4.mjs` boots the real engine on a reduced universe (top ~20 coins, 15m+1h), waits for first scan cycle, asserts: ticks flowing, scans within budget, SSE delivering, UI scanner rows live, health chip green. Follows the phase 2/3 e2e harness patterns (system Chrome, screenshots to `e2e/out/`).

## Out of scope (deferred)

- **Phase 5:** trade execution (wallet signing, order lifecycle, risk limits, kill switch, paper mode). This spec's plan output (entry/stop/target/R:R/confidence) is the execution input contract.
- Plan lifecycle alerts (entry filled / stop / target) and engine-health push alerts (health is dashboard+logs only).
- Quiet hours.
- UI controls for per-coin MA overrides; on-demand `/signals` continues to use default MAs.
- Rust kernel port (triggered only by documented budget breach).
