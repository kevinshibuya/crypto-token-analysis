# Phase 4A — Continuous Market Analysis Engine + Notifications

A 24/7 engine inside the server process that ingests Hyperliquid data by WebSocket push, re-analyzes every monitored coin×timeframe the moment data changes (provisional intra-candle + confirmed at close), and pushes high-confidence trade-plan alerts to Telegram/Discord/macOS. (Phase 4B adds the nightly MA optimizer and the live web dashboard.)

## TODO

- [x] Engine boots with no manual trigger, backfills missing candles via REST (rate-limited), and begins analyzing coins in 24h-volume order; coins become live one by one rather than after a global barrier
- [x] `candleSnapshot` requests acquire rate-limiter weight matching HL docs: 20 base + 1 per 60 candles returned (today's `CandleService` counts only the per-60 part)
- [x] Engine maintains live 15m candles via one WS connection (`candle@15m` per coin + `allMids`) and locally aggregates exact UTC-aligned 1h/4h/1d candles from them
- [x] Forming candles update from `allMids` mid-price ticks between candle messages
- [x] WS silence >30s (config) triggers reconnect with exponential backoff, resubscribe, and REST gap-fill; the candle store afterwards has no gaps or duplicates
- [x] All engine analysis flows through a single pure `analyzeCoin(candles, config) → { scanResults, plans }` entry point in `@cta/core` (the Rust-portable kernel boundary)
- [x] A candle close enqueues exactly one scan job per affected coin×timeframe into the worker pool; duplicate pending jobs coalesce; jobs run in volume-rank priority with provisional-active coins jumping the queue
- [x] Tick-triggered provisional evaluation runs on the main thread only for coins whose mid moved >0.05% since last check, at most once per second per coin (both config), covering all four timeframes' forming candles per eligible coin
- [x] A provisional plan with confidence ≥75 (config) fires a ⚠ provisional alert; at candle close it is followed by exactly one ✓ confirmed or ✗ withdrawn follow-up (✓ requires the same identity active at close with confidence ≥ the confirmed bar; ✗ notes when the setup survived but scored under it); a provisional→confirmed plan never additionally fires `confirmed-new`
- [x] A confirmed plan with confidence ≥65 (config) fires a confirmed alert with coin, timeframe, direction, setup kinds, entry/stop/target, R/R, confidence, and a chart deep link carrying `?coin=&interval=` params (the web app honors them in Phase 4B)
- [x] An alert identity `(coin, timeframe, direction, kinds, entry rounded to 0.1%)` never fires twice while its plan is alive, and not again within a 6h cooldown after expiry; dedupe state survives restart (SQLite)
- [x] More than 10 alerts queued within 60s collapse into a single digest message per sink
- [x] Each sink (Telegram, Discord webhook, macOS notification) delivers independently with 3 retried attempts and backoff; a failing sink never blocks the engine or other sinks
- [x] Every alert (including digests, confirmations, withdrawals) is persisted to a SQLite `alerts` table and survives restart
- [x] Latency metrics (tick→provisional, close→scan per coin, close→universe complete) are recorded as p50/p95, logged every 5 min, and exposed on `/health`
- [x] An in-process watchdog exits the process if the WS stays dead >5 min or the event loop stalls; a documented launchd setup (plist + caffeinate) restarts it and the engine resumes warm (gap-fill + full scan cycle) with no manual steps
- [x] Engine activity and health transitions write structured logs to `data/logs/` with size-capped rotation
- [x] Integration test: a fake Hyperliquid WS replaying a scripted message sequence drives the full engine and produces exactly the expected alerts and SSE-ready events, including a provisional→withdrawn case and a reconnect gap-fill
- [x] `node e2e/phase4a.mjs` passes against live Hyperliquid on a reduced universe: ticks flow, scans complete within budget, the alert pipeline produces persisted alert rows (sinks mocked/log-only), and a warm restart resumes without manual steps

## Context

Phases 1–3 built an on-demand analyser: a human clicks, the browser sweeps up to 400 coins through `POST /signals` (3 concurrent), each call REST-fetching candles and running backtest→qualify→plans. Analysis freshness is bounded by human clicks and HTTP round-trips.

Phase 4A inverts the model: data arrives pushed, analysis runs the moment anything changes, and the human is notified. The end-to-end goal is "price moves → phone buzzes" in about a second for forming-candle (provisional) events, with confirmed-at-close events analysed across the whole universe within seconds of the close.

**Decisions made during brainstorming (with the user):**

| Decision | Choice |
|---|---|
| Scope slice | 4A: engine + notifications. 4B: MA auto-selection + live dashboard. Phase 5: trade execution (this engine's plan output must be execution-ready) |
| Deployment | Always-on Mac at home; launchd keep-alive; design stays env-portable for a later VPS move |
| Cadence semantics | Hybrid: provisional alerts intra-candle, confirmed/withdrawn at candle close (no silent repaint) |
| Universe | All listed Hyperliquid perp coins (~200–400), config-capped by volume rank |
| Timeframes | 15m, 1h, 4h, 1d continuously analysed; others remain on-demand in the UI |
| Alert channels | Telegram bot + Discord webhook + macOS notifications (pluggable sinks) |
| Alert events | New confirmed plan, new provisional plan (+confirm/withdraw follow-up). No lifecycle or health push alerts (health is logged + `/health` only) |
| Confidence bars | Confirmed ≥65, provisional ≥75 (both config) |
| Throttling | No quiet hours; burst digest >10 alerts/min; alert history persisted |
| Architecture | Approach C: TypeScript engine reusing `@cta/core`, compute kernel behind a narrow interface with an explicit latency budget as the documented Rust-port trigger |

## Design

### Topology

The engine is a module in `apps/server/src/engine/`, started by the existing Fastify server process. One Node process serves the REST API and the engine (and, in 4B, the SSE dashboard). Rationale: shares the SQLite candle store and in-memory state with the API and keeps ops to a single launchd service on the Mac.

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

A pure wrapper over the existing `runScan` → `qualifySetups` → `buildTradePlans` pipeline (with an MA-pair override in `config`, used by 4B's optimizer; 4A always passes the EMA50/SMA200 default). Workers call only this. The latency budget below is the documented trigger for porting this one function to Rust (napi-rs) behind the same signature; nothing outside it would change.

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

Instrumented in-process; p50/p95 logged every 5 min and exposed on `/health` (and, in 4B, the SSE health event). Sustained breach (p95 over budget for 24h of operation) is the documented Rust-port trigger.

### Alerting

`AlertEngine` consumes analysis output and emits to sinks:

- **Events:** `provisional-new` (conf ≥75), `provisional-confirmed`, `provisional-withdrawn`, `confirmed-new` (conf ≥65). Thresholds config. Each event type fires at most once per alert identity: a plan that went provisional→confirmed does **not** additionally fire `confirmed-new`. The follow-up is `provisional-confirmed` when the closed-candle scan yields the same identity as an active plan with confidence ≥ the confirmed threshold; otherwise `provisional-withdrawn` (the message notes when the setup still existed but scored under the bar).
- **Identity/dedupe:** identity = `(coin, timeframe, direction, sorted setup kinds, entry rounded to 0.1%)`. One fire per identity while the plan is alive; 6h cooldown after expiry. Dedupe table in SQLite so restarts don't re-fire.
- **Burst guard:** if >10 alerts queue within any 60s window, they collapse into one digest message (count, coins, top 5 by confidence) per sink.
- **Sinks:** Telegram bot (BotFather token + chat id), Discord webhook URL, macOS notification via `terminal-notifier` (fallback `osascript`). Per-sink delivery: 3 attempts, exponential backoff, failure logged and dropped — never blocks the engine or other sinks. Sinks configured via env; absent config disables that sink.
- **Message content:** coin, timeframe, direction, setup kinds, entry/stop/target, R/R, confidence, ⚠/✓/✗ marker, and a deep link (`http://<server-origin>/?coin=X&interval=Y`) to the chart UI (the web app honors these params from Phase 4B).
- **Persistence:** `alerts` table (id, ts, event, identity fields, plan JSON, confidence, sinks delivered) in the existing SQLite db.

### Reliability & ops

- **State:** SQLite is the only durable state (candles, alerts, dedupe). Everything in memory rebuilds on boot: gap-fill → first scan cycle repopulates rankings.
- **Watchdog:** in-process; exits deliberately if WS is dead >5 min despite reconnects or the event loop stalls (timer-skew detector). launchd `KeepAlive` restarts it; restart is the recovery path.
- **launchd:** documented plist (RunAtLoad + KeepAlive) running the server under `caffeinate -s`; setup instructions in `docs/ops-mac.md`, including `pmset` notes. Design stays env-portable (no macOS-only code paths in the engine itself) for a later VPS move.
- **Logging:** structured (pino or equivalent) to `data/logs/engine.log`, size-capped rotation (e.g. 20MB × 5 files). Health transitions, scan latencies, sink failures, watchdog exits.
- **Config:** `engine.json` at repo root (universe cap, timeframes, alert thresholds, tick-throttle values, worker count, sink toggles, and the analysis knobs the UI settings strip exposes: gate minTrades/minExpectancy/topN, window, confluenceWindow, minRR, volumeSpikeK) + secrets via env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`). Read at boot; restart to apply.

## Error handling

- WS errors/disconnects → reconnect loop + gap-fill (never crash on feed errors).
- REST errors during backfill/gap-fill → existing client retry/backoff; a coin that repeatedly fails is marked degraded, skipped, retried on a 5-min cycle, logged.
- Worker crash → pool respawns the worker, in-flight job re-queued once, then dropped + logged.
- Sink errors → per-sink retry then drop (alert still persisted in SQLite with delivery status).
- Malformed WS messages → logged + skipped, never throw on the hot path.

## Testing

- **Unit:** aggregator (15m→1h/4h/1d boundaries, partial windows after gaps), scheduler (coalescing, priority, provisional throttle), AlertEngine (thresholds, identity dedupe incl. restart-persistence, cooldown, burst digest, provisional lifecycle), sinks (mocked HTTP/exec; retry/never-block), latency instrumentation, candleSnapshot weight accounting.
- **Integration:** fake HL WS server replays a scripted sequence (ticks, candle closes, a disconnect) against a real engine instance with mocked sinks → assert exact alert output, including provisional→withdrawn and reconnect gap-fill (REST mocked).
- **Live e2e:** `e2e/phase4a.mjs` boots the real engine on a reduced universe (top ~20 coins, 15m+1h), waits for first scan cycle, asserts: ticks flowing, scans within budget, alert rows persisted (sinks log-only), warm restart resumes. Follows the phase 2/3 e2e harness patterns.

## Out of scope (deferred)

- **Phase 4B** (next spec): nightly walk-forward MA optimizer, SSE live dashboard (live scanner, alert feed, health chip), `@fastify/static` serving of the built web app, web `?coin=&interval=` deep-link parsing.
- **Phase 5:** trade execution (wallet signing, order lifecycle, risk limits, kill switch, paper mode). This spec's plan output (entry/stop/target/R:R/confidence) is the execution input contract.
- Plan lifecycle alerts (entry filled / stop / target) and engine-health push alerts.
- Quiet hours.
- Rust kernel port (triggered only by documented budget breach).
