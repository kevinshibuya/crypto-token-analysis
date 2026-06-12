# CTA Engine — macOS 24/7 Operations Runbook

Tested on macOS 14+ (Sonoma / Sequoia). All commands run from the repo root unless noted.

---

## 1. Install the launchd service

The plist uses `__REPO_PATH__` and `__NODE_BIN__` placeholders so it can live in source control
without secrets or machine-specific paths.

> **The repo must NOT live under `~/Desktop`, `~/Documents`, or `~/Downloads`** — those folders
> are TCC-protected and launchd background jobs are silently denied access to them
> (`Operation not permitted`). Terminal's Full Disk Access does not apply: launchd agents are
> spawned by launchd, outside Terminal's process tree.

```bash
# Expand the placeholders (repo path + the dir containing node/pnpm), then install
sed -e "s|__REPO_PATH__|$(pwd)|g" \
    -e "s|__NODE_BIN__|$(dirname "$(which pnpm)")|g" \
    ops/com.cta.engine.plist \
  > ~/Library/LaunchAgents/com.cta.engine.plist
```

Open the installed copy in your editor and fill in the secret strings (never commit them):

```bash
# Telegram sink — both must be non-empty to enable
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>

# Discord sink — must be non-empty to enable
DISCORD_WEBHOOK_URL=<your-webhook-url>
```

Then lint the file to catch XML typos before load:

```bash
plutil -lint ~/Library/LaunchAgents/com.cta.engine.plist
# Expected output: ~/Library/LaunchAgents/com.cta.engine.plist: OK
```

---

## 2. Start / stop / restart

