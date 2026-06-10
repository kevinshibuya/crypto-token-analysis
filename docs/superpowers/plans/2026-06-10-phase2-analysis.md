# Phase 2 — Pattern Recognition & Backtesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect candlestick + indicator signals on Hyperliquid pairs and backtest them (singles and pairs) with adaptive structure-based brackets, exposed via `POST /api/backtest` and a new Backtest tab — plus the five Phase 1 polish items.

**Architecture:** All detection and simulation logic is pure functions in `@cta/core` (new `patterns/`, `signals/`, `backtest/` subfolders), exactly like the Phase 1 indicators. `@cta/server` orchestrates (candles → DetectorContext → scan) and caches results in the existing better-sqlite3 db. `@cta/web` adds a Backtest tab and chart markers. Spec: `docs/superpowers/specs/2026-06-10-phase2-analysis-design.md`.

**Tech Stack:** TypeScript 5.4, Vitest 1 (`pnpm --filter <pkg> test`), Fastify 4, better-sqlite3, React 18, lightweight-charts **v4** (do NOT bump to v5), Tailwind. Monorepo via pnpm workspaces; run everything from the repo root.

**Conventions (match Phase 1):** 2-space indent, single quotes, semicolons, compact pure functions. Tests live in `<pkg>/test/*.test.ts`. Candle shorthand factories in tests. Commit after every task with the message given in the task.

---

## File structure

**`packages/core/src`** (new unless marked M = modify)
- `atr.ts` — Wilder ATR
- `intervals.ts` — `SUPPORTED_INTERVALS` + `Interval` (single source of truth)
- `types.ts` (M) — add `SignalDirection`, `SignalKind`, `Signal`
- `detectorContext.ts` — `DetectorOptions`, `DetectorContext`, `alignToCandles`, `buildDetectorContext`, `Detector`
- `patterns/helpers.ts` — candle geometry helpers + named constants
- `patterns/singleCandle.ts` — doji, hammer, shooting star
- `patterns/twoCandle.ts` — engulfing, harami
- `patterns/threeCandle.ts` — morning/evening star, soldiers/crows
- `signals/rsiSignals.ts` — zone exits + divergence
- `signals/maSignals.ts` — MA cross + price-MA cross
- `signals/volumeSignals.ts` — volume spike
- `signals/srSignals.ts` — S/R bounce + break
- `detectors.ts` — `DETECTOR_REGISTRY`, `SIGNAL_KINDS`, `signalFamily`, `detectAll`
- `backtest/bracket.ts` — adaptive bracket computation
- `backtest/simulate.ts` — trade lifecycle simulation
- `backtest/metrics.ts` — aggregate metrics
- `backtest/scan.ts` — singles+pairs scan, ranking, `DEFAULT_BACKTEST_CONFIG`
- `pivots.ts` (M) — `touches` = independent visits
- `index.ts` (M) — export everything new

**`apps/server/src`**
- `config.ts` (M) — re-export intervals from core; `MIN_BACKTEST_CANDLES`, `ROUTE_TIMEOUT_MS`, backtest defaults
- `errors.ts` — `httpError(statusCode, message)`
- `util/withTimeout.ts` — promise timeout → 504
- `hyperliquid/rateLimiter.ts` (M) — serialize `acquire()`
- `hyperliquid/pagination.ts` (M) — `INTERVAL_MS: Record<Interval, number>` (compile-time sync)
- `services/candleService.ts` (M) — `force` option, tail-only backfill
- `services/analysisService.ts` (M) — `signals[]`, 404, force
- `services/backtestService.ts` — orchestration + cache + validation
- `cache/db.ts` (M) — `backtest_results` table
- `cache/backtestStore.ts` — result cache store
- `routes/analysis.ts` (M) — `force` in schema, timeout
- `routes/backtest.ts` — `POST /api/backtest`
- `app.ts` (M), `server.ts` (M) — wiring

**`apps/web`**
- `src/intervals.ts` (M) — re-export from core
- `src/api/types.ts` (M), `src/api/client.ts` (M) — Interval, signals, force, backtest
- `src/signals.ts` — marker labels, `buildMarkers`
- `src/state/useBacktest.ts` — scan request hook
- `src/components/Toolbar.tsx` (M) — tabs
- `src/components/TimeframePills.tsx` (M) — `Interval` typing
- `src/components/Chart.tsx` (M) — `setMarkers`
- `src/components/IndicatorDrawer.tsx` (M) — signal-family toggles
- `src/components/BacktestPanel.tsx`, `src/components/BacktestTable.tsx` — Backtest tab
- `src/App.tsx` (M) — view state, families state
- `public/favicon.svg`, `index.html` (M)
- `e2e/phase2.mjs` (repo root `e2e/`) — browser verification

---

### Task 1: ATR indicator

**Files:**
- Create: `packages/core/src/atr.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/atr.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { atr } from '../src/atr';
import type { Candle } from '../src/types';

const k = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 1 });

describe('atr', () => {
  it('matches a hand-computed Wilder example', () => {
    // TR(i) = max(h-l, |h-prevClose|, |l-prevClose|), from i=1
    const candles = [
      k(1, 10, 11, 9, 10),      // seed (prev close 10)
      k(2, 10, 12, 10, 11),     // TR = max(2, 2, 0)  = 2
      k(3, 11, 13, 10, 12),     // TR = max(3, 2, 1)  = 3
      k(4, 12, 12.5, 11.5, 12), // TR = max(1, .5, .5) = 1
    ];
    // period 2: first ATR = (2+3)/2 = 2.5 @ t3; next = (2.5*1 + 1)/2 = 1.75 @ t4
    const r = atr(candles, 2);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ t: 3, value: 2.5 });
    expect(r[1].value).toBeCloseTo(1.75, 10);
  });

  it('returns empty when candles <= period', () => {
    expect(atr([k(1, 1, 2, 0, 1), k(2, 1, 2, 0, 1)], 2)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => atr([], 0)).toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test -- atr`
Expected: FAIL — cannot find module `../src/atr`

- [x] **Step 3: Implement**

```ts
// packages/core/src/atr.ts
import type { Candle, IndicatorPoint } from './types';

export function atr(candles: Candle[], period = 14): IndicatorPoint[] {
  if (period <= 0) throw new Error('atr: period must be > 0');
  if (candles.length <= period) return [];

  const tr = (i: number): number => {
    const c = candles[i];
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  };

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  const out: IndicatorPoint[] = [{ t: candles[period].t, value: prev }];
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out.push({ t: candles[i].t, value: prev });
  }
  return out;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { atr } from './atr';
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test -- atr`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/atr.ts packages/core/src/index.ts packages/core/test/atr.test.ts
git commit -m "feat(core): Wilder ATR indicator"
```

---

### Task 2: Shared interval list in core

**Files:**
- Create: `packages/core/src/intervals.ts`
- Modify: `packages/core/src/index.ts`, `apps/server/src/config.ts`, `apps/server/src/hyperliquid/pagination.ts`, `apps/web/src/intervals.ts`, `apps/web/src/api/types.ts`, `apps/web/src/components/TimeframePills.tsx`, `apps/web/src/App.tsx`
- Test: `packages/core/test/intervals.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SUPPORTED_INTERVALS } from '../src/intervals';

