# Hyperliquid Token Analysis — Phase 1 (Foundation) Design

- **Date:** 2026-06-09
- **Status:** Approved (brainstorming complete)
- **Data source:** [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) — [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

## 1. Context & Goal

Build a system that analyzes coin pairs on the Hyperliquid DEX — volume, RSI, moving averages, candle/indicator pattern recognition — and backtests combinations of these indicators to validate the best-performing setups per pair, ultimately producing entries, stop-losses, and exits with risk/reward and a confidence score derived from how reliably patterns recur and how well backtest conditions correlate with the current market.

That full vision is large. It decomposes into **three phases**, each delivering something usable on its own. **This spec covers Phase 1 only** — the foundation that de-risks the Hyperliquid data pipeline and gives an immediately useful charting/analysis tool to build the brains on top of.

## 2. Roadmap & Scope

| Phase | Theme | Contents |
|------|-------|----------|
| **1 (this spec)** | Foundation | Data layer (Hyperliquid client + cache + rate limiter), indicators (RSI, SMA, EMA, volume), volume-based support/resistance, chart UI |
| 2 | Analysis | Candlestick + indicator pattern recognition; backtesting engine (indicator/pattern combos, run in isolation **and** combined; performance stats) |
| 3 | Decisions | Signal generation (entries/stops/exits across timeframes; R/R sized from backtest); confidence via recurring-pattern reliability; correlation of backtest conditions vs. current market (live data) |

**In scope (Phase 1)**

- Hyperliquid **perps only** (USD-margined). `meta`-driven market list.
- Paginating candle client (past the 5000/request cap) + on-disk **SQLite** cache + weight-aware rate limiter.
- On-demand data refresh (no live streaming yet).
- Indicators: **RSI**, **SMA**, **EMA**, **volume** (+ volume SMA).
- Volume-based S/R via **both** a volume profile (POC + value area) **and** volume-weighted swing pivots.
- All **14** Hyperliquid intervals.
- Web UI: searchable market picker, timeframe selector, candlestick chart with overlays + volume + RSI panes, indicator config drawer.

**Out of scope (Phase 1 → deferred to Phase 2/3)**

- Pattern recognition, backtesting engine, signal/entry/stop/exit generation, risk/reward, confidence/correlation scoring.
- Live WebSocket streaming.
- Spot markets and synthetic cross pairs (e.g. BTC/ETH ratio).

## 3. Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Markets | Perps only (USD-margined) | Simplest, most liquid; maps directly to `candleSnapshot`. Spot/crosses deferred. |
| Architecture | pnpm monorepo: Node/Fastify backend + React frontend + shared core package | Centralizes rate-limit budget & caching; scales to heavy Phase 2/3 backtesting; core math reusable. |
| History | Paginating client + on-disk SQLite cache | The foundation Phase 1 exists to de-risk; backtesting later just bumps the lookback. |
| Freshness | On-demand refresh (WebSocket later) | Live ticks only matter for Phase 3 "current conditions" correlation. |
| Moving averages | SMA + EMA (any period, multiple) | Covers the vast majority of MA analysis. VWAP deferred. |
| Support/Resistance | Volume profile **and** volume-weighted pivots | User wants to compare both methods. |
| Volume distribution | Uniform across each candle's `[low, high]` | Standard OHLCV approximation; smoother profile. |
| Profile/S-R window | The loaded candle range | Profile reflects exactly what's on screen. |
| Timeframes | All 14 Hyperliquid intervals | Maximum flexibility. |
| Chart library | lightweight-charts (TradingView) | Best candlestick UX; volume profile via a small custom overlay. |
| Compute location | Backend computes indicators/S-R; frontend renders | Consistent with backend-owns-compute; sets up Phase 2. |
| UI layout | "A" — slim top toolbar, chart-forward, right indicator drawer | Maximizes chart space. |
| Backend framework | Fastify (TypeScript) | Fast, first-class TS + schema validation; good home for Phase 2/3 endpoints. |
| Monorepo tooling | pnpm workspaces | Fast, disk-efficient, low ceremony for 3 packages. |
| Tests | Vitest, TDD | Fits the Vite/TS ecosystem. |

## 4. Architecture

pnpm monorepo with three packages. Requests flow frontend → backend → Hyperliquid; candle data flows back and is cached on the way.

```
apps/web (React + Vite + Tailwind, lightweight-charts)   — pure renderer
        │  HTTP JSON: GET /api/markets, POST /api/analysis, GET /api/health
        ▼
apps/server (Fastify, TypeScript)
   ├─ routes/controllers  ── call ──▶ packages/core (compute)
   └─ data service
        ├─ rate limiter (token bucket, 1200 weight/min)
        ├─ Hyperliquid client (POST /info: candleSnapshot paginated, meta)
        └─ SQLite candle cache (incremental)
        │  POST https://api.hyperliquid.xyz/info
        ▼
Hyperliquid API  (candleSnapshot ≤5000/req, 14 intervals; meta = perp list)

packages/core (pure TypeScript, no I/O, unit-tested)
   RSI · SMA · EMA · Volume Profile · Volume-weighted pivots
   (the same math the Phase 2 backtester will reuse)
```

**Package responsibilities**

- `packages/core` — pure functions over candle arrays. No network, no disk. Exhaustively unit-tested. The single source of truth for "the math," shared by the server now and the backtester later.
- `apps/server` — Fastify HTTP API. Owns the Hyperliquid client, rate limiter, SQLite cache, and orchestrates `core` to answer analysis requests.
- `apps/web` — Vite/React/Tailwind UI. Holds no analysis logic; sends config to the API and renders the response with lightweight-charts.

## 5. Data Layer (`apps/server`)

### 5.1 Hyperliquid client

- Single endpoint: `POST https://api.hyperliquid.xyz/info`, `Content-Type: application/json`.
- `meta` → list of perp assets (names + `szDecimals`, `maxLeverage`, etc.).
- `candleSnapshot` → `{ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }`. Returns candles with fields `t` (open ms), `T` (close ms), `o,h,l,c,v`, `n` (trade count), `s`, `i`. **Max 5000 candles per request.**
- **Pagination:** to fetch more than 5000 candles, request in pages using rolling `[startTime, endTime]` windows sized to ≤5000 × interval-duration, walking backward from "now" until the requested lookback (or data start) is reached. De-duplicate on `t`.

### 5.2 SQLite cache

```sql
CREATE TABLE candles (
  coin TEXT, interval TEXT,
  t INTEGER,            -- open time (ms)
  o REAL, h REAL, l REAL, c REAL, v REAL, n INTEGER,
  PRIMARY KEY (coin, interval, t)
);
CREATE TABLE markets (name TEXT PRIMARY KEY, data TEXT, updatedAt INTEGER);
```

- **Incremental fetch:** for a request of the last `lookback` candles up to now — read what's cached, fetch only the missing leading range and the newest segment since the last cached `t`, upsert, then return the requested window from cache.
- "Refresh" forces a top-up of the newest candles for the active `(coin, interval)`.
- DB path: `apps/server/data/cache.sqlite` (gitignored).

### 5.3 Rate limiter

- IP weight budget = **1200/min**. Token bucket: capacity 1200, refill 20 tokens/sec.
- Per-call weight: `candleSnapshot` = `max(1, ceil(candles / 60))` (estimated from the requested window, capped at `ceil(5000/60) = 84` per page); `meta` = 20.
- Acquire estimated weight before each call; block until available. Keep in-flight concurrency low (1–2) for predictable ordering.
- **Backoff:** on HTTP 429 / 5xx / network error → exponential backoff (≈0.5s, 1s, 2s, 4s; ~4 tries) then surface a clear error. If cached data exists, serve it flagged `stale`.

## 6. Core Computations (`packages/core`)

All operate on an ascending-by-time candle array. Defaults in §10.

- **SMA(n)** — mean of the last `n` closes. Undefined for the first `n-1` bars.
- **EMA(n)** — `EMA_t = c_t·k + EMA_{t-1}·(1-k)`, `k = 2/(n+1)`; seeded with `SMA(n)` over the first `n` closes.
- **RSI(n)** — Wilder's smoothing: first `avgGain`/`avgLoss` = simple mean of the first `n` gains/losses; thereafter `avg = (prevAvg·(n-1) + current)/n`; `RS = avgGain/avgLoss`; `RSI = 100 − 100/(1+RS)`.
- **Volume + Volume SMA(m)** — raw per-candle volume (tagged up/down by candle direction) plus an `m`-period SMA of volume to flag spikes.
- **Volume Profile** — over the loaded range, take `[min(low), max(high)]`, split into `rows` equal-price bins. For each candle distribute its volume **uniformly across the bins its `[low, high]` overlaps**, proportional to overlap. Outputs: per-bin volume, **POC** (highest-volume bin), and **value area** = expand outward from the POC adding the higher-volume neighbor until cumulative ≥ 70% of total volume; VA low/high = bounds of included bins.
- **Volume-weighted swing pivots** — pivot high at `i` if `h_i` = max high over `[i-L, i+L]`; pivot low symmetric (`L` = lookback). Strength = volume summed in a window around the pivot. Merge pivots within a price tolerance into one level (sum strength, count touches). Classify support (below current price) / resistance (above). Return the top `maxLevels` by strength.

## 7. API Contract (`apps/server`, Fastify JSON)

### `GET /api/markets`
```json
{ "markets": [ { "name": "BTC", "szDecimals": 5, "maxLeverage": 50 } ], "updatedAt": 1717900000000 }
```

### `POST /api/analysis`
Request:
```json
{
  "coin": "BTC",
  "interval": "1h",
  "lookback": 1000,
  "rsi": { "period": 14 },
  "movingAverages": [ { "type": "EMA", "period": 50 }, { "type": "SMA", "period": 200 } ],
  "volumeProfile": { "rows": 24 },
  "pivots": { "lookback": 5, "maxLevels": 6 }
}
```
Response:
```json
{
  "coin": "BTC", "interval": "1h",
  "candles": [ { "t": 1717900000000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100, "n": 42 } ],
  "rsi": [ { "t": 1717900000000, "value": 53.2 } ],
  "movingAverages": [ { "type": "EMA", "period": 50, "points": [ { "t": 1717900000000, "value": 1.4 } ] } ],
  "volume": { "bars": [ { "t": 1717900000000, "value": 100, "up": true } ], "sma": [ { "t": 1717900000000, "value": 90 } ] },
  "volumeProfile": { "rows": [ { "priceLow": 1, "priceHigh": 1.1, "volume": 500 } ], "poc": 1.05, "valueArea": { "low": 0.9, "high": 1.3 } },
  "pivots": [ { "price": 1.8, "type": "resistance", "strength": 1200, "touches": 3 } ],
  "meta": { "lastUpdated": 1717900000000, "fromCache": true, "stale": false, "candleCount": 1000 }
}
```
Validation: reject unknown intervals/coins and non-positive periods/lookbacks with 400 + a clear message.

### `GET /api/health`
```json
{ "status": "ok", "uptimeSec": 1234, "cache": { "candleRows": 50000 } }
```

## 8. Frontend / UI (`apps/web`, Layout A)

- **State:** selected `coin`, `interval`, indicator config (`rsi.period`, `movingAverages[]`, `volumeProfile.rows`, `pivots`), latest analysis response, loading/error.
- **Data flow:** changing coin/interval → `POST /api/analysis`; config tweaks → debounced re-request. "Refresh" forces a cache top-up.
- **Top toolbar:** searchable perp combobox (from `/api/markets`), 14 timeframe pills, refresh button, status (last updated · cache hit/stale).
- **Chart (lightweight-charts):** candlestick series; one line series per MA; volume histogram in its own pane with the volume-SMA line; RSI line in its own pane with 70/30 reference lines; horizontal price lines for pivots (support/resistance colored); volume profile as a custom right-aligned overlay (POC highlighted, value-area band shaded).
- **Right drawer:** list of active indicators with edit/remove; "add indicator"; controls for RSI period, MA type+period+color, volume-profile rows, pivot lookback/maxLevels.

## 9. Testing Strategy (Vitest, TDD)

- **`packages/core`** — SMA/EMA/RSI against known reference values; volume profile on crafted candles → expected bin volumes, POC, value area; pivots on crafted series → expected levels + merge behavior.
- **`apps/server`** — client pagination (mocked paged fetch → correct rolling windows + dedupe); rate-limiter token math + 429 backoff; cache (first call fetches+stores, second serves cache, refresh tops up newest); API routes via `fastify.inject` (happy paths + validation errors).
- **`apps/web`** — component tests for toolbar/drawer state; chart-mount smoke test. Manual visual verification via the `run` skill.

## 10. Defaults Reference

| Setting | Default |
|--------|---------|
| RSI period / bands | 14 / 70 / 30 |
| Moving averages | none preset (user adds; e.g. EMA 50, SMA 200) |
| Volume SMA period | 20 |
| Volume profile rows | 24 |
| Pivot lookback (each side) | 5 bars |
| Pivot merge tolerance | 0.3% of price |
| Max S/R levels shown | 6 |
| Default candle lookback | 1000 |
| Candles per page (API cap) | 5000 |
| IP weight budget | 1200 / minute |
| Cache DB | `apps/server/data/cache.sqlite` |

## 11. Open Questions / Follow-ups

- **GitHub remote:** create one? Public or private? (Deferred — confirm before any push. Local git repo is initialized now.)
- VWAP, spot markets, and synthetic crosses remain candidate additions once Phase 1 lands.
