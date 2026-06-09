# Hyperliquid Token Analysis

Phase 1 (Foundation): fetch & cache Hyperliquid perp candles, compute RSI / SMA / EMA / volume and
volume-based support/resistance server-side, and chart them in a React UI.

## Structure
- `packages/core` — pure-TS indicator & S/R math (unit-tested)
- `apps/server` — Fastify API: Hyperliquid client, rate limiter, SQLite cache
- `apps/web` — Vite + React + Tailwind UI (lightweight-charts)

## Develop
```bash
pnpm install
pnpm --filter @cta/server start   # API on :3001
pnpm --filter @cta/web dev        # UI on :5173 (proxies /api -> :3001)
```

## Test
```bash
pnpm -r test
```

## Roadmap
- Phase 2: pattern recognition + backtesting engine
- Phase 3: signal generation, confidence & live-market correlation

See `docs/superpowers/specs/2026-06-09-phase1-foundation-design.md`.