describe('SUPPORTED_INTERVALS', () => {
  it('contains the 14 Hyperliquid intervals in ascending order', () => {
    expect(SUPPORTED_INTERVALS).toEqual([
      '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test -- intervals`
Expected: FAIL — cannot find module `../src/intervals`

- [x] **Step 3: Implement and rewire consumers**

```ts
// packages/core/src/intervals.ts
export const SUPPORTED_INTERVALS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
] as const;
export type Interval = (typeof SUPPORTED_INTERVALS)[number];
```

`packages/core/src/index.ts` — add:

```ts
export { SUPPORTED_INTERVALS } from './intervals';
export type { Interval } from './intervals';
```

`apps/server/src/config.ts` — DELETE the local `SUPPORTED_INTERVALS` array and `Interval` type, replace with re-exports (existing imports from `../config` keep working):

```ts
export { SUPPORTED_INTERVALS } from '@cta/core';
export type { Interval } from '@cta/core';
```

`apps/server/src/hyperliquid/pagination.ts` — change the `INTERVAL_MS` declaration so the compiler enforces sync with the shared list (values unchanged):

```ts
import type { Candle, Interval } from '@cta/core';

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};
```

NOTE: `INTERVAL_MS[interval]` lookups in `pagination.ts`/`candleService.ts` index with a `string`; where that now errors, keep the parameter type as `string` and look up via `INTERVAL_MS[interval as Interval]` after the existing `if (!step) throw` guard — runtime behavior unchanged.

`apps/web/src/intervals.ts` — replace entire file:

```ts
export { SUPPORTED_INTERVALS } from '@cta/core';
export type { Interval } from '@cta/core';
```

`apps/web/src/api/types.ts` — type the interval (add import + change one field):

```ts
import type { Interval } from '@cta/core';
// in AnalysisConfig:
  interval: Interval;
```

Also re-export it for app code: add `export type { Interval };` near the other re-exports.

`apps/web/src/components/TimeframePills.tsx` — replace entire file (only types change):

```tsx
import { SUPPORTED_INTERVALS } from '../intervals';
import type { Interval } from '../intervals';

export function TimeframePills({ value, onChange }: { value: Interval; onChange: (i: Interval) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SUPPORTED_INTERVALS.map((i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`rounded px-2 py-1 text-xs ${
            i === value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/App.tsx` — the `Toolbar` props flow through: change the Toolbar prop types in `apps/web/src/components/Toolbar.tsx` from `interval: string; onInterval: (i: string) => void;` to:

```ts
import type { Interval } from '../intervals';
// in props:
  interval: Interval;
  onInterval: (i: Interval) => void;
```

(`App.tsx` itself compiles unchanged: `'1h'` narrows to `Interval`, and `setConfig` accepts it because `AnalysisConfig.interval` is now `Interval`.)

- [x] **Step 4: Verify everything still compiles and passes**

Run: `pnpm --filter @cta/core test -- intervals && pnpm --filter @cta/server test && pnpm --filter @cta/web exec tsc --noEmit && pnpm --filter @cta/web test`
Expected: all PASS, no tsc errors

- [x] **Step 5: Commit**

```bash
git add packages/core/src/intervals.ts packages/core/src/index.ts packages/core/test/intervals.test.ts apps/server/src/config.ts apps/server/src/hyperliquid/pagination.ts apps/web/src/intervals.ts apps/web/src/api/types.ts apps/web/src/components/TimeframePills.tsx apps/web/src/components/Toolbar.tsx
git commit -m "refactor: single SUPPORTED_INTERVALS source of truth in @cta/core"
```

---

### Task 3: Signal model, detector context, pattern helpers

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/detectorContext.ts`, `packages/core/src/patterns/helpers.ts`, `packages/core/test/fixtures.ts`
- Test: `packages/core/test/detectorContext.test.ts`

- [x] **Step 1: Add signal types to `packages/core/src/types.ts`** (append at end of file)

```ts
export type SignalDirection = 'bullish' | 'bearish';

export type CandlePatternKind =
  | 'bullish-engulfing' | 'bearish-engulfing'
  | 'hammer' | 'shooting-star' | 'doji'
  | 'morning-star' | 'evening-star'
  | 'three-white-soldiers' | 'three-black-crows'
  | 'bullish-harami' | 'bearish-harami';

export type IndicatorSignalKind =
  | 'rsi-oversold-exit' | 'rsi-overbought-exit'
  | 'rsi-bullish-divergence' | 'rsi-bearish-divergence'
  | 'ma-golden-cross' | 'ma-death-cross'
  | 'price-cross-ma-up' | 'price-cross-ma-down'
  | 'volume-spike-up' | 'volume-spike-down'
  | 'sr-bounce-support' | 'sr-bounce-resistance'
  | 'sr-break-up' | 'sr-break-down';

export type SignalKind = CandlePatternKind | IndicatorSignalKind;

export interface Signal {
  kind: SignalKind;
  direction: SignalDirection;
  index: number; // candle index where the signal completes
  t: number;     // open time of that candle, ms
  meta?: Record<string, number>;
}
```

- [x] **Step 2: Write the failing context test**

```ts
// packages/core/test/detectorContext.test.ts
import { describe, it, expect } from 'vitest';
import { buildDetectorContext, alignToCandles, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import type { Candle } from '../src/types';

const k = (t: number, c: number): Candle => ({ t, o: c, h: c + 1, l: c - 1, c, v: 5 });

describe('alignToCandles', () => {
  it('pads missing leading values with NaN and aligns by t', () => {
    const candles = [k(1, 10), k(2, 11), k(3, 12)];
    const out = alignToCandles(candles, [{ t: 2, value: 7 }, { t: 3, value: 8 }]);
    expect(out).toHaveLength(3);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(7);
    expect(out[2]).toBe(8);
  });
});

describe('buildDetectorContext', () => {
  it('produces candle-aligned arrays for every indicator', () => {
    const candles = Array.from({ length: 30 }, (_, i) => k(i + 1, 100 + Math.sin(i) * 5));
    const ctx = buildDetectorContext(candles, {
      ...DEFAULT_DETECTOR_OPTIONS,
      maFast: { type: 'EMA', period: 3 },
      maSlow: { type: 'SMA', period: 5 },
      rsiPeriod: 3,
      atrPeriod: 3,
      volumeSmaPeriod: 3,
    });
    for (const arr of [ctx.rsi, ctx.maFast, ctx.maSlow, ctx.volumeSma, ctx.atr]) {
      expect(arr).toHaveLength(30);
      expect(Number.isNaN(arr[0])).toBe(true);          // warmup gap
      expect(Number.isFinite(arr[29])).toBe(true);      // tail filled
    }
    expect(ctx.opts.rsiPeriod).toBe(3);
  });
});
```

Run: `pnpm --filter @cta/core test -- detectorContext` — Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/detectorContext.ts`**

```ts
import type { Candle, IndicatorPoint, MaType, PivotLevel, Signal } from './types';
import { sma } from './sma';
import { ema } from './ema';
import { rsi } from './rsi';
import { volume } from './volume';
import { atr } from './atr';
import { pivots, type PivotOptions } from './pivots';

export interface MaSpec { type: MaType; period: number }

export interface DetectorOptions {
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  divergenceSwing: number;     // bars each side defining a swing point
  divergenceLookback: number;  // max bars between compared swings
  maFast: MaSpec;
  maSlow: MaSpec;
  volumeSmaPeriod: number;
  volumeSpikeK: number;        // spike when v > k * volumeSma
  atrPeriod: number;
  srTolAtrMult: number;        // S/R touch tolerance in ATRs
  pivots: PivotOptions;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  divergenceSwing: 3, divergenceLookback: 60,
  maFast: { type: 'EMA', period: 50 }, maSlow: { type: 'SMA', period: 200 },
  volumeSmaPeriod: 20, volumeSpikeK: 2, atrPeriod: 14, srTolAtrMult: 0.25,
  pivots: { lookback: 5, maxLevels: 6, mergeTolerance: 0.003 },
};

export interface DetectorContext {
  rsi: number[];       // all aligned to candles, NaN where undefined
  maFast: number[];
  maSlow: number[];
  volumeSma: number[];
  atr: number[];
  pivots: PivotLevel[];
  opts: DetectorOptions;
}

export type Detector = (candles: Candle[], ctx: DetectorContext) => Signal[];

export function alignToCandles(candles: Candle[], points: IndicatorPoint[]): number[] {
  const byT = new Map(points.map((p) => [p.t, p.value]));
  return candles.map((c) => byT.get(c.t) ?? NaN);
}

const maPoints = (candles: Candle[], spec: MaSpec): IndicatorPoint[] =>
  spec.type === 'SMA' ? sma(candles, spec.period) : ema(candles, spec.period);

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
    opts,
  };
}
```

- [x] **Step 4: Implement `packages/core/src/patterns/helpers.ts`**

```ts
import type { Candle } from '../types';

export const DOJI_BODY_MAX_RATIO = 0.1;     // doji: body <= 10% of range
export const WICK_BODY_MULT = 2;            // hammer/star: dominant wick >= 2x body
export const SMALL_BODY_MAX_RATIO = 0.35;   // hammer/star: body <= 35% of range
export const STAR_MID_BODY_MAX_RATIO = 0.5; // star middle body <= 50% of first body
export const LONG_BODY_MIN_RATIO = 0.6;     // "long" candle: body >= 60% of range

export const body = (c: Candle): number => Math.abs(c.c - c.o);
export const range = (c: Candle): number => c.h - c.l;
export const upperWick = (c: Candle): number => c.h - Math.max(c.o, c.c);
export const lowerWick = (c: Candle): number => Math.min(c.o, c.c) - c.l;
export const isBull = (c: Candle): boolean => c.c > c.o;
export const isBear = (c: Candle): boolean => c.c < c.o;
export const isLongBody = (c: Candle): boolean => range(c) > 0 && body(c) >= LONG_BODY_MIN_RATIO * range(c);
```

- [x] **Step 5: Create the shared test fixture helper `packages/core/test/fixtures.ts`**

```ts
import type { Candle } from '../src/types';
import { DEFAULT_DETECTOR_OPTIONS, type DetectorContext, type DetectorOptions } from '../src/detectorContext';

export const candle = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle =>
  ({ t, o, h, l, c, v });

/** Hand-built context: detectors read indicator values from here, so tests
 *  control them directly instead of reverse-engineering real RSI/MA inputs. */
export function ctxWith(
  partial: Partial<DetectorContext> = {},
  opts: Partial<DetectorOptions> = {},
): DetectorContext {
  return {
    rsi: [], maFast: [], maSlow: [], volumeSma: [], atr: [], pivots: [],
    ...partial,
    opts: { ...DEFAULT_DETECTOR_OPTIONS, ...opts },
  };
}
```

- [x] **Step 6: Export from `packages/core/src/index.ts`** (append)

```ts
export {
  buildDetectorContext, alignToCandles, DEFAULT_DETECTOR_OPTIONS,
} from './detectorContext';
export type { DetectorContext, DetectorOptions, Detector, MaSpec } from './detectorContext';
```

- [x] **Step 7: Run tests**

Run: `pnpm --filter @cta/core test`
Expected: all PASS (including the new detectorContext tests)

- [x] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/detectorContext.ts packages/core/src/patterns/helpers.ts packages/core/src/index.ts packages/core/test/fixtures.ts packages/core/test/detectorContext.test.ts
git commit -m "feat(core): signal model, detector context, candle geometry helpers"
```

---

### Task 4: Single-candle patterns (doji, hammer, shooting star)

**Files:**
- Create: `packages/core/src/patterns/singleCandle.ts`
- Test: `packages/core/test/singleCandle.test.ts`

Definitions (geometry only — the backtest judges usefulness):
- **doji** — `body <= 0.1 * range`; direction is the *reversal* of the previous candle (prev bull → bearish doji signal, prev bear → bullish); skipped at index 0 or when prev candle is flat.
- **hammer** (bullish) — not a doji, `body <= 0.35 * range`, `lowerWick >= 2 * body`, `upperWick <= body`.
- **shooting-star** (bearish) — mirror: `upperWick >= 2 * body`, `lowerWick <= body`.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectDoji, detectHammer, detectShootingStar } from '../src/patterns/singleCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectDoji', () => {
  it('flags a doji after a bull candle as bearish', () => {
    const candles = [candle(1, 10, 11, 9.5, 11), candle(2, 10.5, 11, 10, 10.52)];
    const s = detectDoji(candles, ctx);
    expect(s).toEqual([{ kind: 'doji', direction: 'bearish', index: 1, t: 2 }]);
  });
  it('ignores a candle whose body exceeds 10% of range', () => {
    const candles = [candle(1, 10, 11, 9.5, 11), candle(2, 10.5, 11, 10, 10.7)];
    expect(detectDoji(candles, ctx)).toEqual([]);
  });
});

describe('detectHammer', () => {
  it('flags a long lower wick with tiny upper wick as bullish', () => {
    // range 1, body .15, lowerWick .8, upperWick .05
    const candles = [candle(1, 9.8, 10, 9, 9.95)];
    const s = detectHammer(candles, ctx);
    expect(s).toEqual([{ kind: 'hammer', direction: 'bullish', index: 0, t: 1 }]);
  });
  it('rejects when the upper wick is larger than the body', () => {
    // upperWick .3 > body .15
    const candles = [candle(1, 9.5, 9.95, 9, 9.65)];
    expect(detectHammer(candles, ctx)).toEqual([]);
  });
});

describe('detectShootingStar', () => {
  it('flags a long upper wick as bearish', () => {
    // mirror of the hammer: body .15 at the bottom, upperWick .8
    const candles = [candle(1, 9.2, 10, 9, 9.05)];
    const s = detectShootingStar(candles, ctx);
    expect(s).toEqual([{ kind: 'shooting-star', direction: 'bearish', index: 0, t: 1 }]);
  });
  it('rejects a doji-sized body', () => {
    const candles = [candle(1, 9.24, 10, 9.2, 9.2)];
    expect(detectShootingStar(candles, ctx)).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- singleCandle`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/patterns/singleCandle.ts`**

```ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import {
  body, range, upperWick, lowerWick, isBull, isBear,
  DOJI_BODY_MAX_RATIO, WICK_BODY_MULT, SMALL_BODY_MAX_RATIO,
} from './helpers';

export function detectDoji(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const r = range(c);
    if (r <= 0 || body(c) > DOJI_BODY_MAX_RATIO * r) continue;
    const prev = candles[i - 1];
    if (isBull(prev)) out.push({ kind: 'doji', direction: 'bearish', index: i, t: c.t });
    else if (isBear(prev)) out.push({ kind: 'doji', direction: 'bullish', index: i, t: c.t });
  }
  return out;
}

const smallBodyAt = (c: Candle): boolean => {
  const r = range(c);
  const b = body(c);
  return r > 0 && b > DOJI_BODY_MAX_RATIO * r && b <= SMALL_BODY_MAX_RATIO * r;
};

export function detectHammer(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!smallBodyAt(c)) continue;
    if (lowerWick(c) >= WICK_BODY_MULT * body(c) && upperWick(c) <= body(c)) {
      out.push({ kind: 'hammer', direction: 'bullish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectShootingStar(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!smallBodyAt(c)) continue;
    if (upperWick(c) >= WICK_BODY_MULT * body(c) && lowerWick(c) <= body(c)) {
      out.push({ kind: 'shooting-star', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- singleCandle`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/patterns/singleCandle.ts packages/core/test/singleCandle.test.ts
git commit -m "feat(core): doji, hammer, shooting-star detectors"
```

---

### Task 5: Two-candle patterns (engulfing, harami)

**Files:**
- Create: `packages/core/src/patterns/twoCandle.ts`
- Test: `packages/core/test/twoCandle.test.ts`

Definitions:
- **bullish-engulfing** — prev bear, cur bull, cur body covers prev body (`o <= prev.c && c >= prev.o`), cur body strictly larger.
- **bearish-engulfing** — mirror.
- **bullish-harami** — prev bear with long body, cur bull strictly inside prev body (`o > prev.c && c < prev.o`).
- **bearish-harami** — prev bull with long body, cur bear strictly inside (`o < prev.c && c > prev.o`).

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectEngulfing, detectHarami } from '../src/patterns/twoCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectEngulfing', () => {
  it('flags a bullish engulfing', () => {
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.4, 10.6, 9.3, 10.5)];
    expect(detectEngulfing(candles, ctx)).toEqual([
      { kind: 'bullish-engulfing', direction: 'bullish', index: 1, t: 2 },
    ]);
  });
  it('flags a bearish engulfing', () => {
    const candles = [candle(1, 9.5, 10.1, 9.4, 10), candle(2, 10.1, 10.2, 9.3, 9.4)];
    expect(detectEngulfing(candles, ctx)).toEqual([
      { kind: 'bearish-engulfing', direction: 'bearish', index: 1, t: 2 },
    ]);
  });
  it('rejects when the second body does not cover the first', () => {
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.6, 10.0, 9.5, 9.9)];
    expect(detectEngulfing(candles, ctx)).toEqual([]);
  });
});

describe('detectHarami', () => {
  it('flags a bullish harami inside a long bear body', () => {
    // prev: body 1.0 of range 1.2 (long); cur bull inside [9, 10]
    const candles = [candle(1, 10, 10.1, 8.9, 9), candle(2, 9.3, 9.8, 9.2, 9.7)];
    expect(detectHarami(candles, ctx)).toEqual([
      { kind: 'bullish-harami', direction: 'bullish', index: 1, t: 2 },
    ]);
  });
  it('flags a bearish harami inside a long bull body', () => {
    const candles = [candle(1, 9, 10.1, 8.9, 10), candle(2, 9.7, 9.8, 9.2, 9.3)];
    expect(detectHarami(candles, ctx)).toEqual([
      { kind: 'bearish-harami', direction: 'bearish', index: 1, t: 2 },
    ]);
  });
  it('rejects when the first body is not long', () => {
    // prev body .2 of range 1.2 — not >= 60%
    const candles = [candle(1, 9.3, 10, 8.8, 9.1), candle(2, 9.15, 9.3, 9.1, 9.25)];
    expect(detectHarami(candles, ctx)).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- twoCandle`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/patterns/twoCandle.ts`**

```ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import { body, isBull, isBear, isLongBody } from './helpers';

export function detectEngulfing(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    if (isBear(p) && isBull(c) && c.o <= p.c && c.c >= p.o && body(c) > body(p)) {
      out.push({ kind: 'bullish-engulfing', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(p) && isBear(c) && c.o >= p.c && c.c <= p.o && body(c) > body(p)) {
      out.push({ kind: 'bearish-engulfing', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectHarami(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    if (!isLongBody(p)) continue;
    if (isBear(p) && isBull(c) && c.o > p.c && c.c < p.o) {
      out.push({ kind: 'bullish-harami', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(p) && isBear(c) && c.o < p.c && c.c > p.o) {
      out.push({ kind: 'bearish-harami', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- twoCandle`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/patterns/twoCandle.ts packages/core/test/twoCandle.test.ts
git commit -m "feat(core): engulfing and harami detectors"
```

---

### Task 6: Three-candle patterns (stars, soldiers, crows)

**Files:**
- Create: `packages/core/src/patterns/threeCandle.ts`
- Test: `packages/core/test/threeCandle.test.ts`

Definitions (signal emitted at the third candle's index):
- **morning-star** — A long bear; B small body (`body(B) <= 0.5 * body(A)`); C bull closing at/above the midpoint of A's body.
- **evening-star** — mirror.
- **three-white-soldiers** — three consecutive long-body bulls, each close > prev close, each open inside the prev body.
- **three-black-crows** — mirror.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectStars, detectSoldiersCrows } from '../src/patterns/threeCandle';
import { candle, ctxWith } from './fixtures';

const ctx = ctxWith();

describe('detectStars', () => {
  it('flags a morning star', () => {
    const candles = [
      candle(1, 10, 10.1, 8.9, 9),       // long bear, body 1, midpoint 9.5
      candle(2, 8.9, 9.2, 8.7, 9.1),     // small body .2
      candle(3, 9.1, 9.8, 9.0, 9.7),     // bull closing above 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([
      { kind: 'morning-star', direction: 'bullish', index: 2, t: 3 },
    ]);
  });
  it('flags an evening star', () => {
    const candles = [
      candle(1, 9, 10.1, 8.9, 10),       // long bull, midpoint 9.5
      candle(2, 10.1, 10.3, 9.9, 10.2),  // small body
      candle(3, 10, 10.1, 9.2, 9.3),     // bear closing below 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([
      { kind: 'evening-star', direction: 'bearish', index: 2, t: 3 },
    ]);
  });
  it('rejects when the third candle stops short of the midpoint', () => {
    const candles = [
      candle(1, 10, 10.1, 8.9, 9),
      candle(2, 8.9, 9.2, 8.7, 9.1),
      candle(3, 9.1, 9.4, 9.0, 9.3),     // 9.3 < 9.5
    ];
    expect(detectStars(candles, ctx)).toEqual([]);
  });
});

describe('detectSoldiersCrows', () => {
  it('flags three white soldiers', () => {
    const candles = [
      candle(1, 9.0, 9.6, 8.95, 9.5),    // bull, body .5 / range .65
      candle(2, 9.3, 10.1, 9.25, 10.0),  // opens inside [9.0, 9.5], closes higher
      candle(3, 9.8, 10.6, 9.75, 10.5),  // opens inside [9.3, 10.0], closes higher
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([
      { kind: 'three-white-soldiers', direction: 'bullish', index: 2, t: 3 },
    ]);
  });
  it('flags three black crows', () => {
    const candles = [
      candle(1, 10.5, 10.55, 9.9, 10.0),
      candle(2, 10.2, 10.25, 9.4, 9.5),
      candle(3, 9.7, 9.75, 8.9, 9.0),
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([
      { kind: 'three-black-crows', direction: 'bearish', index: 2, t: 3 },
    ]);
  });
  it('rejects when an open gaps outside the previous body', () => {
    const candles = [
      candle(1, 9.0, 9.6, 8.95, 9.5),
      candle(2, 9.55, 10.1, 9.5, 10.0),  // opens above prev close 9.5 — gap, not inside
      candle(3, 9.8, 10.6, 9.75, 10.5),
    ];
    expect(detectSoldiersCrows(candles, ctx)).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- threeCandle`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/patterns/threeCandle.ts`**

```ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';
import { body, isBull, isBear, isLongBody, STAR_MID_BODY_MAX_RATIO } from './helpers';

export function detectStars(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];
    if (body(b) > STAR_MID_BODY_MAX_RATIO * body(a)) continue;
    const mid = (a.o + a.c) / 2;
    if (isBear(a) && isLongBody(a) && isBull(c) && c.c >= mid) {
      out.push({ kind: 'morning-star', direction: 'bullish', index: i, t: c.t });
    } else if (isBull(a) && isLongBody(a) && isBear(c) && c.c <= mid) {
      out.push({ kind: 'evening-star', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}

export function detectSoldiersCrows(candles: Candle[], _ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (let i = 2; i < candles.length; i++) {
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    const allBull = [a, b, c].every((x) => isBull(x) && isLongBody(x));
    const allBear = [a, b, c].every((x) => isBear(x) && isLongBody(x));
    if (allBull
      && b.c > a.c && c.c > b.c
      && b.o >= a.o && b.o <= a.c
      && c.o >= b.o && c.o <= b.c) {
      out.push({ kind: 'three-white-soldiers', direction: 'bullish', index: i, t: c.t });
    } else if (allBear
      && b.c < a.c && c.c < b.c
      && b.o <= a.o && b.o >= a.c
      && c.o <= b.o && c.o >= b.c) {
      out.push({ kind: 'three-black-crows', direction: 'bearish', index: i, t: c.t });
    }
  }
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- threeCandle`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/patterns/threeCandle.ts packages/core/test/threeCandle.test.ts
git commit -m "feat(core): star, soldiers and crows detectors"
```

---

### Task 7: RSI signals (zone exits + divergence)

**Files:**
- Create: `packages/core/src/signals/rsiSignals.ts`
- Test: `packages/core/test/rsiSignals.test.ts`

Definitions:
- **rsi-oversold-exit** (bullish) — `rsi[i-1] < oversold && rsi[i] >= oversold`.
- **rsi-overbought-exit** (bearish) — `rsi[i-1] > overbought && rsi[i] <= overbought`.
- **Divergence** — swing low at `j` when `l[j]` is strictly the lowest among `l[j-w .. j+w]` (w = `divergenceSwing`); confirmed (signal emitted) at `j + w`. For two consecutive swing lows `j1 < j2` no more than `divergenceLookback` bars apart: price lower low + RSI higher low → **rsi-bullish-divergence** at `j2 + w`. Swing highs mirror for **rsi-bearish-divergence**. `meta = { prevIndex: j1, curIndex: j2 }`.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectRsiZoneExits, detectRsiDivergence } from '../src/signals/rsiSignals';
import { candle, ctxWith } from './fixtures';

describe('detectRsiZoneExits', () => {
  it('emits oversold exit and overbought exit on threshold crossings', () => {
    const candles = [1, 2, 3, 4, 5].map((t) => candle(t, 10, 11, 9, 10));
    const ctx = ctxWith({ rsi: [NaN, 25, 35, 75, 65] });
    expect(detectRsiZoneExits(candles, ctx)).toEqual([
      { kind: 'rsi-oversold-exit', direction: 'bullish', index: 2, t: 3 },
      { kind: 'rsi-overbought-exit', direction: 'bearish', index: 4, t: 5 },
    ]);
  });
  it('ignores NaN warmup values', () => {
    const candles = [1, 2].map((t) => candle(t, 10, 11, 9, 10));
    expect(detectRsiZoneExits(candles, ctxWith({ rsi: [NaN, 35] }))).toEqual([]);
  });
});

describe('detectRsiDivergence', () => {
  // w=1 keeps fixtures small. Lows at j1=2 (l=9) and j2=6 (l=8.5): price lower low.
  const lows = [10, 9.8, 9, 9.7, 9.9, 9.6, 8.5, 9.4, 9.9];
  const candles = lows.map((l, i) => candle(i + 1, l + 0.5, l + 1, l, l + 0.6));

  it('emits bullish divergence when price makes a lower low but RSI a higher low', () => {
    const ctx = ctxWith({ rsi: [50, 45, 30, 40, 45, 40, 38, 44, 50] }, { divergenceSwing: 1 });
    const s = detectRsiDivergence(candles, ctx);
    expect(s).toEqual([{
      kind: 'rsi-bullish-divergence', direction: 'bullish', index: 7, t: 8,
      meta: { prevIndex: 2, curIndex: 6 },
    }]);
  });
  it('stays silent when RSI also makes a lower low', () => {
    const ctx = ctxWith({ rsi: [50, 45, 30, 40, 45, 40, 25, 44, 50] }, { divergenceSwing: 1 });
    expect(detectRsiDivergence(candles, ctx)).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- rsiSignals`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/signals/rsiSignals.ts`**

```ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectRsiZoneExits(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { rsi } = ctx;
  const { rsiOversold, rsiOverbought } = ctx.opts;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = rsi[i - 1];
    const b = rsi[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if (a < rsiOversold && b >= rsiOversold) {
      out.push({ kind: 'rsi-oversold-exit', direction: 'bullish', index: i, t: candles[i].t });
    }
    if (a > rsiOverbought && b <= rsiOverbought) {
      out.push({ kind: 'rsi-overbought-exit', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}

function swingIndices(candles: Candle[], w: number, pick: (c: Candle) => number, isLow: boolean): number[] {
  const out: number[] = [];
  for (let j = w; j < candles.length - w; j++) {
    let ok = true;
    for (let m = j - w; m <= j + w && ok; m++) {
      if (m === j) continue;
      if (isLow ? pick(candles[m]) <= pick(candles[j]) : pick(candles[m]) >= pick(candles[j])) ok = false;
    }
    if (ok) out.push(j);
  }
  return out;
}

export function detectRsiDivergence(candles: Candle[], ctx: DetectorContext): Signal[] {
  const w = ctx.opts.divergenceSwing;
  const lb = ctx.opts.divergenceLookback;
  const { rsi } = ctx;
  const out: Signal[] = [];

  const lows = swingIndices(candles, w, (c) => c.l, true);
  for (let k = 1; k < lows.length; k++) {
    const [j1, j2] = [lows[k - 1], lows[k]];
    if (j2 - j1 > lb || j2 + w >= candles.length) continue;
    if (Number.isNaN(rsi[j1]) || Number.isNaN(rsi[j2])) continue;
    if (candles[j2].l < candles[j1].l && rsi[j2] > rsi[j1]) {
      out.push({
        kind: 'rsi-bullish-divergence', direction: 'bullish',
        index: j2 + w, t: candles[j2 + w].t, meta: { prevIndex: j1, curIndex: j2 },
      });
    }
  }

  const highs = swingIndices(candles, w, (c) => c.h, false);
  for (let k = 1; k < highs.length; k++) {
    const [j1, j2] = [highs[k - 1], highs[k]];
    if (j2 - j1 > lb || j2 + w >= candles.length) continue;
    if (Number.isNaN(rsi[j1]) || Number.isNaN(rsi[j2])) continue;
    if (candles[j2].h > candles[j1].h && rsi[j2] < rsi[j1]) {
      out.push({
        kind: 'rsi-bearish-divergence', direction: 'bearish',
        index: j2 + w, t: candles[j2 + w].t, meta: { prevIndex: j1, curIndex: j2 },
      });
    }
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- rsiSignals`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/signals/rsiSignals.ts packages/core/test/rsiSignals.test.ts
git commit -m "feat(core): RSI zone-exit and divergence detectors"
```

---

### Task 8: MA signals (golden/death cross, price-MA cross)

**Files:**
- Create: `packages/core/src/signals/maSignals.ts`
- Test: `packages/core/test/maSignals.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectMaCross, detectPriceMaCross } from '../src/signals/maSignals';
import { candle, ctxWith } from './fixtures';

const candles = [1, 2, 3, 4].map((t) => candle(t, 10, 11, 9, t === 3 ? 10.6 : 10));

describe('detectMaCross', () => {
  it('emits golden and death crosses', () => {
    const ctx = ctxWith({
      maFast: [9.0, 9.5, 10.5, 9.4],
      maSlow: [10.0, 10.0, 10.0, 10.0],
    });
    expect(detectMaCross(candles, ctx)).toEqual([
      { kind: 'ma-golden-cross', direction: 'bullish', index: 2, t: 3 },
      { kind: 'ma-death-cross', direction: 'bearish', index: 3, t: 4 },
    ]);
  });
  it('ignores indices with NaN values', () => {
    const ctx = ctxWith({ maFast: [NaN, 11], maSlow: [10, 10] });
    expect(detectMaCross(candles.slice(0, 2), ctx)).toEqual([]);
  });
});

describe('detectPriceMaCross', () => {
  it('emits up-cross when close crosses above the fast MA', () => {
    // closes: 10, 10, 10.6, 10 vs maFast 10.2 flat
    const ctx = ctxWith({ maFast: [10.2, 10.2, 10.2, 10.2] });
    expect(detectPriceMaCross(candles, ctx)).toEqual([
      { kind: 'price-cross-ma-up', direction: 'bullish', index: 2, t: 3 },
      { kind: 'price-cross-ma-down', direction: 'bearish', index: 3, t: 4 },
    ]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- maSignals`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/signals/maSignals.ts`**

```ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);

export function detectMaCross(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { maFast, maSlow } = ctx;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!finite(maFast[i - 1], maFast[i], maSlow[i - 1], maSlow[i])) continue;
    if (maFast[i - 1] <= maSlow[i - 1] && maFast[i] > maSlow[i]) {
      out.push({ kind: 'ma-golden-cross', direction: 'bullish', index: i, t: candles[i].t });
    } else if (maFast[i - 1] >= maSlow[i - 1] && maFast[i] < maSlow[i]) {
      out.push({ kind: 'ma-death-cross', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}

export function detectPriceMaCross(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { maFast } = ctx;
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!finite(maFast[i - 1], maFast[i])) continue;
    const p = candles[i - 1].c;
    const c = candles[i].c;
    if (p <= maFast[i - 1] && c > maFast[i]) {
      out.push({ kind: 'price-cross-ma-up', direction: 'bullish', index: i, t: candles[i].t });
    } else if (p >= maFast[i - 1] && c < maFast[i]) {
      out.push({ kind: 'price-cross-ma-down', direction: 'bearish', index: i, t: candles[i].t });
    }
  }
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- maSignals`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/signals/maSignals.ts packages/core/test/maSignals.test.ts
git commit -m "feat(core): MA cross and price-MA cross detectors"
```

---

### Task 9: Volume spike + S/R signals

**Files:**
- Create: `packages/core/src/signals/volumeSignals.ts`, `packages/core/src/signals/srSignals.ts`
- Test: `packages/core/test/volumeSignals.test.ts`, `packages/core/test/srSignals.test.ts`

Definitions:
- **volume-spike-up / -down** — `v > volumeSpikeK * volumeSma[i]` (finite); up/bullish when `c >= o`, down/bearish otherwise. `meta = { ratio: v / volumeSma[i] }`.
- S/R signals use every pivot level price `P` and tolerance `tol = srTolAtrMult * atr[i]` (skip candle when ATR is NaN). At most one signal per kind per candle (first matching level); `meta = { level: P }`:
  - **sr-bounce-support** (bullish) — `prev.c > P && l <= P + tol && c > P + tol` (dipped into the level, closed back above).
  - **sr-bounce-resistance** (bearish) — `prev.c < P && h >= P - tol && c < P - tol`.
  - **sr-break-up** (bullish) — `prev.c <= P && c > P + tol`.
  - **sr-break-down** (bearish) — `prev.c >= P && c < P - tol`.

- [x] **Step 1: Write the failing tests**

```ts
// packages/core/test/volumeSignals.test.ts
import { describe, it, expect } from 'vitest';
import { detectVolumeSpike } from '../src/signals/volumeSignals';
import { candle, ctxWith } from './fixtures';

describe('detectVolumeSpike', () => {
  it('tags spikes with the candle direction', () => {
    const candles = [
      candle(1, 10, 11, 9, 10.5, 10),  // v 10 vs sma 4*2=8 → up spike
      candle(2, 10, 11, 9, 9.5, 9),    // v 9 vs 8 → down spike
      candle(3, 10, 11, 9, 10.5, 7),   // 7 < 8 → none
    ];
    const ctx = ctxWith({ volumeSma: [4, 4, 4] });
    const s = detectVolumeSpike(candles, ctx);
    expect(s.map((x) => [x.kind, x.index])).toEqual([
      ['volume-spike-up', 0],
      ['volume-spike-down', 1],
    ]);
    expect(s[0].meta).toEqual({ ratio: 2.5 });
  });
  it('skips NaN sma warmup', () => {
    const ctx = ctxWith({ volumeSma: [NaN] });
    expect(detectVolumeSpike([candle(1, 10, 11, 9, 10.5, 100)], ctx)).toEqual([]);
  });
});
```

```ts
// packages/core/test/srSignals.test.ts
import { describe, it, expect } from 'vitest';
import { detectSrSignals } from '../src/signals/srSignals';
import { candle, ctxWith } from './fixtures';
import type { PivotLevel } from '../src/types';

const level = (price: number): PivotLevel => ({ price, type: 'support', strength: 1, touches: 1 });
// atr 2, srTolAtrMult 0.25 → tol 0.5
const mkCtx = (levels: number[], n: number) =>
  ctxWith({ pivots: levels.map(level), atr: Array(n).fill(2) });

describe('detectSrSignals', () => {
  it('emits a support bounce', () => {
    // P=100: prev close 102 > P; low 100.2 <= 100.5; close 101 > 100.5
    const candles = [candle(1, 102, 103, 101.5, 102), candle(2, 102, 102.5, 100.2, 101)];
    expect(detectSrSignals(candles, mkCtx([100], 2))).toEqual([
      { kind: 'sr-bounce-support', direction: 'bullish', index: 1, t: 2, meta: { level: 100 } },
    ]);
  });
  it('emits a resistance break up', () => {
    // P=105: prev close 104 <= P; close 105.6 > 105.5
    const candles = [candle(1, 103, 104.5, 102.5, 104), candle(2, 104, 106, 103.9, 105.6)];
    expect(detectSrSignals(candles, mkCtx([105], 2))).toEqual([
      { kind: 'sr-break-up', direction: 'bullish', index: 1, t: 2, meta: { level: 105 } },
    ]);
  });
  it('emits a break down through support', () => {
    const candles = [candle(1, 101, 102, 100.5, 101), candle(2, 101, 101.5, 99, 99.4)];
    expect(detectSrSignals(candles, mkCtx([100], 2))).toEqual([
      { kind: 'sr-break-down', direction: 'bearish', index: 1, t: 2, meta: { level: 100 } },
    ]);
  });
  it('stays silent when ATR is NaN', () => {
    const candles = [candle(1, 102, 103, 101.5, 102), candle(2, 102, 102.5, 100.2, 101)];
    const ctx = ctxWith({ pivots: [level(100)], atr: [NaN, NaN] });
    expect(detectSrSignals(candles, ctx)).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- volumeSignals srSignals`
Expected: FAIL (modules missing)

- [x] **Step 3: Implement both detectors**

```ts
// packages/core/src/signals/volumeSignals.ts
import type { Candle, Signal } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectVolumeSpike(candles: Candle[], ctx: DetectorContext): Signal[] {
  const { volumeSma } = ctx;
  const k = ctx.opts.volumeSpikeK;
  const out: Signal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const smaV = volumeSma[i];
    if (!Number.isFinite(smaV) || smaV <= 0) continue;
    const c = candles[i];
    if (c.v <= k * smaV) continue;
    const up = c.c >= c.o;
    out.push({
      kind: up ? 'volume-spike-up' : 'volume-spike-down',
      direction: up ? 'bullish' : 'bearish',
      index: i, t: c.t, meta: { ratio: c.v / smaV },
    });
  }
  return out;
}
```

```ts
// packages/core/src/signals/srSignals.ts
import type { Candle, Signal, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';

export function detectSrSignals(candles: Candle[], ctx: DetectorContext): Signal[] {
  const levels = ctx.pivots.map((p) => p.price);
  const out: Signal[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tol = ctx.opts.srTolAtrMult * ctx.atr[i];
    if (!Number.isFinite(tol)) continue;
    const prev = candles[i - 1];
    const c = candles[i];
    const seen = new Set<SignalKind>();
    const push = (kind: SignalKind, direction: 'bullish' | 'bearish', P: number) => {
      if (seen.has(kind)) return;
      seen.add(kind);
      out.push({ kind, direction, index: i, t: c.t, meta: { level: P } });
    };
    for (const P of levels) {
      if (prev.c > P && c.l <= P + tol && c.c > P + tol) push('sr-bounce-support', 'bullish', P);
      else if (prev.c < P && c.h >= P - tol && c.c < P - tol) push('sr-bounce-resistance', 'bearish', P);
      else if (prev.c <= P && c.c > P + tol) push('sr-break-up', 'bullish', P);
      else if (prev.c >= P && c.c < P - tol) push('sr-break-down', 'bearish', P);
    }
  }
  return out;
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- volumeSignals srSignals`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/signals/volumeSignals.ts packages/core/src/signals/srSignals.ts packages/core/test/volumeSignals.test.ts packages/core/test/srSignals.test.ts
git commit -m "feat(core): volume-spike and S/R bounce/break detectors"
```

---

### Task 10: Detector registry + detectAll

**Files:**
- Create: `packages/core/src/detectors.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/detectors.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { DETECTOR_REGISTRY, SIGNAL_KINDS, signalFamily, detectAll } from '../src/detectors';
import { candle, ctxWith } from './fixtures';
import type { PivotLevel } from '../src/types';

describe('registry', () => {
  it('has a detector for all 25 kinds', () => {
    expect(SIGNAL_KINDS).toHaveLength(25);
    for (const kind of SIGNAL_KINDS) expect(typeof DETECTOR_REGISTRY[kind]).toBe('function');
  });
  it('each registry entry returns only its own kind', () => {
    // engulfing fixture emits bullish-engulfing only via its registry slot
    const candles = [candle(1, 10, 10.2, 9.4, 9.5), candle(2, 9.4, 10.6, 9.3, 10.5)];
    const viaBull = DETECTOR_REGISTRY['bullish-engulfing'](candles, ctxWith());
    const viaBear = DETECTOR_REGISTRY['bearish-engulfing'](candles, ctxWith());
    expect(viaBull.map((s) => s.kind)).toEqual(['bullish-engulfing']);
    expect(viaBear).toEqual([]);
  });
});

describe('signalFamily', () => {
  it('maps kinds to the five families', () => {
    expect(signalFamily('hammer')).toBe('pattern');
    expect(signalFamily('rsi-bullish-divergence')).toBe('rsi');
    expect(signalFamily('ma-golden-cross')).toBe('ma');
    expect(signalFamily('price-cross-ma-up')).toBe('ma');
    expect(signalFamily('volume-spike-down')).toBe('volume');
    expect(signalFamily('sr-break-up')).toBe('sr');
  });
});

describe('detectAll', () => {
  it('yields signals from all five families on a composite fixture, sorted by index', () => {
    const level: PivotLevel = { price: 100, type: 'support', strength: 1, touches: 1 };
    const candles = [
      candle(1, 102, 103, 101.5, 102, 1),
      candle(2, 102, 102.5, 100.2, 101, 1),   // sr-bounce-support
      candle(3, 101.5, 102, 100.9, 101, 9),   // volume spike down (v9 > 2*4)
      candle(4, 101, 101.2, 100.2, 100.3, 1), // bear candle
      candle(5, 100.2, 101.6, 100.1, 101.5, 1), // bullish engulfing
    ];
    const ctx = ctxWith({
      rsi: [NaN, 25, 35, 40, 45],              // oversold exit at index 2
      maFast: [99, 99.5, 100.5, 100.4, 100.6],
      maSlow: [100, 100, 100, 100, 100],       // golden cross at index 2
      volumeSma: [4, 4, 4, 4, 4],
      atr: [2, 2, 2, 2, 2],
      pivots: [level],
    });
    const all = detectAll(candles, ctx);
    const families = new Set(all.map((s) => signalFamily(s.kind)));
    expect(families).toEqual(new Set(['pattern', 'rsi', 'ma', 'volume', 'sr']));
    for (let i = 1; i < all.length; i++) expect(all[i].index).toBeGreaterThanOrEqual(all[i - 1].index);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- detectors`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/detectors.ts`**

```ts
import type { Candle, Signal, SignalKind } from './types';
import type { Detector, DetectorContext } from './detectorContext';
import { detectDoji, detectHammer, detectShootingStar } from './patterns/singleCandle';
import { detectEngulfing, detectHarami } from './patterns/twoCandle';
import { detectStars, detectSoldiersCrows } from './patterns/threeCandle';
import { detectRsiZoneExits, detectRsiDivergence } from './signals/rsiSignals';
import { detectMaCross, detectPriceMaCross } from './signals/maSignals';
import { detectVolumeSpike } from './signals/volumeSignals';
import { detectSrSignals } from './signals/srSignals';

const only = (kind: SignalKind, fn: Detector): Detector =>
  (candles, ctx) => fn(candles, ctx).filter((s) => s.kind === kind);

export const DETECTOR_REGISTRY: Record<SignalKind, Detector> = {
  'doji': detectDoji,
  'hammer': detectHammer,
  'shooting-star': detectShootingStar,
  'bullish-engulfing': only('bullish-engulfing', detectEngulfing),
  'bearish-engulfing': only('bearish-engulfing', detectEngulfing),
  'bullish-harami': only('bullish-harami', detectHarami),
  'bearish-harami': only('bearish-harami', detectHarami),
  'morning-star': only('morning-star', detectStars),
  'evening-star': only('evening-star', detectStars),
  'three-white-soldiers': only('three-white-soldiers', detectSoldiersCrows),
  'three-black-crows': only('three-black-crows', detectSoldiersCrows),
  'rsi-oversold-exit': only('rsi-oversold-exit', detectRsiZoneExits),
  'rsi-overbought-exit': only('rsi-overbought-exit', detectRsiZoneExits),
  'rsi-bullish-divergence': only('rsi-bullish-divergence', detectRsiDivergence),
  'rsi-bearish-divergence': only('rsi-bearish-divergence', detectRsiDivergence),
  'ma-golden-cross': only('ma-golden-cross', detectMaCross),
  'ma-death-cross': only('ma-death-cross', detectMaCross),
  'price-cross-ma-up': only('price-cross-ma-up', detectPriceMaCross),
  'price-cross-ma-down': only('price-cross-ma-down', detectPriceMaCross),
  'volume-spike-up': only('volume-spike-up', detectVolumeSpike),
  'volume-spike-down': only('volume-spike-down', detectVolumeSpike),
  'sr-bounce-support': only('sr-bounce-support', detectSrSignals),
  'sr-bounce-resistance': only('sr-bounce-resistance', detectSrSignals),
  'sr-break-up': only('sr-break-up', detectSrSignals),
  'sr-break-down': only('sr-break-down', detectSrSignals),
};

export const SIGNAL_KINDS = Object.keys(DETECTOR_REGISTRY) as SignalKind[];

export type SignalFamily = 'pattern' | 'rsi' | 'ma' | 'volume' | 'sr';

export function signalFamily(kind: SignalKind): SignalFamily {
  if (kind.startsWith('rsi-')) return 'rsi';
  if (kind.startsWith('ma-') || kind.startsWith('price-cross-ma')) return 'ma';
  if (kind.startsWith('volume-')) return 'volume';
  if (kind.startsWith('sr-')) return 'sr';
  return 'pattern';
}

export function detectAll(candles: Candle[], ctx: DetectorContext): Signal[] {
  const out: Signal[] = [];
  for (const kind of SIGNAL_KINDS) out.push(...DETECTOR_REGISTRY[kind](candles, ctx));
  out.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return out;
}
```

NOTE: running `detectEngulfing` twice (once per registry slot) is wasteful in theory but trivially cheap in practice; the simple registry contract (one kind per entry) is worth it.

Add to `packages/core/src/index.ts`:

```ts
export { DETECTOR_REGISTRY, SIGNAL_KINDS, signalFamily, detectAll } from './detectors';
export type { SignalFamily } from './detectors';
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test`
Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add packages/core/src/detectors.ts packages/core/src/index.ts packages/core/test/detectors.test.ts
git commit -m "feat(core): detector registry, signal families, detectAll"
```

---

### Task 11: Adaptive bracket computation

**Files:**
- Create: `packages/core/src/backtest/bracket.ts`
- Test: `packages/core/test/bracket.test.ts`

Rules (long; short mirrors): stop sits `BRACKET_PAD_ATR` ATRs beyond the nearest pivot below entry; target sits AT the nearest pivot above. Both distances are clamped to `[atrFloorMult*atr, atrCapMult*atr]`. No pivot below → `stopDist = 1.5*atr`; no pivot above → `targetDist = 2*stopDist`. `rr = targetDist/stopDist`; below `minRR` → `null` (caller counts it as filtered).

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { computeBracket } from '../src/backtest/bracket';

const cfg = { atrFloorMult: 0.5, atrCapMult: 10, minRR: 1.5 };

describe('computeBracket', () => {
  it('places a structure-based long bracket', () => {
    const b = computeBracket(100, 'bullish', [95, 110], 2, cfg)!;
    // stop = 95 - 0.1*2 = 94.8 (dist 5.2); target = 110 (dist 10); rr ≈ 1.923
    expect(b.stop).toBeCloseTo(94.8, 10);
    expect(b.target).toBe(110);
    expect(b.rr).toBeCloseTo(10 / 5.2, 10);
  });

  it('places a structure-based short bracket', () => {
    const b = computeBracket(100, 'bearish', [90, 105], 2, cfg)!;
    expect(b.stop).toBeCloseTo(105.2, 10);
    expect(b.target).toBe(90);
    expect(b.rr).toBeCloseTo(10 / 5.2, 10);
  });

  it('applies the ATR floor when structure is too close', () => {
    const b = computeBracket(100, 'bullish', [99.9, 110], 2, cfg)!;
    // raw dist 0.3 < floor 1 → stop 99
    expect(b.stop).toBeCloseTo(99, 10);
    expect(b.rr).toBeCloseTo(10, 10);
  });

  it('applies the ATR cap on both sides', () => {
    const b = computeBracket(100, 'bullish', [50, 200], 2, { ...cfg, minRR: 1 })!;
    // raw stop dist 50.2 → cap 20; raw target dist 100 → cap 20
    expect(b.stop).toBeCloseTo(80, 10);
    expect(b.target).toBeCloseTo(120, 10);
    expect(b.rr).toBeCloseTo(1, 10);
  });

  it('falls back to ATR-only when structure is missing', () => {
    const b = computeBracket(100, 'bullish', [], 2, cfg)!;
    // stopDist 3 (1.5*atr), targetDist 6 (2*stopDist)
    expect(b.stop).toBeCloseTo(97, 10);
    expect(b.target).toBeCloseTo(106, 10);
    expect(b.rr).toBe(2);
  });

  it('returns null when R/R is below the minimum', () => {
    expect(computeBracket(100, 'bullish', [95, 102], 2, cfg)).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- bracket`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/backtest/bracket.ts`**

```ts
import type { SignalDirection } from '../types';

export interface BracketConfig {
  atrFloorMult: number; // min stop/target distance in ATRs
  atrCapMult: number;   // max stop/target distance in ATRs
  minRR: number;        // trades below this R/R are skipped
}

export const BRACKET_PAD_ATR = 0.1;        // stop sits this many ATRs beyond the level
export const FALLBACK_STOP_ATR = 1.5;      // no structure: stop distance in ATRs
export const FALLBACK_TARGET_STOP_MULT = 2; // no structure: target = 2x stop distance

export interface Bracket { stop: number; target: number; rr: number }

export function computeBracket(
  entry: number,
  direction: SignalDirection,
  pivotPrices: number[],
  atrVal: number,
  cfg: BracketConfig,
): Bracket | null {
  const below = pivotPrices.filter((p) => p < entry).sort((a, b) => b - a)[0];
  const above = pivotPrices.filter((p) => p > entry).sort((a, b) => a - b)[0];
  const floor = cfg.atrFloorMult * atrVal;
  const cap = cfg.atrCapMult * atrVal;
  const clamp = (d: number) => Math.min(cap, Math.max(floor, d));

  let stopDist: number;
  let targetDist: number;
  if (direction === 'bullish') {
    stopDist = below !== undefined ? clamp(entry - (below - BRACKET_PAD_ATR * atrVal)) : FALLBACK_STOP_ATR * atrVal;
    targetDist = above !== undefined ? clamp(above - entry) : FALLBACK_TARGET_STOP_MULT * stopDist;
  } else {
    stopDist = above !== undefined ? clamp(above + BRACKET_PAD_ATR * atrVal - entry) : FALLBACK_STOP_ATR * atrVal;
    targetDist = below !== undefined ? clamp(entry - below) : FALLBACK_TARGET_STOP_MULT * stopDist;
  }

  const rr = targetDist / stopDist;
  if (rr < cfg.minRR) return null;
  return direction === 'bullish'
    ? { stop: entry - stopDist, target: entry + targetDist, rr }
    : { stop: entry + stopDist, target: entry - targetDist, rr };
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- bracket`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/backtest/bracket.ts packages/core/test/bracket.test.ts
git commit -m "feat(core): adaptive structure+ATR bracket computation"
```

---

### Task 12: Trade simulation

**Files:**
- Create: `packages/core/src/backtest/simulate.ts`
- Test: `packages/core/test/simulate.test.ts`

Semantics (all scenario-tested below):
1. Entry at the **next candle open** after the entry signal. One position at a time: entries whose entry candle is ≤ the previous trade's exit index are skipped. Signals on the last candle are skipped (no next open).
2. Missing/non-positive ATR at signal time, or `computeBracket` returning null → counted in `filtered`.
3. Per candle, in order: (a) pending opposite-signal exit fills at this open; (b) stop check, then target check — a candle touching both counts as a **stop** (conservative); (c) close-of-candle updates that take effect from the next candle: opposite-direction setup signal arms a pending exit; structure ratchet (long: any pivot above entry whose price the candle closed above pulls the stop to `level − pad`); breakeven (touching `entry ± breakevenAtR*risk` moves the stop to entry).
4. Still open at end of history → exit at the final close, reason `end-of-data`.
5. `r` = signed profit measured in initial-risk units.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { simulate } from '../src/backtest/simulate';
import { candle } from './fixtures';
import type { Signal, SignalDirection } from '../src/types';

const cfg = { atrFloorMult: 0.5, atrCapMult: 10, minRR: 1, breakevenAtR: 1 };
const sig = (index: number, direction: SignalDirection = 'bullish'): Signal =>
  ({ kind: 'hammer', direction, index, t: index + 1 });
const atrFlat = (n: number) => Array(n).fill(2);
// base long bracket from entry 100, pivots [95, 110], atr 2: stop 94.8 (risk 5.2), target 110
const c0 = candle(1, 100, 101, 99, 100);

describe('simulate', () => {
  it('hits the target', () => {
    const candles = [c0, candle(2, 100, 111, 99, 110)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades).toHaveLength(1);
    expect(trades[0].reason).toBe('target');
    expect(trades[0].r).toBeCloseTo(10 / 5.2, 10);
  });

  it('hits the stop for -1R', () => {
    const candles = [c0, candle(2, 100, 101, 94, 95)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].r).toBeCloseTo(-1, 10);
  });

  it('counts a candle touching both stop and target as a stop (conservative)', () => {
    const candles = [c0, candle(2, 100, 111, 94, 100)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].r).toBeCloseTo(-1, 10);
  });

  it('moves the stop to breakeven after +1R, effective next candle', () => {
    const candles = [
      c0,
      candle(2, 100, 106, 99, 105),   // touches 105.2? no: h=106 >= 100 + 5.2 → BE armed
      candle(3, 105, 106, 100, 101),  // stop now 100 → exit at 100
    ];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBe(100);
    expect(trades[0].r).toBeCloseTo(0, 10);
  });

  it('ratchets the stop behind a cleared level', () => {
    // pivots [95, 104]; no level above 104 → target = entry + 2*5.2 = 110.4
    const candles = [
      c0,
      candle(2, 100, 105.5, 99, 105),   // closes above 104 → stop ratchets to 103.8
      candle(3, 105, 105.5, 103, 104),  // l 103 <= 103.8 → exit at 103.8
    ];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 104], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('stop');
    expect(trades[0].exitPrice).toBeCloseTo(103.8, 10);
    expect(trades[0].r).toBeCloseTo(3.8 / 5.2, 10);
  });

  it('exits at next open on an opposite setup signal', () => {
    const candles = [c0, candle(2, 100, 104, 99, 103), candle(3, 103, 104, 102, 102.5)];
    const setupSignals = [sig(0), sig(1, 'bearish')];
    const { trades } = simulate(candles, [sig(0)], setupSignals, [95, 110], atrFlat(3), cfg);
    expect(trades[0].reason).toBe('opposite-signal');
    expect(trades[0].exitPrice).toBe(103);
    expect(trades[0].r).toBeCloseTo(3 / 5.2, 10);
  });

  it('closes still-open trades at the final candle as end-of-data', () => {
    const candles = [c0, candle(2, 100, 104, 99, 103)];
    const { trades } = simulate(candles, [sig(0)], [sig(0)], [95, 110], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('end-of-data');
    expect(trades[0].exitPrice).toBe(103);
  });

  it('counts R/R-filtered entries without trading them', () => {
    const out = simulate([c0, candle(2, 100, 111, 99, 110)], [sig(0)], [sig(0)], [95, 110], atrFlat(2), { ...cfg, minRR: 3 });
    expect(out.trades).toHaveLength(0);
    expect(out.filtered).toBe(1);
  });

  it('simulates shorts symmetrically', () => {
    const candles = [c0, candle(2, 100, 101, 89, 90)];
    const { trades } = simulate(candles, [sig(0, 'bearish')], [sig(0, 'bearish')], [90, 105], atrFlat(2), cfg);
    expect(trades[0].reason).toBe('target');
    expect(trades[0].r).toBeCloseTo(10 / 5.2, 10);
  });

  it('skips entries while a position is open', () => {
    const candles = [c0, candle(2, 100, 101, 99.5, 100.5), candle(3, 100.5, 111, 100, 110)];
    const { trades } = simulate(candles, [sig(0), sig(1)], [sig(0), sig(1)], [95, 110], atrFlat(3), cfg);
    expect(trades).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/core test -- simulate`
Expected: FAIL (module missing)

- [x] **Step 3: Implement `packages/core/src/backtest/simulate.ts`**

```ts
import type { Candle, Signal, SignalDirection } from '../types';
import { computeBracket, BRACKET_PAD_ATR, type BracketConfig } from './bracket';

export interface SimConfig extends BracketConfig {
  breakevenAtR: number; // move stop to entry once this many R in profit
}

export type ExitReason = 'target' | 'stop' | 'opposite-signal' | 'end-of-data';

export interface TradeRecord {
  direction: SignalDirection;
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  r: number;
  reason: ExitReason;
}

export interface SimResult { trades: TradeRecord[]; filtered: number }

export function simulate(
  candles: Candle[],
  entries: Signal[],
  setupSignals: Signal[],
  pivotPrices: number[],
  atrByIndex: number[],
  cfg: SimConfig,
): SimResult {
  const trades: TradeRecord[] = [];
  let filtered = 0;

  const oppositeAt = new Map<number, Set<SignalDirection>>();
  for (const s of setupSignals) {
    const set = oppositeAt.get(s.index) ?? new Set<SignalDirection>();
    set.add(s.direction);
    oppositeAt.set(s.index, set);
  }

  let lastExitIndex = -1;
  for (const e of [...entries].sort((a, b) => a.index - b.index)) {
    const entryIndex = e.index + 1;
    if (entryIndex >= candles.length || entryIndex <= lastExitIndex) continue;
    const atrVal = atrByIndex[e.index];
    if (!Number.isFinite(atrVal) || atrVal <= 0) { filtered++; continue; }
    const entryPrice = candles[entryIndex].o;
    const bracket = computeBracket(entryPrice, e.direction, pivotPrices, atrVal, cfg);
    if (!bracket) { filtered++; continue; }

    const long = e.direction === 'bullish';
    const risk = Math.abs(entryPrice - bracket.stop);
    const target = bracket.target;
    let stop = bracket.stop;
    let pendingOpposite = false;
    let exit: { index: number; price: number; reason: ExitReason } | null = null;

    for (let j = entryIndex; j < candles.length && !exit; j++) {
      const c = candles[j];
      if (pendingOpposite) { exit = { index: j, price: c.o, reason: 'opposite-signal' }; break; }
      if (long ? c.l <= stop : c.h >= stop) { exit = { index: j, price: stop, reason: 'stop' }; break; }
      if (long ? c.h >= target : c.l <= target) { exit = { index: j, price: target, reason: 'target' }; break; }

      // close-of-candle updates — take effect from the next candle
      const opp = oppositeAt.get(j);
      if (opp?.has(long ? 'bearish' : 'bullish')) pendingOpposite = true;
      for (const P of pivotPrices) {
        if (long && P > entryPrice && c.c > P) stop = Math.max(stop, P - BRACKET_PAD_ATR * atrVal);
        if (!long && P < entryPrice && c.c < P) stop = Math.min(stop, P + BRACKET_PAD_ATR * atrVal);
      }
      if (long ? c.h >= entryPrice + cfg.breakevenAtR * risk : c.l <= entryPrice - cfg.breakevenAtR * risk) {
        stop = long ? Math.max(stop, entryPrice) : Math.min(stop, entryPrice);
      }
    }

    if (!exit) {
      const last = candles.length - 1;
      exit = { index: last, price: candles[last].c, reason: 'end-of-data' };
    }
    const r = long ? (exit.price - entryPrice) / risk : (entryPrice - exit.price) / risk;
    trades.push({
      direction: e.direction, entryIndex, entryPrice,
      exitIndex: exit.index, exitPrice: exit.price, r, reason: exit.reason,
    });
    lastExitIndex = exit.index;
  }

  return { trades, filtered };
}
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- simulate`
Expected: PASS (10 tests)

- [x] **Step 5: Commit**

```bash
git add packages/core/src/backtest/simulate.ts packages/core/test/simulate.test.ts
git commit -m "feat(core): bracket trade simulation with breakeven, ratchet, opposite-exit"
```

---

### Task 13: Metrics, confluence pairing, scan

**Files:**
- Create: `packages/core/src/backtest/metrics.ts`, `packages/core/src/backtest/scan.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/metrics.test.ts`, `packages/core/test/scan.test.ts`

Note: in R units, `expectancy` mathematically equals `avgR`; we compute it from the win/loss decomposition anyway and expose both fields because the UI shows both columns. `profitFactor` is `null` when there are wins but no losses ("infinite").

- [x] **Step 1: Write the failing metrics test**

```ts
// packages/core/test/metrics.test.ts
import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../src/backtest/metrics';
import type { TradeRecord } from '../src/backtest/simulate';

const tr = (r: number, direction: 'bullish' | 'bearish' = 'bullish'): TradeRecord =>
  ({ direction, entryIndex: 1, entryPrice: 100, exitIndex: 2, exitPrice: 100 + r, r, reason: r > 0 ? 'target' : 'stop' });

describe('computeMetrics', () => {
  it('computes the aggregate set', () => {
    const m = computeMetrics([tr(2), tr(-1, 'bearish'), tr(1), tr(-0.5)], 3);
    expect(m.trades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.winRate).toBeCloseTo(0.5, 10);
    expect(m.avgR).toBeCloseTo(0.375, 10);
    expect(m.profitFactor).toBeCloseTo(2, 10);       // 3 / 1.5
    expect(m.expectancy).toBeCloseTo(0.375, 10);
    expect(m.maxDrawdownR).toBeCloseTo(1, 10);       // equity 2,1,2,1.5 → worst dip 1
    expect(m.filtered).toBe(3);
    expect(m.longTrades).toBe(3);
    expect(m.shortTrades).toBe(1);
  });
  it('returns null profit factor with wins and no losses', () => {
    expect(computeMetrics([tr(1)], 0).profitFactor).toBeNull();
  });
  it('handles the empty case', () => {
    const m = computeMetrics([], 2);
    expect(m.trades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.maxDrawdownR).toBe(0);
  });
});
```

- [x] **Step 2: Write the failing scan test**

```ts
// packages/core/test/scan.test.ts
import { describe, it, expect } from 'vitest';
import { pairEntries, runScan, runSetup, DEFAULT_BACKTEST_CONFIG } from '../src/backtest/scan';
import { buildDetectorContext, DEFAULT_DETECTOR_OPTIONS } from '../src/detectorContext';
import { candle } from './fixtures';
import type { Signal } from '../src/types';

const s = (kind: Signal['kind'], index: number, direction: Signal['direction']): Signal =>
  ({ kind, direction, index, t: index + 1 });

describe('pairEntries', () => {
  it('triggers at the later signal of a same-direction pair within the window', () => {
    const sigs = [s('hammer', 2, 'bullish'), s('rsi-oversold-exit', 4, 'bullish')];
    const out = pairEntries(sigs, 'hammer', 'rsi-oversold-exit', 3);
    expect(out.map((x) => x.index)).toEqual([4]);
  });
  it('ignores opposite directions and out-of-window pairs', () => {
    expect(pairEntries([s('hammer', 2, 'bullish'), s('doji', 3, 'bearish')], 'hammer', 'doji', 3)).toEqual([]);
    expect(pairEntries([s('hammer', 2, 'bullish'), s('doji', 9, 'bullish')], 'hammer', 'doji', 3)).toEqual([]);
  });
  it('dedupes triggers landing on the same candle', () => {
    const sigs = [s('hammer', 2, 'bullish'), s('hammer', 4, 'bullish'), s('doji', 4, 'bullish')];
    expect(pairEntries(sigs, 'hammer', 'doji', 3).map((x) => x.index)).toEqual([4]);
  });
});

// A deterministic synthetic series long enough for warmup with small periods.
function syntheticCandles(n: number) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 11 === 0 ? -3 : 0.3);
    const o = price;
    const c = Math.max(5, price + drift);
    const h = Math.max(o, c) + 1.5;
    const l = Math.min(o, c) - 1.5;
    out.push(candle(i + 1, o, h, l, c, i % 13 === 0 ? 30 : 5));
    price = c;
  }
  return out;
}

const opts = {
  ...DEFAULT_DETECTOR_OPTIONS,
  rsiPeriod: 5, atrPeriod: 5, volumeSmaPeriod: 5,
  maFast: { type: 'EMA' as const, period: 5 }, maSlow: { type: 'SMA' as const, period: 13 },
};

describe('runScan', () => {
  const candles = syntheticCandles(300);
  const ctx = buildDetectorContext(candles, opts);

  it('returns ranked results with full metrics', () => {
    const scan = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(scan.candleCount).toBe(300);
    expect(scan.lastCandleT).toBe(300);
    expect(scan.results.length).toBeGreaterThan(0);
    const m = scan.results[0].metrics;
    for (const key of ['trades', 'wins', 'winRate', 'avgR', 'profitFactor', 'expectancy', 'maxDrawdownR', 'filtered', 'longTrades', 'shortTrades']) {
      expect(m).toHaveProperty(key);
    }
    for (let i = 1; i < scan.results.length; i++) {
      expect(scan.results[i].metrics.expectancy).toBeLessThanOrEqual(scan.results[i - 1].metrics.expectancy);
    }
  });

  it('includes single and pair setups', () => {
    const scan = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(scan.results.some((r) => r.kinds.length === 1)).toBe(true);
    expect(scan.results.some((r) => r.kinds.length === 2)).toBe(true);
  });

  it('is deterministic', () => {
    const a = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    const b = runScan(candles, ctx, DEFAULT_BACKTEST_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('runSetup backtests one custom set', () => {
    const r = runSetup(candles, ctx, DEFAULT_BACKTEST_CONFIG, ['volume-spike-up']);
    expect(r.kinds).toEqual(['volume-spike-up']);
    expect(r.metrics.trades + r.metrics.filtered).toBeGreaterThanOrEqual(0);
  });
});
```

- [x] **Step 3: Run to verify failure**

Run: `pnpm --filter @cta/core test -- metrics scan`
Expected: FAIL (modules missing)

- [x] **Step 4: Implement metrics**

```ts
// packages/core/src/backtest/metrics.ts
import type { TradeRecord } from './simulate';

export interface SetupMetrics {
  trades: number;
  wins: number;
  winRate: number;
  avgR: number;
  profitFactor: number | null; // null = wins but zero losses ("infinite")
  expectancy: number;          // equals avgR in R units; kept as an explicit column
  maxDrawdownR: number;
  filtered: number;            // entries skipped by the min-R/R or missing-ATR filter
  longTrades: number;
  shortTrades: number;
}

export function computeMetrics(trades: TradeRecord[], filtered: number): SetupMetrics {
  const n = trades.length;
  const rs = trades.map((t) => t.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const avgR = n ? rs.reduce((a, b) => a + b, 0) / n : 0;
  const winRate = n ? wins.length / n : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  return {
    trades: n,
    wins: wins.length,
    winRate,
    avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
    maxDrawdownR: maxDd,
    filtered,
    longTrades: trades.filter((t) => t.direction === 'bullish').length,
    shortTrades: trades.filter((t) => t.direction === 'bearish').length,
  };
}
```

- [x] **Step 5: Implement scan**

```ts
// packages/core/src/backtest/scan.ts
import type { Candle, Signal, SignalKind } from '../types';
import type { DetectorContext } from '../detectorContext';
import { detectAll, SIGNAL_KINDS } from '../detectors';
import { simulate, type SimConfig } from './simulate';
import { computeMetrics, type SetupMetrics } from './metrics';

export interface BacktestConfig extends SimConfig {
  confluenceWindow: number; // max candles between the two signals of a pair
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  confluenceWindow: 3, minRR: 1.5, atrFloorMult: 1, atrCapMult: 3, breakevenAtR: 1,
};

export interface SetupResult { kinds: SignalKind[]; metrics: SetupMetrics }

export interface ScanResult {
  results: SetupResult[];
  candleCount: number;
  lastCandleT: number;
}

export function pairEntries(signals: Signal[], k1: SignalKind, k2: SignalKind, window: number): Signal[] {
  const a = signals.filter((s) => s.kind === k1);
  const b = signals.filter((s) => s.kind === k2);
  const byKey = new Map<string, Signal>();
  for (const s1 of a) {
    for (const s2 of b) {
      if (s1.direction !== s2.direction) continue;
      if (Math.abs(s1.index - s2.index) > window) continue;
      const later = s1.index >= s2.index ? s1 : s2;
      byKey.set(`${later.index}:${later.direction}`, later);
    }
  }
  return [...byKey.values()].sort((x, y) => x.index - y.index);
}

function setupFromSignals(
  candles: Candle[], signals: Signal[], ctx: DetectorContext, cfg: BacktestConfig, kinds: SignalKind[],
): SetupResult {
  const sortedKinds = [...kinds].sort();
  const entries = sortedKinds.length === 1
    ? signals.filter((s) => s.kind === sortedKinds[0])
    : pairEntries(signals, sortedKinds[0], sortedKinds[1], cfg.confluenceWindow);
  const setupSignals = signals.filter((s) => sortedKinds.includes(s.kind));
  const pivotPrices = ctx.pivots.map((p) => p.price);
  const sim = simulate(candles, entries, setupSignals, pivotPrices, ctx.atr, cfg);
  return { kinds: sortedKinds, metrics: computeMetrics(sim.trades, sim.filtered) };
}

const byRank = (a: SetupResult, b: SetupResult): number =>
  b.metrics.expectancy - a.metrics.expectancy
  || b.metrics.trades - a.metrics.trades
  || a.kinds.join('+').localeCompare(b.kinds.join('+'));

export function runSetup(
  candles: Candle[], ctx: DetectorContext, cfg: BacktestConfig, kinds: SignalKind[],
): SetupResult {
  return setupFromSignals(candles, detectAll(candles, ctx), ctx, cfg, kinds);
}

export function runScan(candles: Candle[], ctx: DetectorContext, cfg: BacktestConfig = DEFAULT_BACKTEST_CONFIG): ScanResult {
  const signals = detectAll(candles, ctx);
  const present = SIGNAL_KINDS.filter((k) => signals.some((s) => s.kind === k));
  const results: SetupResult[] = [];
  for (const k of present) results.push(setupFromSignals(candles, signals, ctx, cfg, [k]));
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const r = setupFromSignals(candles, signals, ctx, cfg, [present[i], present[j]]);
      if (r.metrics.trades + r.metrics.filtered > 0) results.push(r);
    }
  }
  results.sort(byRank);
  return {
    results,
    candleCount: candles.length,
    lastCandleT: candles.length ? candles[candles.length - 1].t : 0,
  };
}
```

Add to `packages/core/src/index.ts`:

```ts
export { computeBracket, BRACKET_PAD_ATR } from './backtest/bracket';
export type { Bracket, BracketConfig } from './backtest/bracket';
export { simulate } from './backtest/simulate';
export type { SimConfig, TradeRecord, ExitReason, SimResult } from './backtest/simulate';
export { computeMetrics } from './backtest/metrics';
export type { SetupMetrics } from './backtest/metrics';
export { runScan, runSetup, pairEntries, DEFAULT_BACKTEST_CONFIG } from './backtest/scan';
export type { BacktestConfig, SetupResult, ScanResult } from './backtest/scan';
```

- [x] **Step 6: Run tests**

Run: `pnpm --filter @cta/core test`
Expected: all PASS

- [x] **Step 7: Commit**

```bash
git add packages/core/src/backtest/metrics.ts packages/core/src/backtest/scan.ts packages/core/src/index.ts packages/core/test/metrics.test.ts packages/core/test/scan.test.ts
git commit -m "feat(core): metrics, confluence pairing, singles+pairs scan"
```

---

### Task 14: `PivotLevel.touches` counts independent visits

**Files:**
- Modify: `packages/core/src/pivots.ts`
- Test: `packages/core/test/pivots.test.ts` (add cases; keep existing ones passing)

Today `touches` counts how many raw pivots merged into a level — two pivots from the *same* visit (a few bars apart) count twice. New rule: pivots whose indices are within `2 * lookback` bars belong to one visit; `touches` = number of visit clusters.

- [x] **Step 1: Add the failing tests** (append to `packages/core/test/pivots.test.ts`, using its existing candle factory — check the file and reuse its helper)

```ts
describe('touches as independent visits', () => {
  const flat = (t: number) => ({ t, o: 10, h: 10.05, l: 9.95, c: 10, v: 1 });
  const peak = (t: number, h: number) => ({ t, o: 10, h, l: 9.95, c: 10, v: 1 });

  it('counts two far-apart merged peaks as two touches', () => {
    // lookback 2 → same-visit gap is 4; peaks at index 3 and 12 (gap 9) merge by price
    const candles = [
      flat(1), flat(2), flat(3), peak(4, 100), flat(5), flat(6), flat(7), flat(8),
      flat(9), flat(10), flat(11), flat(12), peak(13, 100.2), flat(14), flat(15), flat(16),
    ];
    const [level] = pivots(candles, { lookback: 2, maxLevels: 3, mergeTolerance: 0.003 });
    expect(level.price).toBeGreaterThan(99);
    expect(level.touches).toBe(2);
  });

  it('counts two near peaks as a single visit', () => {
    // peaks at index 3 and 7 (gap 4, not > 4) → one visit
    const candles = [
      flat(1), flat(2), flat(3), peak(4, 100), flat(5), flat(6), flat(7), peak(8, 100.2),
      flat(9), flat(10), flat(11),
    ];
    const [level] = pivots(candles, { lookback: 2, maxLevels: 3, mergeTolerance: 0.003 });
    expect(level.touches).toBe(1);
  });
});
```

- [x] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter @cta/core test -- pivots`
Expected: the two new tests FAIL (current code reports `touches: 2` for both — second case is the bug)

- [x] **Step 3: Fix `packages/core/src/pivots.ts`**

Change `Raw` to carry the candle index, accumulate indices through the merge, and derive touches from visit clusters:

```ts
interface Raw { price: number; strength: number; index: number }
```

…push `{ price: candles[i].h, strength, index: i }` / `{ price: candles[i].l, strength, index: i }` in the detection loop. Then replace the merge block and final mapping:

```ts
  raw.sort((a, b) => a.price - b.price);
  const merged: { price: number; strength: number; indices: number[] }[] = [];
  for (const r of raw) {
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
    const sorted = [...indices].sort((a, b) => a - b);
    let visits = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > visitGap) visits++;
    }
    return visits;
  };

  const levels: PivotLevel[] = merged.map((m) => ({
    price: m.price,
    type: (m.price >= current ? 'resistance' : 'support') as PivotType,
    strength: m.strength,
    touches: countVisits(m.indices),
  }));
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @cta/core test -- pivots`
Expected: all PASS (old cases unaffected: their merged pivots are far apart or single)
If a pre-existing assertion baked in the old merge-count semantics, update that assertion to the visit count and note it in the commit message.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/pivots.ts packages/core/test/pivots.test.ts
git commit -m "fix(core): PivotLevel.touches counts independent visits"
```

---

### Task 15: candleService `force` + tail-only backfill

**Files:**
- Modify: `apps/server/src/services/candleService.ts`
- Test: `apps/server/test/candleService.test.ts` (add cases — keep existing ones passing; reuse the file's existing fake client/store helpers if present, otherwise use the fakes below)

- [ ] **Step 1: Add the failing tests** (append; adapt the fakes to the file's existing style)

```ts
import { describe, it, expect } from 'vitest';
import { CandleService } from '../src/services/candleService';
import type { Candle } from '@cta/core';

const STEP = 60_000; // '1m'
const mk = (t: number): Candle => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 });

function fakes(stored: Candle[]) {
  const calls: { start: number; end: number }[] = [];
  const store = {
    rows: [...stored],
    upsert(_c: string, _i: string, cs: Candle[]) { this.rows.push(...cs); },
    get(_c: string, _i: string, from: number, to: number) {
      return this.rows.filter((r) => r.t >= from && r.t <= to).sort((a, b) => a.t - b.t);
    },
    latestTime() { return this.rows.length ? Math.max(...this.rows.map((r) => r.t)) : null; },
    earliestTime() { return this.rows.length ? Math.min(...this.rows.map((r) => r.t)) : null; },
  };
  const client = {
    candleSnapshot: async (_coin: string, _int: string, s: number, e: number) => {
      calls.push({ start: s, end: e });
      const out: Candle[] = [];
      for (let t = Math.ceil(s / STEP) * STEP; t <= e; t += STEP) out.push(mk(t));
      return out;
    },
  };
  const rateLimiter = { acquire: async () => {} };
  return { calls, store, client, rateLimiter };
}

describe('candleService force + tail-only backfill', () => {
  const end = 100 * STEP;

  it('force refetches the head even when the cache is fresh', async () => {
    const stored = [mk(end - 2 * STEP), mk(end - STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 2, { force: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - STEP); // re-fetches the latest stored candle
    expect(f.calls[0].end).toBe(end);
  });

  it('fresh cache without force fetches nothing', async () => {
    const f = fakes([mk(end - 2 * STEP), mk(end - STEP)]);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 2);
    expect(f.calls).toHaveLength(0);
  });

  it('extending lookback backfills only the missing tail', async () => {
    // cache holds the head; only the older range should be fetched
    const stored = [mk(end - 3 * STEP), mk(end - 2 * STEP), mk(end - STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 10);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - 10 * STEP);
    expect(f.calls[0].end).toBe(end - 4 * STEP); // earliest - step, NOT `end`
  });

  it('stale head fetches only the missing head range', async () => {
    const stored = [mk(end - 5 * STEP), mk(end - 4 * STEP)];
    const f = fakes(stored);
    const svc = new CandleService({ ...f, now: () => end } as never);
    await svc.getCandles('BTC', '1m', 5);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].start).toBe(end - 3 * STEP); // latest + step
    expect(f.calls[0].end).toBe(end);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter @cta/server test -- candleService`
Expected: new tests FAIL (no `force` option; tail backfill currently fetches `wantStart..end`)

- [ ] **Step 3: Rewrite `getCandles` in `apps/server/src/services/candleService.ts`**

```ts
  async getCandles(
    coin: string,
    interval: string,
    lookback: number,
    opts: { force?: boolean } = {},
  ): Promise<Candle[]> {
    const step = INTERVAL_MS[interval as keyof typeof INTERVAL_MS];
    if (!step) throw new Error(`unknown interval ${interval}`);
    const force = opts.force ?? false;
    const end = this.now();
    const wantStart = end - lookback * step;
    const latest = this.deps.store.latestTime(coin, interval);
    const earliest = this.deps.store.earliestTime(coin, interval);

    if (latest === null || earliest === null) {
      await this.fetchAndStore(coin, interval, wantStart, end);
    } else {
      // Tail: fetch only the missing older range (the cached middle is never refetched).
      if (earliest > wantStart) await this.fetchAndStore(coin, interval, wantStart, earliest - step);
      // Head: one-step staleness window as before; `force` refetches the latest
      // stored candle too, since it may have been cached while still open.
      const missingHead = latest < end - step;
      if (missingHead || force) {
        await this.fetchAndStore(coin, interval, force ? latest : latest + step, end);
      }
    }
    return this.deps.store.get(coin, interval, wantStart, end);
  }
```

(`fetchAndStore` is unchanged.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- candleService`
Expected: all PASS, including pre-existing cases

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/candleService.ts apps/server/test/candleService.test.ts
git commit -m "feat(server): force refresh option and tail-only backfill in candleService"
```

---

### Task 16: analysisService — signals, 404 unknown coin, force

**Files:**
- Create: `apps/server/src/errors.ts`
- Modify: `apps/server/src/services/analysisService.ts`, `apps/server/src/routes/analysis.ts`
- Test: `apps/server/test/analysis.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests** (append to `apps/server/test/analysis.test.ts`)

```ts
import { AnalysisService } from '../src/services/analysisService';

const mkCandle = (t: number, c: number) => ({ t, o: c - 0.5, h: c + 1, l: c - 1, c, v: 5 });

describe('AnalysisService phase 2', () => {
  it('404s on a coin with no candles', async () => {
    const svc = new AnalysisService({ getCandles: async () => [] } as never);
    await expect(svc.analyze({
      coin: 'NOPE', interval: '1h', lookback: 100, force: false,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('includes detected signals in the response', async () => {
    const candles = Array.from({ length: 60 }, (_, i) => mkCandle(i + 1, 100 + Math.sin(i / 4) * 5));
    const svc = new AnalysisService({ getCandles: async () => candles } as never);
    const res = await svc.analyze({
      coin: 'BTC', interval: '1h', lookback: 60, force: false,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    });
    expect(Array.isArray(res.signals)).toBe(true);
  });

  it('passes force through to the candle service', async () => {
    let seen: unknown;
    const candles = Array.from({ length: 60 }, (_, i) => mkCandle(i + 1, 100));
    const svc = new AnalysisService({
      getCandles: async (_c: string, _i: string, _l: number, opts: unknown) => { seen = opts; return candles; },
    } as never);
    await svc.analyze({
      coin: 'BTC', interval: '1h', lookback: 60, force: true,
      rsi: { period: 14 }, movingAverages: [], volumeProfile: { rows: 24 },
      pivots: { lookback: 5, maxLevels: 6 },
    });
    expect(seen).toEqual({ force: true });
  });
});
```

Also append to the existing `POST /api/analysis` route describe block:

```ts
it('accepts a force flag', async () => {
  const analysisService = { analyze: async () => fakeResult } as any;
  const app = buildApp({ analysisService });
  const res = await app.inject({
    method: 'POST', url: '/api/analysis',
    payload: { coin: 'BTC', interval: '1h', force: true },
  });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- analysis`
Expected: FAIL (no `force` field, no signals, no 404)

- [ ] **Step 3: Implement**

```ts
// apps/server/src/errors.ts — Fastify maps `statusCode` on thrown errors automatically
export function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
```

`apps/server/src/services/analysisService.ts` — updated imports, request type and `analyze`:

```ts
import {
  sma, ema, rsi, volume, volumeProfile, pivots,
  buildDetectorContext, detectAll, DEFAULT_DETECTOR_OPTIONS,
} from '@cta/core';
import type { AnalysisResult, MovingAverageResult, Signal } from '@cta/core';
import type { CandleService } from './candleService';
import { DEFAULTS } from '../config';
import { httpError } from '../errors';

export interface AnalysisRequest {
  coin: string;
  interval: string;
  lookback: number;
  force: boolean;
  rsi: { period: number };
  movingAverages: { type: 'SMA' | 'EMA'; period: number }[];
  volumeProfile: { rows: number };
  pivots: { lookback: number; maxLevels: number };
}

export type AnalysisResponse = AnalysisResult & {
  signals: Signal[];
  meta: { lastUpdated: number; candleCount: number };
};

export class AnalysisService {
  constructor(private candleService: CandleService) {}

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback, { force: req.force });
    if (candles.length === 0) throw httpError(404, `no candles for coin ${req.coin}`);

    const movingAverages: MovingAverageResult[] = req.movingAverages.map((ma) => ({
      type: ma.type,
      period: ma.period,
      points: ma.type === 'SMA' ? sma(candles, ma.period) : ema(candles, ma.period),
    }));
    const ctx = buildDetectorContext(candles, {
      ...DEFAULT_DETECTOR_OPTIONS,
      rsiPeriod: req.rsi.period,
      volumeSmaPeriod: DEFAULTS.volumeSmaPeriod,
      pivots: {
        lookback: req.pivots.lookback,
        maxLevels: req.pivots.maxLevels,
        mergeTolerance: DEFAULTS.pivotMergeTolerance,
      },
    });
    return {
      coin: req.coin,
      interval: req.interval,
      candles,
      rsi: rsi(candles, req.rsi.period),
      movingAverages,
      volume: volume(candles, DEFAULTS.volumeSmaPeriod),
      volumeProfile: volumeProfile(candles, req.volumeProfile.rows),
      pivots: ctx.pivots,
      signals: detectAll(candles, ctx),
      meta: {
        lastUpdated: candles[candles.length - 1].t,
        candleCount: candles.length,
      },
    };
  }
}
```

(Note `pivots: ctx.pivots` — the context already computed them; don't compute twice. `meta.lastUpdated` no longer needs the `0` fallback because empty candles already threw.)

`apps/server/src/routes/analysis.ts` — add to `bodySchema.properties`:

```ts
    force: { type: 'boolean', default: false },
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/errors.ts apps/server/src/services/analysisService.ts apps/server/src/routes/analysis.ts apps/server/test/analysis.test.ts
git commit -m "feat(server): signals in analysis, 404 unknown coin, force refresh"
```

---

### Task 17: Backtest result store

**Files:**
- Modify: `apps/server/src/cache/db.ts`
- Create: `apps/server/src/cache/backtestStore.ts`
- Test: `apps/server/test/backtestStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/cache/db';
import { BacktestStore } from '../src/cache/backtestStore';

describe('BacktestStore', () => {
  it('round-trips a payload by exact key', () => {
    const store = new BacktestStore(openDb(':memory:'));
    const payload = { results: [{ kinds: ['hammer'], metrics: { trades: 3 } }], cached: false };
    store.set('BTC', '1h', 'abc', 1000, payload);
    expect(store.get('BTC', '1h', 'abc', 1000)).toEqual(payload);
  });
  it('misses on any key difference', () => {
    const store = new BacktestStore(openDb(':memory:'));
    store.set('BTC', '1h', 'abc', 1000, { x: 1 });
    expect(store.get('BTC', '1h', 'abc', 2000)).toBeNull();   // new candle head
    expect(store.get('BTC', '1h', 'zzz', 1000)).toBeNull();   // different config
    expect(store.get('ETH', '1h', 'abc', 1000)).toBeNull();
  });
  it('overwrites on conflict', () => {
    const store = new BacktestStore(openDb(':memory:'));
    store.set('BTC', '1h', 'abc', 1000, { x: 1 });
    store.set('BTC', '1h', 'abc', 1000, { x: 2 });
    expect(store.get('BTC', '1h', 'abc', 1000)).toEqual({ x: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- backtestStore`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

`apps/server/src/cache/db.ts` — append to the `db.exec` DDL string:

```sql
    CREATE TABLE IF NOT EXISTS backtest_results (
      coin TEXT NOT NULL, interval TEXT NOT NULL,
      configHash TEXT NOT NULL, lastCandleT INTEGER NOT NULL,
      payload TEXT NOT NULL, createdAt INTEGER NOT NULL,
      PRIMARY KEY (coin, interval, configHash, lastCandleT)
    );
```

```ts
// apps/server/src/cache/backtestStore.ts
import type { DB } from './db';

export class BacktestStore {
  constructor(private db: DB) {}

  get(coin: string, interval: string, configHash: string, lastCandleT: number): unknown | null {
    const row = this.db
      .prepare(
        `SELECT payload FROM backtest_results
         WHERE coin = ? AND interval = ? AND configHash = ? AND lastCandleT = ?`,
      )
      .get(coin, interval, configHash, lastCandleT) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }

  set(coin: string, interval: string, configHash: string, lastCandleT: number, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO backtest_results (coin, interval, configHash, lastCandleT, payload, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(coin, interval, configHash, lastCandleT) DO UPDATE SET
           payload=excluded.payload, createdAt=excluded.createdAt`,
      )
      .run(coin, interval, configHash, lastCandleT, JSON.stringify(payload), Date.now());
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test -- backtestStore`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/cache/db.ts apps/server/src/cache/backtestStore.ts apps/server/test/backtestStore.test.ts
git commit -m "feat(server): SQLite backtest result store"
```

---

### Task 18: Backtest service, route, wiring

**Files:**
- Create: `apps/server/src/services/backtestService.ts`, `apps/server/src/routes/backtest.ts`, `apps/server/src/util/withTimeout.ts`
- Modify: `apps/server/src/config.ts`, `apps/server/src/app.ts`, `apps/server/src/server.ts`
- Test: `apps/server/test/backtest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';
import { BacktestService } from '../src/services/backtestService';
import { openDb } from '../src/cache/db';
import { BacktestStore } from '../src/cache/backtestStore';
import type { Candle } from '@cta/core';

function mkCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 11 === 0 ? -3 : 0.3);
    const o = price;
    const c = Math.max(5, price + drift);
    out.push({ t: i + 1, o, h: Math.max(o, c) + 1.5, l: Math.min(o, c) - 1.5, c, v: i % 13 === 0 ? 30 : 5 });
    price = c;
  }
  return out;
}

const appWith = (candles: Candle[]) => {
  const store = new BacktestStore(openDb(':memory:'));
  const candleService = { getCandles: async () => candles } as never;
  return buildApp({ backtestService: new BacktestService(candleService, store) });
};

const post = (app: ReturnType<typeof buildApp>, payload: object) =>
  app.inject({ method: 'POST', url: '/api/backtest', payload: { coin: 'BTC', interval: '1h', ...payload } });

describe('POST /api/backtest', () => {
  it('runs a ranked scan', async () => {
    const res = await post(appWith(mkCandles(300)), {});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
    for (let i = 1; i < body.results.length; i++) {
      expect(body.results[i].metrics.expectancy).toBeLessThanOrEqual(body.results[i - 1].metrics.expectancy);
    }
  });

  it('serves a repeat request from cache', async () => {
    const app = appWith(mkCandles(300));
    await post(app, {});
    const res = await post(app, {});
    expect(res.json().cached).toBe(true);
  });

  it('recomputes when config differs', async () => {
    const app = appWith(mkCandles(300));
    await post(app, {});
    const res = await post(app, { config: { minRR: 2 } });
    expect(res.json().cached).toBe(false);
  });

  it('backtests a custom signal set', async () => {
    const res = await post(appWith(mkCandles(300)), { config: { signalKinds: ['volume-spike-up'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(1);
    expect(res.json().results[0].kinds).toEqual(['volume-spike-up']);
  });

  it('rejects unknown signal kinds with 400', async () => {
    const res = await post(appWith(mkCandles(300)), { config: { signalKinds: ['nope'] } });
    expect(res.statusCode).toBe(400);
  });

  it('404s when there are no candles', async () => {
    const res = await post(appWith([]), {});
    expect(res.statusCode).toBe(404);
  });

  it('422s below the minimum candle count', async () => {
    const res = await post(appWith(mkCandles(10)), {});
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain('50');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- backtest.test`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement**

`apps/server/src/config.ts` — append:

```ts
export const MIN_BACKTEST_CANDLES = 50;
export const BACKTEST_DEFAULT_LOOKBACK = 2000;
export const ROUTE_TIMEOUT_MS = Number(process.env.ROUTE_TIMEOUT_MS ?? 15_000);
```

```ts
// apps/server/src/util/withTimeout.ts
import { httpError } from '../errors';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(httpError(504, `${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

```ts
// apps/server/src/services/backtestService.ts
import { createHash } from 'node:crypto';
import {
  buildDetectorContext, runScan, runSetup,
  DEFAULT_BACKTEST_CONFIG, DEFAULT_DETECTOR_OPTIONS, SIGNAL_KINDS,
} from '@cta/core';
import type { BacktestConfig, DetectorOptions, ScanResult, SignalKind } from '@cta/core';
import type { CandleService } from './candleService';
import type { BacktestStore } from '../cache/backtestStore';
import { httpError } from '../errors';
import { MIN_BACKTEST_CANDLES } from '../config';

export interface BacktestRequest {
  coin: string;
  interval: string;
  lookback: number;
  config: {
    confluenceWindow: number;
    minRR: number;
    volumeSpikeK: number;
    signalKinds?: string[];
  };
}

export type BacktestResponse = ScanResult & { cached: boolean };

export class BacktestService {
  constructor(private candleService: CandleService, private store: BacktestStore) {}

  async run(req: BacktestRequest): Promise<BacktestResponse> {
    const kinds = req.config.signalKinds as SignalKind[] | undefined;
    if (kinds) {
      const bad = kinds.filter((k) => !SIGNAL_KINDS.includes(k));
      if (bad.length) throw httpError(400, `unknown signal kinds: ${bad.join(', ')}`);
    }

    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback);
    if (candles.length === 0) throw httpError(404, `no candles for coin ${req.coin}`);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      throw httpError(422, `backtest needs at least ${MIN_BACKTEST_CANDLES} candles; got ${candles.length} for ${req.coin} ${req.interval}`);
    }

    const cfg: BacktestConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      confluenceWindow: req.config.confluenceWindow,
      minRR: req.config.minRR,
    };
    const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, volumeSpikeK: req.config.volumeSpikeK };
    const lastCandleT = candles[candles.length - 1].t;
    const configHash = createHash('sha256')
      .update(JSON.stringify({ cfg, opts, kinds: kinds ?? null, lookback: req.lookback }))
      .digest('hex');

    const cached = this.store.get(req.coin, req.interval, configHash, lastCandleT) as BacktestResponse | null;
    if (cached) return { ...cached, cached: true };

    const ctx = buildDetectorContext(candles, opts);
    const scan: ScanResult = kinds
      ? { results: [runSetup(candles, ctx, cfg, kinds)], candleCount: candles.length, lastCandleT }
      : runScan(candles, ctx, cfg);
    const payload: BacktestResponse = { ...scan, cached: false };
    this.store.set(req.coin, req.interval, configHash, lastCandleT, payload);
    return payload;
  }
}
```

```ts
// apps/server/src/routes/backtest.ts
import type { FastifyInstance } from 'fastify';
import type { BacktestService, BacktestRequest } from '../services/backtestService';
import { SUPPORTED_INTERVALS, BACKTEST_DEFAULT_LOOKBACK, ROUTE_TIMEOUT_MS } from '../config';
import { withTimeout } from '../util/withTimeout';

const bodySchema = {
  type: 'object',
  required: ['coin', 'interval'],
  additionalProperties: false,
  properties: {
    coin: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: SUPPORTED_INTERVALS as unknown as string[] },
    lookback: { type: 'integer', minimum: 1, maximum: 20000, default: BACKTEST_DEFAULT_LOOKBACK },
    config: {
      type: 'object', default: {}, additionalProperties: false,
      properties: {
        confluenceWindow: { type: 'integer', minimum: 0, maximum: 20, default: 3 },
        minRR: { type: 'number', minimum: 0, default: 1.5 },
        volumeSpikeK: { type: 'number', exclusiveMinimum: 0, default: 2 },
        signalKinds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
      },
    },
  },
} as const;

export function registerBacktestRoute(app: FastifyInstance, svc: BacktestService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/backtest', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.run(req.body as BacktestRequest), timeoutMs, 'backtest'));
}
```

`apps/server/src/app.ts` — add the dep and registration:

```ts
import { registerBacktestRoute } from './routes/backtest';
import type { BacktestService } from './services/backtestService';

export interface AppDeps {
  marketsService: MarketsService;
  analysisService: AnalysisService;
  backtestService: BacktestService;
}

// in buildApp, after the analysis registration:
  if (deps.backtestService) registerBacktestRoute(app, deps.backtestService);
```

`apps/server/src/server.ts` — add:

```ts
import { BacktestStore } from './cache/backtestStore';
import { BacktestService } from './services/backtestService';
// after analysisService:
const backtestService = new BacktestService(candleService, new BacktestStore(db));
// and include it in buildApp:
const app = buildApp({ marketsService, analysisService, backtestService });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/backtestService.ts apps/server/src/routes/backtest.ts apps/server/src/util/withTimeout.ts apps/server/src/config.ts apps/server/src/app.ts apps/server/src/server.ts apps/server/test/backtest.test.ts
git commit -m "feat(server): POST /api/backtest with scan, validation and result cache"
```

---

### Task 19: Rate-limiter serialization + analysis route timeout

**Files:**
- Modify: `apps/server/src/hyperliquid/rateLimiter.ts`, `apps/server/src/routes/analysis.ts`
- Test: `apps/server/test/rateLimiter.test.ts` (add case), `apps/server/test/analysis.test.ts` (add case)

- [ ] **Step 1: Add the failing tests**

Append to `apps/server/test/rateLimiter.test.ts` (reuse its existing fake-clock helpers if the style differs):

```ts
it('serializes concurrent acquires without overspending', async () => {
  let t = 0;
  const sleeps: number[] = [];
  const rl = new RateLimiter(10, 1, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  const order: string[] = [];
  await Promise.all([
    rl.acquire(8).then(() => order.push('a')),
    rl.acquire(8).then(() => order.push('b')),
  ]);
  expect(order).toEqual(['a', 'b']);
  expect(sleeps.length).toBeGreaterThan(0);          // second waited for refill
  expect(rl.available).toBeGreaterThanOrEqual(0);    // never overspent
});
```

Append to `apps/server/test/analysis.test.ts`:

```ts
it('returns 504 when the service exceeds the route timeout', async () => {
  const analysisService = { analyze: () => new Promise(() => {}) } as never;
  const app = buildApp({ analysisService, routeTimeoutMs: 20 });
  const res = await app.inject({ method: 'POST', url: '/api/analysis', payload: { coin: 'BTC', interval: '1h' } });
  expect(res.statusCode).toBe(504);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/server test -- rateLimiter analysis`
Expected: both new tests FAIL

- [ ] **Step 3: Implement**

`apps/server/src/hyperliquid/rateLimiter.ts` — rename the existing `acquire` body to `acquireSequential` and add a promise-chain mutex (update the class doc comment: it IS now concurrency-safe):

```ts
  private queue: Promise<void> = Promise.resolve();

  acquire(weight: number): Promise<void> {
    const run = this.queue.then(() => this.acquireSequential(weight));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async acquireSequential(weight: number): Promise<void> {
    // ... the previous acquire() body, unchanged ...
  }
```

`apps/server/src/routes/analysis.ts` — wrap the handler:

```ts
import { SUPPORTED_INTERVALS, DEFAULTS, DEFAULT_LOOKBACK, ROUTE_TIMEOUT_MS } from '../config';
import { withTimeout } from '../util/withTimeout';

export function registerAnalysisRoute(app: FastifyInstance, svc: AnalysisService, timeoutMs = ROUTE_TIMEOUT_MS): void {
  app.post('/api/analysis', { schema: { body: bodySchema } }, async (req) =>
    withTimeout(svc.analyze(req.body as AnalysisRequest), timeoutMs, 'analysis'));
}
```

`apps/server/src/app.ts` — accept and thread the override:

```ts
export function buildApp(deps: Partial<AppDeps> & { routeTimeoutMs?: number } = {}): FastifyInstance {
  // ...
  if (deps.analysisService) registerAnalysisRoute(app, deps.analysisService, deps.routeTimeoutMs);
  if (deps.backtestService) registerBacktestRoute(app, deps.backtestService, deps.routeTimeoutMs);
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/server test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/hyperliquid/rateLimiter.ts apps/server/src/routes/analysis.ts apps/server/src/app.ts apps/server/test/rateLimiter.test.ts apps/server/test/analysis.test.ts
git commit -m "fix(server): serialize rate-limiter acquires; cap route latency with timeouts"
```

---

### Task 20: Web API layer — backtest types/client, force refresh, favicon

**Files:**
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/api/client.ts`, `apps/web/src/state/useAnalysis.ts`, `apps/web/index.html`
- Create: `apps/web/public/favicon.svg`
- Test: `apps/web/test/useAnalysis.test.ts` (add case)

- [ ] **Step 1: Add the failing test** (append to `apps/web/test/useAnalysis.test.ts`, matching its existing fetch-mock style)

```ts
const config = {
  coin: 'BTC', interval: '1h' as const, lookback: 100, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

it('sends force: true on reload', async () => {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return { ok: true, json: async () => ({ candles: [], meta: { lastUpdated: 0, candleCount: 0 } }) };
  }));
  const { result } = renderHook(() => useAnalysis(config, 0));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0] as { force: boolean }).force).toBe(false);
  act(() => result.current.reload());
  await waitFor(() => expect(calls).toHaveLength(2));
  expect((calls[1] as { force: boolean }).force).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/web test -- useAnalysis`
Expected: FAIL (`force` is undefined in the request body)

- [ ] **Step 3: Implement**

`apps/web/src/api/types.ts` — extend the re-exports and add backtest types:

```ts
import type { AnalysisResult, MaType, Interval, Signal, SignalKind, ScanResult } from '@cta/core';

export type {
  Candle, IndicatorPoint, MovingAverageResult, VolumeBar, VolumeResult, VolumeProfileRow,
  VolumeProfileResult, PivotType, PivotLevel, MaType, Interval,
  Signal, SignalKind, SignalFamily, SetupResult, SetupMetrics, ScanResult,
} from '@cta/core';
```

…change `AnalysisConfig.interval` to `Interval` (done in Task 2 — verify), and:

```ts
export type AnalysisResponse = AnalysisResult & {
  signals: Signal[];
  meta: { lastUpdated: number; candleCount: number };
};

export interface BacktestRunConfig {
  lookback?: number;
  confluenceWindow: number;
  minRR: number;
  volumeSpikeK: number;
  signalKinds?: SignalKind[];
}

export type BacktestResponse = ScanResult & { cached: boolean };
```

`apps/web/src/api/client.ts` — add `force` to `postAnalysis` and a `postBacktest`:

```ts
import type { AnalysisConfig, AnalysisResponse, BacktestResponse, BacktestRunConfig, Interval, MarketsResponse } from './types';

export async function postAnalysis(cfg: AnalysisConfig, opts: { force?: boolean } = {}): Promise<AnalysisResponse> {
  const res = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin: cfg.coin,
      interval: cfg.interval,
      lookback: cfg.lookback,
      force: opts.force ?? false,
      rsi: { period: cfg.rsiPeriod },
      movingAverages: cfg.movingAverages.map((m) => ({ type: m.type, period: m.period })),
      volumeProfile: { rows: cfg.volumeProfileRows },
      pivots: { lookback: cfg.pivotLookback, maxLevels: cfg.pivotMaxLevels },
    }),
  });
  if (!res.ok) throw new Error(`analysis failed: ${res.status}`);
  return res.json();
}

export async function postBacktest(
  coin: string,
  interval: Interval,
  cfg: BacktestRunConfig,
  signal?: AbortSignal,
): Promise<BacktestResponse> {
  const res = await fetch('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      coin, interval,
      lookback: cfg.lookback ?? 2000,
      config: {
        confluenceWindow: cfg.confluenceWindow,
        minRR: cfg.minRR,
        volumeSpikeK: cfg.volumeSpikeK,
        ...(cfg.signalKinds ? { signalKinds: cfg.signalKinds } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`backtest failed: ${res.status}`);
  return res.json();
}
```

`apps/web/src/state/useAnalysis.ts` — make `reload` a force-reload (only the marked lines change):

```ts
  const forceRef = useRef(false);
  const reload = useCallback(() => { forceRef.current = true; setNonce((n) => n + 1); }, []);
  // inside the effect's setTimeout callback:
      const force = forceRef.current;
      forceRef.current = false;
      const res = await postAnalysis(config, { force });
```

`apps/web/public/favicon.svg` — create:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#0b1220"/>
  <rect x="7.5" y="6" width="1" height="20" fill="#22c55e"/>
  <rect x="6" y="10" width="4" height="12" rx="1" fill="#22c55e"/>
  <rect x="15.5" y="5" width="1" height="16" fill="#ef4444"/>
  <rect x="14" y="8" width="4" height="10" rx="1" fill="#ef4444"/>
  <rect x="23.5" y="10" width="1" height="17" fill="#22c55e"/>
  <rect x="22" y="14" width="4" height="10" rx="1" fill="#22c55e"/>
</svg>
```

`apps/web/index.html` — add inside `<head>`:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS, no tsc errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/types.ts apps/web/src/api/client.ts apps/web/src/state/useAnalysis.ts apps/web/test/useAnalysis.test.ts apps/web/public/favicon.svg apps/web/index.html
git commit -m "feat(web): backtest API client, force refresh, favicon"
```

---

### Task 21: Chart | Backtest tabs

**Files:**
- Modify: `apps/web/src/components/Toolbar.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/test/toolbar.test.tsx` (add cases)

- [ ] **Step 1: Add the failing tests** (append to `apps/web/test/toolbar.test.tsx`)

```ts
import { Toolbar } from '../src/components/Toolbar';

describe('Toolbar tabs', () => {
  const base = {
    markets: [], coin: 'BTC', interval: '1h' as const,
    onCoin: vi.fn(), onInterval: vi.fn(), onRefresh: vi.fn(), status: '',
  };
  it('fires onView when a tab is clicked', () => {
    const onView = vi.fn();
    render(<Toolbar {...base} view="chart" onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backtest' }));
    expect(onView).toHaveBeenCalledWith('backtest');
  });
  it('marks the active tab', () => {
    render(<Toolbar {...base} view="backtest" onView={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Backtest' }).className).toContain('bg-blue-600');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/web test -- toolbar`
Expected: FAIL (no `view`/`onView` props)

- [ ] **Step 3: Implement**

`apps/web/src/components/Toolbar.tsx` — add view props and the tab pair (insert the tabs right after `<MarketPicker …/>`):

```tsx
import type { Interval } from '../intervals';

export type View = 'chart' | 'backtest';

export function Toolbar(props: {
  markets: Market[];
  coin: string;
  interval: Interval;
  view: View;
  onCoin: (c: string) => void;
  onInterval: (i: Interval) => void;
  onView: (v: View) => void;
  onRefresh: () => void;
  status: string;
}) {
  const tab = (v: View, label: string) => (
    <button
      onClick={() => props.onView(v)}
      className={`rounded px-2 py-1 text-xs ${
        props.view === v ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <MarketPicker markets={props.markets} value={props.coin} onChange={props.onCoin} />
      <div className="flex gap-1">{tab('chart', 'Chart')}{tab('backtest', 'Backtest')}</div>
      <TimeframePills value={props.interval} onChange={props.onInterval} />
      <button
        onClick={props.onRefresh}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
      >
        ↻ Refresh
      </button>
      <span className="ml-auto text-xs text-slate-500">{props.status}</span>
    </div>
  );
}
```

`apps/web/src/App.tsx` — add view state and keep BOTH views mounted (hidden, not unmounted, so the chart instance and scan results survive tab switches; coin/interval live in App state and are shared by construction). `BacktestPanel` is created in Task 24 — until then wire the state and render a placeholder `<div>` so this task compiles:

```tsx
import { useEffect, useMemo, useState } from 'react';
// ... existing imports ...
import type { View } from './components/Toolbar';

// inside App():
  const [view, setView] = useState<View>('chart');

// JSX:
      <Toolbar
        markets={markets}
        coin={config.coin}
        interval={config.interval}
        view={view}
        onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
        onInterval={(interval) => setConfig((prev) => ({ ...prev, interval }))}
        onView={setView}
        onRefresh={reload}
        status={status}
      />
      <div className={view === 'chart' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <Chart data={data} maColors={maColors} />
        <IndicatorDrawer config={config} onChange={setConfig} />
      </div>
      <div className={view === 'backtest' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <div className="p-4 text-sm text-slate-500">Backtest panel lands in Task 24.</div>
      </div>
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Toolbar.tsx apps/web/src/App.tsx apps/web/test/toolbar.test.tsx
git commit -m "feat(web): Chart/Backtest tab switcher preserving coin and interval"
```

---

### Task 22: Chart signal markers + drawer family toggles

**Files:**
- Create: `apps/web/src/signals.ts`
- Modify: `apps/web/src/components/Chart.tsx`, `apps/web/src/components/IndicatorDrawer.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/test/signals.test.ts`, `apps/web/test/indicatorDrawer.test.tsx` (add case)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/signals.test.ts
import { describe, it, expect } from 'vitest';
import { buildMarkers, DEFAULT_FAMILIES } from '../src/signals';
import type { Signal } from '../src/api/types';

const sig = (kind: Signal['kind'], direction: Signal['direction'], t: number): Signal =>
  ({ kind, direction, index: 0, t });

describe('buildMarkers', () => {
  it('maps direction to position, shape and color', () => {
    const [up, down] = buildMarkers(
      [sig('hammer', 'bullish', 1000), sig('shooting-star', 'bearish', 2000)],
      DEFAULT_FAMILIES,
    );
    expect(up).toEqual({ time: 1, position: 'belowBar', shape: 'arrowUp', color: '#22c55e', text: 'HAM' });
    expect(down.position).toBe('aboveBar');
    expect(down.shape).toBe('arrowDown');
  });
  it('filters disabled families and sorts by time', () => {
    const markers = buildMarkers(
      [sig('ma-golden-cross', 'bullish', 3000), sig('hammer', 'bullish', 1000), sig('volume-spike-up', 'bullish', 2000)],
      { ...DEFAULT_FAMILIES, volume: false },
    );
    expect(markers.map((m) => m.text)).toEqual(['HAM', 'GX']);
  });
});
```

Append to `apps/web/test/indicatorDrawer.test.tsx` (reuse its existing render helpers/config):

```ts
const config = {
  coin: 'BTC', interval: '1h' as const, lookback: 100, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

it('toggles a signal family', () => {
  const onFamilies = vi.fn();
  render(
    <IndicatorDrawer
      config={config} onChange={vi.fn()}
      families={{ pattern: true, rsi: true, ma: true, volume: true, sr: true }}
      onFamilies={onFamilies}
    />,
  );
  fireEvent.click(screen.getByLabelText('Candle patterns'));
  expect(onFamilies).toHaveBeenCalledWith({ pattern: false, rsi: true, ma: true, volume: true, sr: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/web test -- signals indicatorDrawer`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// apps/web/src/signals.ts
import { signalFamily } from '@cta/core';
import type { Signal, SignalFamily, SignalKind } from './api/types';

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  'bullish-engulfing': 'ENG', 'bearish-engulfing': 'ENG',
  'hammer': 'HAM', 'shooting-star': 'STAR', 'doji': 'DOJI',
  'morning-star': 'MSTR', 'evening-star': 'ESTR',
  'three-white-soldiers': '3WS', 'three-black-crows': '3BC',
  'bullish-harami': 'HARA', 'bearish-harami': 'HARA',
  'rsi-oversold-exit': 'RSI', 'rsi-overbought-exit': 'RSI',
  'rsi-bullish-divergence': 'DIV', 'rsi-bearish-divergence': 'DIV',
  'ma-golden-cross': 'GX', 'ma-death-cross': 'DX',
  'price-cross-ma-up': 'PMA', 'price-cross-ma-down': 'PMA',
  'volume-spike-up': 'VOL', 'volume-spike-down': 'VOL',
  'sr-bounce-support': 'BNC', 'sr-bounce-resistance': 'BNC',
  'sr-break-up': 'BRK', 'sr-break-down': 'BRK',
};

export const FAMILY_LABELS: Record<SignalFamily, string> = {
  pattern: 'Candle patterns', rsi: 'RSI', ma: 'Moving averages', volume: 'Volume', sr: 'Support/Resistance',
};

export type FamilyToggles = Record<SignalFamily, boolean>;
export const DEFAULT_FAMILIES: FamilyToggles = { pattern: true, rsi: true, ma: true, volume: true, sr: true };

export interface ChartMarker {
  time: number;
  position: 'belowBar' | 'aboveBar';
  shape: 'arrowUp' | 'arrowDown';
  color: string;
  text: string;
}

export function buildMarkers(signals: Signal[], families: FamilyToggles): ChartMarker[] {
  return signals
    .filter((s) => families[signalFamily(s.kind)])
    .map((s) => ({
      time: Math.floor(s.t / 1000),
      position: s.direction === 'bullish' ? ('belowBar' as const) : ('aboveBar' as const),
      shape: s.direction === 'bullish' ? ('arrowUp' as const) : ('arrowDown' as const),
      color: s.direction === 'bullish' ? '#22c55e' : '#ef4444',
      text: SIGNAL_LABELS[s.kind],
    }))
    .sort((a, b) => a.time - b.time);
}
```

`apps/web/src/components/Chart.tsx` — accept markers and set them. Add to the props: `markers: ChartMarker[]` (`import type { ChartMarker } from '../signals';` and `import type { SeriesMarker, Time } from 'lightweight-charts';`). Add a new effect after the data effect:

```ts
  useEffect(() => {
    if (!candle.current) return;
    candle.current.setMarkers(markers as unknown as SeriesMarker<Time>[]);
    if (import.meta.env.DEV) {
      (window as unknown as { __markerCount?: number }).__markerCount = markers.length;
    }
  }, [markers, data]);
```

(`data` stays in the dep list so markers re-apply after `setData` replaces the series content.)

`apps/web/src/components/IndicatorDrawer.tsx` — add props `families: FamilyToggles; onFamilies: (f: FamilyToggles) => void` and a section above RSI:

```tsx
import { FAMILY_LABELS, type FamilyToggles } from '../signals';
import type { SignalFamily } from '../api/types';

// new props in the signature:
export function IndicatorDrawer({
  config, onChange, families, onFamilies,
}: {
  config: AnalysisConfig;
  onChange: (c: AnalysisConfig) => void;
  families: FamilyToggles;
  onFamilies: (f: FamilyToggles) => void;
}) {

// new section JSX (first <section> in the aside):
      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Signals</h3>
        <div className="space-y-1">
          {(Object.keys(FAMILY_LABELS) as SignalFamily[]).map((fam) => (
            <label key={fam} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={families[fam]}
                onChange={() => onFamilies({ ...families, [fam]: !families[fam] })}
              />
              {FAMILY_LABELS[fam]}
            </label>
          ))}
        </div>
      </section>
```

`apps/web/src/App.tsx` — wire it:

```tsx
import { buildMarkers, DEFAULT_FAMILIES, type FamilyToggles } from './signals';

// state:
  const [families, setFamilies] = useState<FamilyToggles>(DEFAULT_FAMILIES);
  const markers = useMemo(() => buildMarkers(data?.signals ?? [], families), [data, families]);

// JSX:
        <Chart data={data} maColors={maColors} markers={markers} />
        <IndicatorDrawer config={config} onChange={setConfig} families={families} onFamilies={setFamilies} />
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/signals.ts apps/web/src/components/Chart.tsx apps/web/src/components/IndicatorDrawer.tsx apps/web/src/App.tsx apps/web/test/signals.test.ts apps/web/test/indicatorDrawer.test.tsx
git commit -m "feat(web): chart signal markers with per-family toggles"
```

---

### Task 23: useBacktest hook

**Files:**
- Create: `apps/web/src/state/useBacktest.ts`
- Test: `apps/web/test/useBacktest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBacktest } from '../src/state/useBacktest';

const scanResponse = { results: [], candleCount: 300, lastCandleT: 300, cached: false };
const cfg = { confluenceWindow: 3, minRR: 1.5, volumeSpikeK: 2 };

describe('useBacktest', () => {
  it('runs a scan and stores the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));
    const { result } = renderHook(() => useBacktest('BTC', '1h'));
    act(() => { void result.current.run(cfg); });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.result).toEqual(scanResponse));
    expect(result.current.loading).toBe(false);
  });

  it('clears state and aborts when coin changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));
    const { result, rerender } = renderHook(({ coin }) => useBacktest(coin, '1h'), {
      initialProps: { coin: 'BTC' },
    });
    act(() => { void result.current.run(cfg); });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    rerender({ coin: 'ETH' });
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces server errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422 })));
    const { result } = renderHook(() => useBacktest('BTC', '1h'));
    act(() => { void result.current.run(cfg); });
    await waitFor(() => expect(result.current.error).toContain('422'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/web test -- useBacktest`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `apps/web/src/state/useBacktest.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { postBacktest } from '../api/client';
import type { BacktestResponse, BacktestRunConfig, Interval } from '../api/types';

export interface UseBacktest {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  run: (cfg: BacktestRunConfig) => Promise<void>;
}

export function useBacktest(coin: string, interval: Interval): UseBacktest {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // coin/interval change invalidates any in-flight or shown result
  useEffect(() => {
    ctrl.current?.abort();
    setResult(null);
    setError(null);
    setLoading(false);
  }, [coin, interval]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (cfg: BacktestRunConfig) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const r = await postBacktest(coin, interval, cfg, c.signal);
      if (!c.signal.aborted) setResult(r);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [coin, interval]);

  return { result, loading, error, run };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cta/web test -- useBacktest`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/useBacktest.ts apps/web/test/useBacktest.test.ts
git commit -m "feat(web): useBacktest hook with abort-on-context-change"
```

---

### Task 24: Backtest panel + results table

**Files:**
- Create: `apps/web/src/components/BacktestTable.tsx`, `apps/web/src/components/BacktestPanel.tsx`
- Modify: `apps/web/src/App.tsx` (replace the Task 21 placeholder)
- Test: `apps/web/test/backtestPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BacktestPanel } from '../src/components/BacktestPanel';

const metrics = (over: Partial<Record<string, number | null>>) => ({
  trades: 30, wins: 18, winRate: 0.6, avgR: 0.5, profitFactor: 2, expectancy: 0.5,
  maxDrawdownR: 2, filtered: 4, longTrades: 20, shortTrades: 10, ...over,
});
const scanResponse = {
  cached: false, candleCount: 300, lastCandleT: 300,
  results: [
    { kinds: ['hammer'], metrics: metrics({ expectancy: 0.9, trades: 40 }) },
    { kinds: ['doji', 'volume-spike-up'], metrics: metrics({ expectancy: 0.4, trades: 5 }) },
  ],
};

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));

describe('BacktestPanel', () => {
  it('runs a scan and renders ranked rows with low-sample dimming', async () => {
    stubFetch();
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(screen.getAllByTestId('bt-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('bt-row');
    expect(rows[0].textContent).toContain('hammer');
    expect(rows[1].className).toContain('opacity-50');         // 5 trades < 20
    expect(rows[1].textContent).toContain('low sample');
  });

  it('re-sorts when a column header is clicked', async () => {
    stubFetch();
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(screen.getAllByTestId('bt-row')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /trades/i })); // 1st click: trades desc
    fireEvent.click(screen.getByRole('button', { name: /trades/i })); // 2nd click: trades asc
    expect(screen.getAllByTestId('bt-row')[0].textContent).toContain('doji'); // 5 trades first
  });

  it('pins a custom-set result', async () => {
    const customResponse = {
      ...scanResponse,
      results: [{ kinds: ['hammer', 'rsi-oversold-exit'], metrics: metrics({}) }],
    };
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => (body.config.signalKinds ? customResponse : scanResponse) };
    }));
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByLabelText('hammer'));
    fireEvent.click(screen.getByLabelText('rsi-oversold-exit'));
    fireEvent.click(screen.getByRole('button', { name: 'Test selection' }));
    await waitFor(() => expect(screen.getByTestId('bt-pinned')).toBeInTheDocument());
    expect(screen.getByTestId('bt-pinned').textContent).toContain('rsi-oversold-exit');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cta/web test -- backtestPanel`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement the table**

```tsx
// apps/web/src/components/BacktestTable.tsx
import { useMemo, useState } from 'react';
import type { SetupResult } from '../api/types';

const LOW_SAMPLE = 20;

type Column = { key: string; label: string; value: (r: SetupResult) => number };
const COLUMNS: Column[] = [
  { key: 'trades', label: 'trades', value: (r) => r.metrics.trades },
  { key: 'winRate', label: 'win %', value: (r) => r.metrics.winRate },
  { key: 'avgR', label: 'avg R', value: (r) => r.metrics.avgR },
  { key: 'profitFactor', label: 'PF', value: (r) => r.metrics.profitFactor ?? Number.POSITIVE_INFINITY },
  { key: 'expectancy', label: 'expectancy', value: (r) => r.metrics.expectancy },
  { key: 'maxDrawdownR', label: 'max DD', value: (r) => r.metrics.maxDrawdownR },
  { key: 'filtered', label: 'filtered', value: (r) => r.metrics.filtered },
];

const fmt = {
  pct: (x: number) => `${(x * 100).toFixed(0)}%`,
  r: (x: number) => `${x.toFixed(2)}R`,
  pf: (x: number | null) => (x === null ? '∞' : x.toFixed(2)),
};

function Row({ r, pinned }: { r: SetupResult; pinned?: boolean }) {
  const low = r.metrics.trades < LOW_SAMPLE;
  return (
    <tr
      data-testid={pinned ? 'bt-pinned' : 'bt-row'}
      className={`border-b border-slate-800 ${pinned ? 'bg-slate-800/60' : ''} ${low ? 'opacity-50' : ''}`}
    >
      <td className="px-2 py-1 text-left">
        {r.kinds.join(' + ')}
        {low && <span className="ml-2 rounded bg-slate-700 px-1 text-[10px] text-slate-300">low sample</span>}
        {pinned && <span className="ml-2 rounded bg-blue-900 px-1 text-[10px] text-blue-200">selection</span>}
      </td>
      <td className="px-2 py-1 text-right">{r.metrics.longTrades}L/{r.metrics.shortTrades}S</td>
      <td className="px-2 py-1 text-right">{r.metrics.trades}</td>
      <td className="px-2 py-1 text-right">{fmt.pct(r.metrics.winRate)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.avgR)}</td>
      <td className="px-2 py-1 text-right">{fmt.pf(r.metrics.profitFactor)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.expectancy)}</td>
      <td className="px-2 py-1 text-right">{fmt.r(r.metrics.maxDrawdownR)}</td>
      <td className="px-2 py-1 text-right">{r.metrics.filtered}</td>
    </tr>
  );
}

export function BacktestTable({ results, pinned }: { results: SetupResult[]; pinned: SetupResult | null }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'expectancy', desc: true });
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)!;
    return [...results].sort((a, b) => (sort.desc ? col.value(b) - col.value(a) : col.value(a) - col.value(b)));
  }, [results, sort]);
  const header = (c: Column) => (
    <th key={c.key} className="px-2 py-1 text-right">
      <button
        onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
        className="text-xs uppercase tracking-wide text-slate-400 hover:text-slate-200"
      >
        {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  return (
    <table className="w-full border-collapse text-xs text-slate-200">
      <thead>
        <tr className="border-b border-slate-700">
          <th className="px-2 py-1 text-left text-xs uppercase tracking-wide text-slate-400">setup</th>
          <th className="px-2 py-1 text-right text-xs uppercase tracking-wide text-slate-400">dir</th>
          {COLUMNS.map(header)}
        </tr>
      </thead>
      <tbody>
        {pinned && <Row r={pinned} pinned />}
        {sorted.map((r) => <Row key={r.kinds.join('+')} r={r} />)}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Implement the panel**

```tsx
// apps/web/src/components/BacktestPanel.tsx
import { useState } from 'react';
import { SIGNAL_KINDS } from '@cta/core';
import { useBacktest } from '../state/useBacktest';
import { BacktestTable } from './BacktestTable';
import type { Interval, SignalKind } from '../api/types';

export function BacktestPanel({ coin, interval }: { coin: string; interval: Interval }) {
  const [minRR, setMinRR] = useState(1.5);
  const [confluenceWindow, setConfluenceWindow] = useState(3);
  const [volumeSpikeK, setVolumeSpikeK] = useState(2);
  const [selected, setSelected] = useState<SignalKind[]>([]);
  const scan = useBacktest(coin, interval);
  const custom = useBacktest(coin, interval);

  const cfg = { confluenceWindow, minRR, volumeSpikeK };
  const toggleKind = (k: SignalKind) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length < 2 ? [...s, k] : s));

  const numberField = (label: string, value: number, set: (n: number) => void, step = 0.1) => (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number" min={0} step={step} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && !Number.isNaN(n)) set(n); }}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right text-slate-200"
      />
    </label>
  );

  const loading = scan.loading || custom.loading;
  const error = scan.error ?? custom.error;
  const pinned = custom.result?.results[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-4">
        {numberField('min R/R', minRR, setMinRR)}
        {numberField('confluence', confluenceWindow, setConfluenceWindow, 1)}
        {numberField('vol spike k', volumeSpikeK, setVolumeSpikeK)}
        <button
          onClick={() => void scan.run(cfg)}
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Run scan
        </button>
        {loading && <span className="text-xs text-slate-400">scanning {coin} {interval}…</span>}
        {scan.result?.cached && <span className="text-xs text-slate-500">cached</span>}
      </div>

      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer select-none">
          Custom set ({selected.length ? selected.join(' + ') : 'pick 1–2 signals'})
        </summary>
        <div className="mt-1 grid grid-cols-3 gap-1 md:grid-cols-5">
          {SIGNAL_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selected.includes(k)}
                disabled={!selected.includes(k) && selected.length >= 2}
                onChange={() => toggleKind(k)}
              />
              {k}
            </label>
          ))}
        </div>
        <button
          onClick={() => void custom.run({ ...cfg, signalKinds: selected })}
          disabled={loading || selected.length === 0}
          className="mt-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          Test selection
        </button>
      </details>

      {error && <div className="rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>}
      {scan.result || pinned ? (
        <BacktestTable results={scan.result?.results ?? []} pinned={pinned} />
      ) : (
        !loading && <p className="text-xs text-slate-500">Run a scan to rank signal setups for {coin} {interval}.</p>
      )}
    </div>
  );
}
```

`apps/web/src/App.tsx` — replace the Task 21 placeholder div content:

```tsx
import { BacktestPanel } from './components/BacktestPanel';
// ...
      <div className={view === 'backtest' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <BacktestPanel coin={config.coin} interval={config.interval} />
      </div>
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cta/web test && pnpm --filter @cta/web exec tsc --noEmit`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/BacktestTable.tsx apps/web/src/components/BacktestPanel.tsx apps/web/src/App.tsx apps/web/test/backtestPanel.test.tsx
git commit -m "feat(web): backtest tab with config strip, ranked table, custom set tester"
```

---

### Task 25: Browser e2e + full verification

**Files:**
- Create: `e2e/phase2.mjs`
- Modify: root `package.json` (devDependency), `.gitignore` (add `e2e/out/`)

- [ ] **Step 1: Install puppeteer-core at the workspace root** (skip if already present in root `package.json`)

Run: `pnpm add -D -w puppeteer-core`

- [ ] **Step 2: Write `e2e/phase2.mjs`**

```js
// Drives the real app against live Hyperliquid data with the system Chrome.
// Prereqs: `pnpm --filter @cta/server start` and `pnpm --filter @cta/web dev` running.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.WEB_URL ?? 'http://localhost:5173';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

mkdirSync('e2e/out', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => fail(`cannot reach ${URL}`));

// 1) Chart tab: markers rendered (Chart.tsx sets window.__markerCount in dev)
await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => fail('chart canvas missing'));
await page.waitForFunction(() => window.__markerCount > 0, { timeout: 30_000 })
  .catch(() => fail('no signal markers rendered'));
const markerCount = await page.evaluate(() => window.__markerCount);
console.log(`PASS: ${markerCount} signal markers on chart`);
await page.screenshot({ path: 'e2e/out/chart.png' });

// 2) Backtest tab: scan populates the ranked table
const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) fail(`button "${text}" not found`);
};
await clickByText('Backtest');
await clickByText('Run scan');
await page.waitForSelector('[data-testid="bt-row"]', { timeout: 120_000 })
  .catch(() => fail('scan produced no result rows'));
const rows = (await page.$$('[data-testid="bt-row"]')).length;
console.log(`PASS: scan rendered ${rows} ranked setups`);
await page.screenshot({ path: 'e2e/out/backtest.png' });

await browser.close();
console.log('E2E PASS');
```

Add `e2e/out/` to `.gitignore`.

- [ ] **Step 3: Full verification suite**

Run, in order, all from repo root:

```bash
pnpm -r test                                  # expect: every package green
pnpm --filter @cta/web exec tsc --noEmit      # expect: silent
pnpm --filter @cta/server start &             # API on :3001
pnpm --filter @cta/web dev &                  # web on :5173
node e2e/phase2.mjs                           # expect: "E2E PASS"
```

Inspect `e2e/out/chart.png` (markers visible on candles — Phase 1 lesson: don't trust the DOM alone, look at the pixels) and `e2e/out/backtest.png` (ranked table with dimmed low-sample rows).

- [ ] **Step 4: Commit**

```bash
git add e2e/phase2.mjs package.json pnpm-lock.yaml .gitignore
git commit -m "test(e2e): phase 2 browser verification (markers + backtest scan)"
```

---

## Out of scope (deliberate)

Per the spec: no per-trade payloads, no triple combos, no regime classification, no lightweight-charts v5, no live signal generation (Phase 3). The web `Run scan` flow intentionally has no automatic scan-on-mount — scans only run on explicit user action.

## Verification mapping (spec TODO → task)

Every spec TODO is covered: ATR (T1), shared intervals (T2), candle patterns (T4–T6), RSI/MA/volume/SR detectors (T7–T9), registry (T10), bracket+filter (T11), management+conservative rule (T12), ATR-only fallback (T11/T12), scan+metrics+determinism (T13), touches (T14), force+tail backfill (T15), analysis signals+404 (T16), result cache (T17/T18), backtest route+validation (T18), rate limiter+timeout (T19), interval typing+favicon (T2/T20), tabs (T21), markers+toggles (T22), useBacktest (T23), backtest tab UI+pinning (T24), e2e (T25).