**Start (bootstrap into the current login session):**

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cta.engine.plist
```

**Stop (bootout — also disables auto-start until next bootstrap):**

```bash
launchctl bootout gui/$(id -u)/com.cta.engine
```

**Restart:**

```bash
launchctl bootout gui/$(id -u)/com.cta.engine
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cta.engine.plist
```

**Inspect service state:**

```bash
launchctl print gui/$(id -u)/com.cta.engine | head -30
```

---

## 3. Sleep prevention

The plist wraps the process in `caffeinate -s`, which blocks system sleep while the engine runs on AC power. For fully unattended operation also apply:

```bash
# Disable automatic sleep on AC; allow display to sleep after 10 min
sudo pmset -c sleep 0 displaysleep 10
```

And in **System Settings → Battery → Power Adapter**, enable "Prevent automatic sleeping on power adapter when the display is off".

> **Lid-closed operation** requires AC power to be connected. The `caffeinate -s` flag only prevents sleep when on AC; on battery the Mac may sleep regardless.

---

## 4. Crash recovery semantics

`KeepAlive = true` in the plist means launchd restarts the process on any exit. The watchdog deliberately exits to trigger this recovery — **but only when `ENGINE_SUPERVISED=1`** (the plist sets it; manual terminal runs leave it unset):

- **Exit 1** — WebSocket dead beyond `wsDeadExitMs` (default 5 minutes), measured from the later of the last received WS message **or** the watchdog's own start time. The start-time baseline prevents spurious exits at cold boot before the first message arrives.
- **Exit 2** — Event-loop stall detected via timer-skew signature. Note this signature is also produced by OS-level process freezes (system sleep, App Nap, swap-thrash on a memory-pressured machine) — under launchd the restart absorbs them either way.

When unsupervised (manual `pnpm --filter @cta/server start` in a terminal), the watchdog logs the same conditions as fatals but keeps the process alive: the WS layer self-reconnects on its own, and exiting without a supervisor would just leave the server dead.

On restart the engine gap-fills its state from SQLite within seconds — no full historical backfill needed.

---

## 5. Health check

**Route: `/api/health`** (not `/health` — that path is not registered).

```bash
# Replace 3001 with the value of PORT if you customise it
curl -s localhost:3001/api/health | python3 -m json.tool
```

### Response fields

| Field | Meaning |
|-------|---------|
| `status` | `"ok"` when engine is running |
| `uptimeSec` | Seconds since the server process started |
| `engine.wsConnected` | Whether the Hyperliquid WS is currently open |
| `engine.lastTickAgeMs` | Milliseconds since the last price tick was processed |
| `engine.queueDepth` | Coins waiting in the scan queue |
| `engine.busyWorkers` | Analysis workers currently occupied |
| `engine.coinsTracked` | Coins under management: live (seeded + subscribed) + degraded (backfill pending retry) |
| `engine.coinsLive` | Coins that are seeded and subscribed (live data flowing) |
| `engine.scansCompleted` | Total analysis passes since boot |
| `engine.latencies.p50` | Median scan latency (ms) |
| `engine.latencies.p95` | 95th-percentile scan latency (ms) |
| `engine.latencies.count` | Total latency samples recorded |

### Logs

Structured engine logs are written with `pino-roll` rotation to:

```
data/logs/engine.log        # current file
data/logs/engine.log.*      # up to 4 rotated files (20 MB each, 5 files total)
```

launchd stdout/stderr (startup errors, `console.log`) go to:

```
data/logs/launchd.out.log
data/logs/launchd.err.log
```

---

## 6. Configuration

Copy the example config and edit before first run:

```bash
cp engine.json.example engine.json
# Edit engine.json, then restart to apply
launchctl bootout gui/$(id -u)/com.cta.engine
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cta.engine.plist
```

### Environment variable reference

Only these variables are read by the engine at boot. All have defaults and are optional unless noted.

| Variable | Default | Meaning |
|----------|---------|---------|
| `ENGINE_ENABLED` | _(unset = disabled)_ | Set to `1` to enable the engine; without this the server starts without scanning |
| `ENGINE_LOG_DIR` | `data/logs` | Directory for engine log files |
| `ENGINE_CONFIG` | `engine.json` | Path to the JSON config file |
| `ENGINE_UNIVERSE_CAP` | `0` (all coins) | Maximum number of coins to track; `0` = no cap |
| `ENGINE_WORKERS` | CPU count − 2 | Number of parallel analysis worker threads |
| `ENGINE_TIMEFRAMES` | `15m,1h,4h,1d` | Comma-separated list of timeframes to analyse; must include `15m` |
| `ENGINE_WEB_ORIGIN` | `http://localhost:5173` (set to `http://localhost:3001` for production) | Base URL for deep-links in alert notifications; should point at the server origin (3001), not the vite dev server (5173). `engine.json.example` already sets `webOrigin` to 3001 |
| `ENGINE_MACOS_NOTIFY` | _(unset = disabled)_ | Set to `1` to enable macOS system notifications (no secret needed) |
| `TELEGRAM_BOT_TOKEN` | _(empty = disabled)_ | Telegram bot token; both this and `TELEGRAM_CHAT_ID` must be non-empty |
| `TELEGRAM_CHAT_ID` | _(empty = disabled)_ | Telegram chat or channel ID |
| `DISCORD_WEBHOOK_URL` | _(empty = disabled)_ | Discord incoming webhook URL |
| `PORT` | `3001` | HTTP port the Fastify server binds to |

---

## 7. Dashboard (Phase 4B)

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

> **Note:** A full-universe manual optimizer trigger can run for many minutes — when triggering manually over the full universe, use a generous client timeout (e.g. `curl --max-time 0`) or pass an explicit `coins` list.

---

## 8. VPS / Linux portability

The engine has no macOS-only code paths — the macOS notifications sink (`MacosSink`) degrades gracefully when `osascript` is unavailable. To run on a Linux VPS:

- Replace the plist with a **systemd unit**:
  - `KeepAlive = true` → `Restart=always`
  - `caffeinate -s` → remove (no equivalent needed; Linux servers don't sleep)
- Set `ENGINE_MACOS_NOTIFY` to `0` or leave it unset (no effect on Linux either way)
- Everything else — SQLite, pino logs, WS watchdog — works identically
