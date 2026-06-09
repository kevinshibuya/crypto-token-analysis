# Hyperliquid Token Analysis — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the Hyperliquid analysis tool — a pnpm monorepo that fetches & caches perp candles, computes RSI/SMA/EMA/volume and volume-based S/R server-side, and renders them in a React charting UI.

**Architecture:** Three packages. `packages/core` is pure-TS math (no I/O, fully unit-tested). `apps/server` is a Fastify API owning the Hyperliquid client, a token-bucket rate limiter, and a SQLite candle cache; it composes `core` to answer analysis requests. `apps/web` is a Vite/React/Tailwind UI (Layout A) that renders responses with lightweight-charts and holds no analysis logic.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (TDD), Fastify, better-sqlite3, React + Vite + Tailwind, lightweight-charts.

**Spec:** `docs/superpowers/specs/2026-06-09-phase1-foundation-design.md`

---

## Conventions

- Package manager is **pnpm**. Run commands from the repo root unless stated otherwise.
- Run a single package's tests with `pnpm --filter <name> test`, all with `pnpm -r test`.
- The server and web run via `tsx`/Vite in dev — **no build step is required** for Phase 1. `@cta/core` is consumed directly from its TypeScript source (its `exports` point at `src/index.ts`); Vitest and tsx resolve TS natively.
- Relative imports are **extensionless** (TS "Bundler" module resolution).
- Workspace package names: `@cta/core`, `@cta/server`, `@cta/web`.
- Each task is one TDD cycle: write the failing test → see it fail → minimal implementation → see it pass → commit. Commit test + implementation together.
- Implementation work happens on a feature branch (created at execution time via `superpowers:using-git-worktrees`), not on `main`.

## File Structure

```
crypto-token-analysis/
  package.json                       # root: pnpm workspaces + scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/core/
    package.json  tsconfig.json  vitest.config.ts
    src/
      types.ts            # Candle, IndicatorPoint, MA/Volume/Profile/Pivot result types, AnalysisResult
      sma.ts  ema.ts  rsi.ts
      volume.ts           # volume bars + volume SMA
      volumeProfile.ts    # uniform [low,high] distribution → rows + POC + value area
      pivots.ts           # volume-weighted swing pivots + merge
      index.ts            # re-exports
    test/                 # one *.test.ts per module
  apps/server/
    package.json  tsconfig.json  vitest.config.ts
    src/
      config.ts                      # defaults & constants
      hyperliquid/
        client.ts                    # POST /info: meta + candleSnapshot
        rateLimiter.ts               # token bucket
        pagination.ts                # paginate candleSnapshot past 5000/req
      cache/
        db.ts                        # better-sqlite3 setup + schema
        candleStore.ts               # upsert/query candles + incremental fetch orchestration
        marketStore.ts               # markets list cache
      services/
        marketsService.ts
        analysisService.ts           # candles + core compute → AnalysisResult
      routes/
        health.ts  markets.ts  analysis.ts
      app.ts                         # build Fastify instance (+ register routes)
      server.ts                      # listen
    test/
  apps/web/
    package.json  tsconfig.json  vite.config.ts  index.html
    tailwind.config.js  postcss.config.js
    src/
      main.tsx  App.tsx  index.css
      api/client.ts                  # typed fetch wrappers
      state/useAnalysis.ts           # config + data hook
      components/
        Toolbar.tsx  MarketPicker.tsx  TimeframePills.tsx
        IndicatorDrawer.tsx  Chart.tsx  VolumeProfileOverlay.tsx
    test/
  .env.example
  README.md
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "crypto-token-analysis",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "dev": "pnpm -r --parallel dev",
    "dev:server": "pnpm --filter @cta/server dev",
    "dev:web": "pnpm --filter @cta/web dev"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  },
  "packageManager": "pnpm@9.1.0"
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Verify install works**

Run: `pnpm install`
Expected: completes without error, creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo"
```

---

## Task 2: `packages/core` scaffold + shared types

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@cta/core",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "test:watch": "vitest" },
  "devDependencies": { "typescript": "^5.4.5", "vitest": "^1.6.0" }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `packages/core/src/types.ts`**

```ts
export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number; // trade count
}

export interface IndicatorPoint {
  t: number;
  value: number;
}

export type MaType = 'SMA' | 'EMA';

export interface MovingAverageResult {
  type: MaType;
  period: number;
  points: IndicatorPoint[];
}

export interface VolumeBar {
  t: number;
  value: number;
  up: boolean; // close >= open
}

export interface VolumeResult {
  bars: VolumeBar[];
  sma: IndicatorPoint[];
}

export interface VolumeProfileRow {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

export interface VolumeProfileResult {
  rows: VolumeProfileRow[];
  poc: number; // price at point of control
  valueArea: { low: number; high: number };
}

export type PivotType = 'support' | 'resistance';

export interface PivotLevel {
  price: number;
  type: PivotType;
  strength: number; // summed volume around the pivot
  touches: number;
}

export interface AnalysisResult {
  coin: string;
  interval: string;
  candles: Candle[];
  rsi: IndicatorPoint[];
  movingAverages: MovingAverageResult[];
  volume: VolumeResult;
  volumeProfile: VolumeProfileResult;
  pivots: PivotLevel[];
}
```

- [ ] **Step 5: Create `packages/core/src/index.ts`**

```ts
export * from './types';
```

- [ ] **Step 6: Verify the test runner starts**

Run: `pnpm --filter @cta/core test`
Expected: Vitest runs, reports "No test files found" (exit 0 with `--passWithNoTests` is not set, so it may exit 1 — that's fine; the next task adds tests). Proceed.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "chore: scaffold @cta/core with shared types"
```

---

## Task 3: SMA

**Files:**
- Create: `packages/core/src/sma.ts`, `packages/core/test/sma.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/sma.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sma } from '../src/sma';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('sma', () => {
  it('computes a simple moving average aligned to the candle time', () => {
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(sma(candles, 3)).toEqual([
      { t: 3, value: 2 },
      { t: 4, value: 3 },
      { t: 5, value: 4 },
    ]);
  });

  it('returns empty when fewer candles than the period', () => {
    expect(sma([c(1, 1), c(2, 2)], 3)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => sma([c(1, 1)], 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/sma`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/sma.ts`

```ts
import type { Candle, IndicatorPoint } from './types';

export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('sma: period must be > 0');
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ t: candles[i].t, value: sum / period });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sma.ts packages/core/test/sma.test.ts
git commit -m "feat(core): add SMA"
```

---

## Task 4: EMA

**Files:**
- Create: `packages/core/src/ema.ts`, `packages/core/test/ema.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/ema.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ema } from '../src/ema';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('ema', () => {
  it('seeds with the SMA of the first `period` closes, then smooths', () => {
    // closes 1..5, period 3, k = 0.5. seed = (1+2+3)/3 = 2 @ t3; then 4*.5+2*.5=3 @ t4; 5*.5+3*.5=4 @ t5
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(ema(candles, 3)).toEqual([
      { t: 3, value: 2 },
      { t: 4, value: 3 },
      { t: 5, value: 4 },
    ]);
  });

  it('returns empty when fewer candles than the period', () => {
    expect(ema([c(1, 1), c(2, 2)], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/ema`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/ema.ts`

```ts
import type { Candle, IndicatorPoint } from './types';

export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('ema: period must be > 0');
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: IndicatorPoint[] = [];
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].c;
  let prev = seed / period;
  out.push({ t: candles[period - 1].t, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].c * k + prev * (1 - k);
    out.push({ t: candles[i].t, value: prev });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ema.ts packages/core/test/ema.test.ts
git commit -m "feat(core): add EMA"
```

---

## Task 5: RSI (Wilder)

**Files:**
- Create: `packages/core/src/rsi.ts`, `packages/core/test/rsi.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/rsi.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { rsi } from '../src/rsi';
import type { Candle } from '../src/types';

const c = (t: number, close: number): Candle => ({ t, o: close, h: close, l: close, c: close, v: 1 });

describe('rsi', () => {
  it('is 100 when every change is a gain', () => {
    const candles = [c(1, 1), c(2, 2), c(3, 3), c(4, 4), c(5, 5)];
    expect(rsi(candles, 2).every((p) => p.value === 100)).toBe(true);
  });

  it('matches a hand-computed Wilder example', () => {
    // closes [1,3,2,4], period 2:
    //   first avg over changes +2,-1 -> avgGain 1, avgLoss .5 -> RSI 66.667 @ t3
    //   next change +2 -> avgGain 1.5, avgLoss .25 -> RSI 85.714 @ t4
    const candles = [c(1, 1), c(2, 3), c(3, 2), c(4, 4)];
    const r = rsi(candles, 2);
    expect(r).toHaveLength(2);
    expect(r[0].t).toBe(3);
    expect(r[0].value).toBeCloseTo(66.667, 2);
    expect(r[1].value).toBeCloseTo(85.714, 2);
  });

  it('returns empty when candles <= period', () => {
    expect(rsi([c(1, 1), c(2, 2)], 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/rsi`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/rsi.ts`

```ts
import type { Candle, IndicatorPoint } from './types';

export function rsi(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 0) throw new Error('rsi: period must be > 0');
  if (candles.length <= period) return [];

  const fromAverages = (avgGain: number, avgLoss: number): number =>
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].c - candles[i - 1].c;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  const out: IndicatorPoint[] = [{ t: candles[period].t, value: fromAverages(avgGain, avgLoss) }];
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].c - candles[i - 1].c;
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push({ t: candles[i].t, value: fromAverages(avgGain, avgLoss) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rsi.ts packages/core/test/rsi.test.ts
git commit -m "feat(core): add Wilder RSI"
```

---

## Task 6: Volume + volume SMA

**Files:**
- Create: `packages/core/src/volume.ts`, `packages/core/test/volume.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/volume.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { volume } from '../src/volume';
import type { Candle } from '../src/types';

const c = (t: number, open: number, close: number, v: number): Candle => ({ t, o: open, h: close, l: open, c: close, v });

describe('volume', () => {
  it('produces one bar per candle, tagged up/down by direction', () => {
    const candles = [c(1, 1, 2, 10), c(2, 2, 1, 20)];
    const { bars } = volume(candles, 2);
    expect(bars).toEqual([
      { t: 1, value: 10, up: true },
      { t: 2, value: 20, up: false },
    ]);
  });

  it('computes a volume SMA aligned to candle time', () => {
    const candles = [c(1, 1, 1, 10), c(2, 1, 1, 20), c(3, 1, 1, 30)];
    expect(volume(candles, 2).sma).toEqual([
      { t: 2, value: 15 },
      { t: 3, value: 25 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/volume`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/volume.ts`

```ts
import type { Candle, IndicatorPoint, VolumeBar, VolumeResult } from './types';

export function volume(candles: Candle[], smaPeriod: number): VolumeResult {
  if (smaPeriod <= 0) throw new Error('volume: smaPeriod must be > 0');
  const bars: VolumeBar[] = candles.map((c) => ({ t: c.t, value: c.v, up: c.c >= c.o }));
  const sma: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].v;
    if (i >= smaPeriod) sum -= candles[i - smaPeriod].v;
    if (i >= smaPeriod - 1) sma.push({ t: candles[i].t, value: sum / smaPeriod });
  }
  return { bars, sma };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/volume.ts packages/core/test/volume.test.ts
git commit -m "feat(core): add volume bars + volume SMA"
```

---

## Task 7: Volume profile

**Files:**
- Create: `packages/core/src/volumeProfile.ts`, `packages/core/test/volumeProfile.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/volumeProfile.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { volumeProfile } from '../src/volumeProfile';
import type { Candle } from '../src/types';

describe('volumeProfile', () => {
  it('distributes volume uniformly across [low,high] and finds POC + value area', () => {
    // A spreads 10 volume evenly over price [0,10] across 10 rows -> 1 per row.
    // B dumps 100 volume into [5,6] -> all into row index 5.
    const candles: Candle[] = [
      { t: 1, o: 4, h: 10, l: 0, c: 5, v: 10 },
      { t: 2, o: 5.4, h: 6, l: 5, c: 5.5, v: 100 },
    ];
    const res = volumeProfile(candles, 10);
    expect(res.rows).toHaveLength(10);
    // row 5 = [5,6] holds 1 (from A) + 100 (from B) = 101
    expect(res.rows[5].priceLow).toBeCloseTo(5);
    expect(res.rows[5].priceHigh).toBeCloseTo(6);
    expect(res.rows[5].volume).toBeCloseTo(101);
    expect(res.poc).toBeCloseTo(5.5); // midpoint of row 5
    // total = 110, 70% = 77; row 5 alone (101) covers it -> value area = [5,6]
    expect(res.valueArea.low).toBeCloseTo(5);
    expect(res.valueArea.high).toBeCloseTo(6);
  });

  it('handles empty input', () => {
    expect(volumeProfile([], 10)).toEqual({ rows: [], poc: 0, valueArea: { low: 0, high: 0 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/volumeProfile`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/volumeProfile.ts`

```ts
import type { Candle, VolumeProfileResult, VolumeProfileRow } from './types';

const VALUE_AREA_FRACTION = 0.7;

export function volumeProfile(candles: Candle[], rows: number): VolumeProfileResult {
  if (rows <= 0) throw new Error('volumeProfile: rows must be > 0');
  if (candles.length === 0) return { rows: [], poc: 0, valueArea: { low: 0, high: 0 } };

  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.l < min) min = c.l;
    if (c.h > max) max = c.h;
  }
  if (max === min) max = min + 1;
  const binSize = (max - min) / rows;
  const vol = new Array<number>(rows).fill(0);

  for (const c of candles) {
    const span = c.h - c.l;
    if (span <= 0) {
      let idx = Math.floor((c.c - min) / binSize);
      idx = Math.max(0, Math.min(rows - 1, idx));
      vol[idx] += c.v;
      continue;
    }
    const firstBin = Math.max(0, Math.floor((c.l - min) / binSize));
    const lastBin = Math.min(rows - 1, Math.floor((c.h - min) / binSize));
    for (let b = firstBin; b <= lastBin; b++) {
      const binLow = min + b * binSize;
      const binHigh = binLow + binSize;
      const overlap = Math.min(c.h, binHigh) - Math.max(c.l, binLow);
      if (overlap > 0) vol[b] += c.v * (overlap / span);
    }
  }

  const profileRows: VolumeProfileRow[] = vol.map((v, b) => ({
    priceLow: min + b * binSize,
    priceHigh: min + (b + 1) * binSize,
    volume: v,
  }));

  let pocIdx = 0;
  for (let b = 1; b < rows; b++) if (vol[b] > vol[pocIdx]) pocIdx = b;
  const poc = (profileRows[pocIdx].priceLow + profileRows[pocIdx].priceHigh) / 2;

  const total = vol.reduce((a, b) => a + b, 0);
  let included = vol[pocIdx];
  let lo = pocIdx;
  let hi = pocIdx;
  while (included < total * VALUE_AREA_FRACTION && (lo > 0 || hi < rows - 1)) {
    const below = lo > 0 ? vol[lo - 1] : -1;
    const above = hi < rows - 1 ? vol[hi + 1] : -1;
    if (above >= below) {
      hi++;
      included += vol[hi];
    } else {
      lo--;
      included += vol[lo];
    }
  }

  return {
    rows: profileRows,
    poc,
    valueArea: { low: profileRows[lo].priceLow, high: profileRows[hi].priceHigh },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/volumeProfile.ts packages/core/test/volumeProfile.test.ts
git commit -m "feat(core): add volume profile (POC + value area)"
```

---

## Task 8: Volume-weighted swing pivots

**Files:**
- Create: `packages/core/src/pivots.ts`, `packages/core/test/pivots.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/pivots.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { pivots } from '../src/pivots';
import type { Candle } from '../src/types';

const c = (t: number, h: number, l: number, close: number, v = 1): Candle => ({ t, o: close, h, l, c: close, v });

describe('pivots', () => {
  it('finds a swing high (resistance) and swing low (support) relative to current price', () => {
    // highs: 10,12,11,9,11 ; lows: 8,9,7,6,8 ; last close 9
    const candles = [
      c(1, 10, 8, 9),
      c(2, 12, 9, 9),
      c(3, 11, 7, 9),
      c(4, 9, 6, 9),
      c(5, 11, 8, 9),
    ];
    const levels = pivots(candles, { lookback: 1, maxLevels: 6, mergeTolerance: 0.003 });
    const prices = levels.map((p) => ({ price: p.price, type: p.type }));
    expect(prices).toContainEqual({ price: 12, type: 'resistance' });
    expect(prices).toContainEqual({ price: 6, type: 'support' });
  });

  it('returns at most maxLevels, strongest first', () => {
    const candles = [
      c(1, 10, 8, 9),
      c(2, 12, 9, 9, 5),
      c(3, 11, 7, 9),
      c(4, 9, 6, 9, 1),
      c(5, 11, 8, 9),
    ];
    const levels = pivots(candles, { lookback: 1, maxLevels: 1, mergeTolerance: 0.003 });
    expect(levels).toHaveLength(1);
    expect(levels[0].price).toBe(12); // higher surrounding volume
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — cannot find module `../src/pivots`.

- [ ] **Step 3: Write minimal implementation** — `packages/core/src/pivots.ts`

```ts
import type { Candle, PivotLevel, PivotType } from './types';

export interface PivotOptions {
  lookback: number; // bars on each side
  maxLevels: number;
  mergeTolerance: number; // fraction of price, e.g. 0.003
  volumeWindow?: number; // bars each side summed for strength (default = lookback)
}

export function pivots(candles: Candle[], opts: PivotOptions): PivotLevel[] {
  const { lookback, maxLevels, mergeTolerance } = opts;
  if (lookback <= 0) throw new Error('pivots: lookback must be > 0');
  const vWin = opts.volumeWindow ?? lookback;
  const current = candles.length ? candles[candles.length - 1].c : 0;

  interface Raw { price: number; strength: number }
  const raw: Raw[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    let strength = 0;
    for (let j = Math.max(0, i - vWin); j <= Math.min(candles.length - 1, i + vWin); j++) {
      strength += candles[j].v;
    }
    if (isHigh) raw.push({ price: candles[i].h, strength });
    if (isLow) raw.push({ price: candles[i].l, strength });
  }

  raw.sort((a, b) => a.price - b.price);
  const merged: { price: number; strength: number; touches: number }[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(r.price - last.price) / last.price <= mergeTolerance) {
      const total = last.strength + r.strength;
      last.price = (last.price * last.strength + r.price * r.strength) / total;
      last.strength = total;
      last.touches += 1;
    } else {
      merged.push({ price: r.price, strength: r.strength, touches: 1 });
    }
  }

  const levels: PivotLevel[] = merged.map((m) => ({
    price: m.price,
    type: (m.price >= current ? 'resistance' : 'support') as PivotType,
    strength: m.strength,
    touches: m.touches,
  }));
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pivots.ts packages/core/test/pivots.test.ts
git commit -m "feat(core): add volume-weighted swing pivots"
```

---

## Task 9: Core public API (`index.ts`)

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/index.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as core from '../src/index';

describe('core index', () => {
  it('re-exports every public function', () => {
    for (const name of ['sma', 'ema', 'rsi', 'volume', 'volumeProfile', 'pivots']) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/core test`
Expected: FAIL — exports are missing.

- [ ] **Step 3: Update `packages/core/src/index.ts`**

```ts
export * from './types';
export { sma } from './sma';
export { ema } from './ema';
export { rsi } from './rsi';
export { volume } from './volume';
export { volumeProfile } from './volumeProfile';
export { pivots } from './pivots';
export type { PivotOptions } from './pivots';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/core test`
Expected: PASS (all core tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "feat(core): expose public API surface"
```

---

## Task 10: `apps/server` scaffold + `/api/health`

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/config.ts`, `apps/server/src/routes/health.ts`, `apps/server/src/app.ts`, `apps/server/src/server.ts`, `apps/server/test/health.test.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@cta/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@cta/core": "workspace:*",
    "fastify": "^4.28.0",
    "better-sqlite3": "^11.1.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.9",
    "tsx": "^4.16.2",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `apps/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `apps/server/src/config.ts`**

```ts
export const HYPERLIQUID_BASE_URL = process.env.HL_BASE_URL ?? 'https://api.hyperliquid.xyz';
export const RATE_LIMIT_CAPACITY = 1200; // IP weight budget per minute
export const RATE_LIMIT_REFILL_PER_SEC = 1200 / 60;
export const MAX_CANDLES_PER_REQUEST = 5000;
export const DEFAULT_LOOKBACK = 1000;
export const CACHE_DB_PATH = process.env.CACHE_DB_PATH ?? 'data/cache.sqlite';

export const SUPPORTED_INTERVALS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
] as const;
export type Interval = (typeof SUPPORTED_INTERVALS)[number];

export const DEFAULTS = {
  rsiPeriod: 14,
  volumeSmaPeriod: 20,
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMergeTolerance: 0.003,
  pivotMaxLevels: 6,
};
```

- [ ] **Step 5: Create `apps/server/src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

const startedAt = Date.now();

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  }));
}
```

- [ ] **Step 6: Create `apps/server/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  return app;
}
```

- [ ] **Step 7: Create `apps/server/src/server.ts`**

```ts
import { buildApp } from './app';

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`server listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 8: Write the failing test** — `apps/server/test/health.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});
```

- [ ] **Step 9: Install deps and run the test**

Run: `pnpm install && pnpm --filter @cta/server test`
Expected: PASS (1 test). (`pnpm install` builds the native `better-sqlite3` module.)

- [ ] **Step 10: Commit**

```bash
git add apps/server package.json pnpm-lock.yaml
git commit -m "feat(server): scaffold Fastify app with health route"
```

---

## Task 11: Rate limiter (token bucket)

**Files:**
- Create: `apps/server/src/hyperliquid/rateLimiter.ts`, `apps/server/test/rateLimiter.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/rateLimiter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/hyperliquid/rateLimiter';

describe('RateLimiter', () => {
  it('acquires immediately while tokens remain', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(1200, 20, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    await rl.acquire(84);
    expect(sleeps).toEqual([]);
    expect(rl.available).toBeCloseTo(1116, 0);
  });

  it('waits for refill when exhausted', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(100, 20, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    await rl.acquire(100); // drain
    await rl.acquire(20);  // need 20 tokens at 20/s -> ~1000ms
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeCloseTo(1000, -1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — cannot find module `../src/hyperliquid/rateLimiter`.

- [ ] **Step 3: Write minimal implementation** — `apps/server/src/hyperliquid/rateLimiter.ts`

```ts
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = t;
  }

  async acquire(weight: number): Promise<void> {
    const w = Math.min(weight, this.capacity);
    for (;;) {
      this.refill();
      if (this.tokens >= w) {
        this.tokens -= w;
        return;
      }
      const needed = w - this.tokens;
      await this.sleep((needed / this.refillPerSec) * 1000);
    }
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/hyperliquid/rateLimiter.ts apps/server/test/rateLimiter.test.ts
git commit -m "feat(server): add token-bucket rate limiter"
```

---

## Task 12: Hyperliquid client

**Files:**
- Create: `apps/server/src/hyperliquid/client.ts`, `apps/server/test/client.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/client.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { HyperliquidClient } from '../src/hyperliquid/client';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('HyperliquidClient', () => {
  it('requests candleSnapshot and parses numeric fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ t: 1, T: 2, o: '1.5', h: '2.0', l: '1.0', c: '1.8', v: '100', n: 5, s: 'BTC', i: '1h' }]),
    );
    const client = new HyperliquidClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const candles = await client.candleSnapshot('BTC', '1h', 0, 10);
    expect(candles).toEqual([{ t: 1, o: 1.5, h: 2, l: 1, c: 1.8, v: 100, n: 5 }]);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'candleSnapshot',
      req: { coin: 'BTC', interval: '1h', startTime: 0, endTime: 10 },
    });
  });

  it('retries on 429 then throws with status when exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 429));
    const client = new HyperliquidClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
      sleep: async () => {},
    });
    await expect(client.candleSnapshot('BTC', '1h', 0, 10)).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('retries a transient 429 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1
        ? jsonResponse({}, false, 429)
        : jsonResponse([{ t: 1, T: 2, o: '1', h: '1', l: '1', c: '1', v: '1', n: 0, s: 'BTC', i: '1h' }]);
    });
    const client = new HyperliquidClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const candles = await client.candleSnapshot('BTC', '1h', 0, 10);
    expect(candles).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — cannot find module `../src/hyperliquid/client`.

- [ ] **Step 3: Write minimal implementation** — `apps/server/src/hyperliquid/client.ts`

```ts
import type { Candle } from '@cta/core';
import { HYPERLIQUID_BASE_URL } from '../config';

export interface HyperliquidClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number; // retries on 429/5xx/network (default 4)
  baseDelayMs?: number; // first backoff delay in ms (default 500)
  sleep?: (ms: number) => Promise<void>;
}

interface RawCandle {
  t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number; s: string; i: string;
}

export interface MetaUniverseItem {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export class HyperliquidClient {
  private baseUrl: string;
  private f: typeof fetch;
  private maxRetries: number;
  private baseDelayMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: HyperliquidClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? HYPERLIQUID_BASE_URL;
    this.f = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async post<T>(body: unknown): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(`${this.baseUrl}/info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        if (attempt >= this.maxRetries) throw networkErr;
        await this.sleep(this.baseDelayMs * 2 ** attempt++);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        await this.sleep(this.baseDelayMs * 2 ** attempt++);
        continue;
      }
      const err = new Error(`Hyperliquid request failed: ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
  }

  async meta(): Promise<{ universe: MetaUniverseItem[] }> {
    return this.post({ type: 'meta' });
  }

  async candleSnapshot(coin: string, interval: string, startTime: number, endTime: number): Promise<Candle[]> {
    const raw = await this.post<RawCandle[]>({
      type: 'candleSnapshot',
      req: { coin, interval, startTime, endTime },
    });
    return raw.map((r) => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v, n: r.n }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/hyperliquid/client.ts apps/server/test/client.test.ts
git commit -m "feat(server): add Hyperliquid info client (meta + candleSnapshot)"
```

---

## Task 13: Candle pagination

**Files:**
- Create: `apps/server/src/hyperliquid/pagination.ts`, `apps/server/test/pagination.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/pagination.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fetchCandles, INTERVAL_MS } from '../src/hyperliquid/pagination';
import type { Candle } from '@cta/core';

describe('fetchCandles pagination', () => {
  it('walks rolling windows past the 5000-candle cap and dedupes', async () => {
    const step = INTERVAL_MS['1m'];
    const start = 0;
    const total = 12000;
    const end = start + (total - 1) * step;

    // Source emulates the API: returns at most 5000 candles within [s, e].
    const page = (s: number, e: number): Candle[] => {
      const out: Candle[] = [];
      for (let t = Math.max(start, s); t <= Math.min(end, e); t += step) {
        out.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
      }
      return out.slice(0, 5000);
    };

    let calls = 0;
    const candles = await fetchCandles((s, e) => { calls++; return Promise.resolve(page(s, e)); }, '1m', start, end);

    expect(candles).toHaveLength(total);
    expect(candles[0].t).toBe(start);
    expect(candles[candles.length - 1].t).toBe(end);
    expect(calls).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < candles.length; i++) expect(candles[i].t).toBeGreaterThan(candles[i - 1].t);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — cannot find module `../src/hyperliquid/pagination`.

- [ ] **Step 3: Write minimal implementation** — `apps/server/src/hyperliquid/pagination.ts`

```ts
import type { Candle } from '@cta/core';
import { MAX_CANDLES_PER_REQUEST } from '../config';

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};

export async function fetchCandles(
  fetchPage: (start: number, end: number) => Promise<Candle[]>,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const step = INTERVAL_MS[interval];
  if (!step) throw new Error(`unknown interval ${interval}`);
  const windowMs = step * MAX_CANDLES_PER_REQUEST;
  const byT = new Map<number, Candle>();

  let cursor = startTime;
  while (cursor <= endTime) {
    const winEnd = Math.min(endTime, cursor + windowMs - step);
    const page = await fetchPage(cursor, winEnd);
    for (const c of page) byT.set(c.t, c);
    if (page.length === 0) {
      cursor = winEnd + step; // nothing here; skip the window
    } else {
      const lastT = page[page.length - 1].t;
      cursor = Math.max(lastT + step, winEnd + step);
    }
  }

  return [...byT.values()].sort((a, b) => a.t - b.t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/hyperliquid/pagination.ts apps/server/test/pagination.test.ts
git commit -m "feat(server): paginate candleSnapshot past the 5000/req cap"
```

---

## Task 14: SQLite cache (db + candle store)

**Files:**
- Create: `apps/server/src/cache/db.ts`, `apps/server/src/cache/candleStore.ts`, `apps/server/test/candleStore.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/candleStore.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/cache/db';
import { CandleStore } from '../src/cache/candleStore';
import type { Candle } from '@cta/core';

const c = (t: number): Candle => ({ t, o: 1, h: 2, l: 0, c: 1.5, v: 10, n: 3 });

describe('CandleStore', () => {
  it('upserts and reads candles back in range', () => {
    const store = new CandleStore(openDb(':memory:'));
    store.upsert('BTC', '1h', [c(1), c(2), c(3)]);
    expect(store.get('BTC', '1h', 2, 3)).toEqual([c(2), c(3)]);
    expect(store.latestTime('BTC', '1h')).toBe(3);
  });

  it('updates on conflict instead of duplicating', () => {
    const store = new CandleStore(openDb(':memory:'));
    store.upsert('BTC', '1h', [c(1)]);
    store.upsert('BTC', '1h', [{ ...c(1), c: 9 }]);
    const rows = store.get('BTC', '1h', 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].c).toBe(9);
  });

  it('returns null latestTime for an unknown series', () => {
    const store = new CandleStore(openDb(':memory:'));
    expect(store.latestTime('ETH', '1h')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — cannot find module `../src/cache/db`.

- [ ] **Step 3: Write `apps/server/src/cache/db.ts`**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      coin TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, n INTEGER,
      PRIMARY KEY (coin, interval, t)
    );
    CREATE TABLE IF NOT EXISTS markets (
      name TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt INTEGER NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 4: Write `apps/server/src/cache/candleStore.ts`**

```ts
import type { Candle } from '@cta/core';
import type { DB } from './db';

export class CandleStore {
  constructor(private db: DB) {}

  upsert(coin: string, interval: string, candles: Candle[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO candles (coin, interval, t, o, h, l, c, v, n)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(coin, interval, t) DO UPDATE SET
         o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v, n=excluded.n`,
    );
    const tx = this.db.transaction((rows: Candle[]) => {
      for (const r of rows) stmt.run(coin, interval, r.t, r.o, r.h, r.l, r.c, r.v, r.n ?? null);
    });
    tx(candles);
  }

  get(coin: string, interval: string, from: number, to: number): Candle[] {
    return this.db
      .prepare(
        `SELECT t, o, h, l, c, v, n FROM candles
         WHERE coin = ? AND interval = ? AND t >= ? AND t <= ? ORDER BY t ASC`,
      )
      .all(coin, interval, from, to) as Candle[];
  }

  latestTime(coin: string, interval: string): number | null {
    const row = this.db
      .prepare(`SELECT MAX(t) AS maxT FROM candles WHERE coin = ? AND interval = ?`)
      .get(coin, interval) as { maxT: number | null };
    return row.maxT ?? null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/cache/db.ts apps/server/src/cache/candleStore.ts apps/server/test/candleStore.test.ts
git commit -m "feat(server): add SQLite candle cache"
```

---

## Task 15: Candle service (incremental fetch orchestration)

**Files:**
- Create: `apps/server/src/services/candleService.ts`, `apps/server/test/candleService.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/candleService.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { CandleService } from '../src/services/candleService';
import { CandleStore } from '../src/cache/candleStore';
import { openDb } from '../src/cache/db';
import { INTERVAL_MS } from '../src/hyperliquid/pagination';
import type { Candle } from '@cta/core';

const noopLimiter = { acquire: async () => {}, available: 0 } as any;

function makeClient(source: Candle[]) {
  return {
    candleSnapshot: vi.fn(async (_c: string, _i: string, s: number, e: number) =>
      source.filter((c) => c.t >= s && c.t <= e).slice(0, 5000),
    ),
  } as any;
}

describe('CandleService', () => {
  it('fetches on a cold cache, then serves from cache when fresh', async () => {
    const step = INTERVAL_MS['1h'];
    const now = 100 * step;
    const source: Candle[] = [];
    for (let t = 0; t <= now; t += step) source.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });

    const client = makeClient(source);
    const store = new CandleStore(openDb(':memory:'));
    const svc = new CandleService({ client, store, rateLimiter: noopLimiter, now: () => now });

    const first = await svc.getCandles('BTC', '1h', 10);
    expect(client.candleSnapshot).toHaveBeenCalled();
    expect(first).toHaveLength(11); // last 10 + inclusive boundary

    client.candleSnapshot.mockClear();
    const second = await svc.getCandles('BTC', '1h', 10);
    expect(client.candleSnapshot).not.toHaveBeenCalled();
    expect(second).toHaveLength(first.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — cannot find module `../src/services/candleService`.

- [ ] **Step 3: Write minimal implementation** — `apps/server/src/services/candleService.ts`

```ts
import type { Candle } from '@cta/core';
import { fetchCandles, INTERVAL_MS } from '../hyperliquid/pagination';
import { MAX_CANDLES_PER_REQUEST } from '../config';
import type { CandleStore } from '../cache/candleStore';
import type { HyperliquidClient } from '../hyperliquid/client';
import type { RateLimiter } from '../hyperliquid/rateLimiter';

export interface CandleServiceDeps {
  client: HyperliquidClient;
  store: CandleStore;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export class CandleService {
  private now: () => number;
  constructor(private deps: CandleServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async getCandles(coin: string, interval: string, lookback: number): Promise<Candle[]> {
    const step = INTERVAL_MS[interval];
    if (!step) throw new Error(`unknown interval ${interval}`);
    const end = this.now();
    const wantStart = end - lookback * step;
    const latest = this.deps.store.latestTime(coin, interval);
    const fetchStart = latest === null ? wantStart : Math.min(wantStart, latest + step);

    if (latest === null || latest < end - step) {
      await this.fetchAndStore(coin, interval, fetchStart, end);
    }
    return this.deps.store.get(coin, interval, wantStart, end);
  }

  private async fetchAndStore(coin: string, interval: string, start: number, end: number): Promise<void> {
    const step = INTERVAL_MS[interval];
    const candles = await fetchCandles(
      async (s, e) => {
        const est = Math.min(MAX_CANDLES_PER_REQUEST, Math.ceil((e - s) / step) + 1);
        await this.deps.rateLimiter.acquire(Math.max(1, Math.ceil(est / 60)));
        return this.deps.client.candleSnapshot(coin, interval, s, e);
      },
      interval,
      start,
      end,
    );
    if (candles.length) this.deps.store.upsert(coin, interval, candles);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/candleService.ts apps/server/test/candleService.test.ts
git commit -m "feat(server): add incremental candle fetch service"
```

---

## Task 16: Markets store, service & route

**Files:**
- Create: `apps/server/src/cache/marketStore.ts`, `apps/server/src/services/marketsService.ts`, `apps/server/src/routes/markets.ts`, `apps/server/test/markets.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/markets.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app';
import { MarketsService } from '../src/services/marketsService';
import { MarketStore } from '../src/cache/marketStore';
import { openDb } from '../src/cache/db';

const noopLimiter = { acquire: async () => {}, available: 0 } as any;

describe('MarketsService', () => {
  it('fetches once then serves cache within TTL', async () => {
    const client = { meta: vi.fn(async () => ({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }] })) } as any;
    const store = new MarketStore(openDb(':memory:'));
    let now = 0;
    const svc = new MarketsService({ client, store, rateLimiter: noopLimiter, now: () => now });
    const a = await svc.getMarkets();
    expect(a.markets[0].name).toBe('BTC');
    expect(client.meta).toHaveBeenCalledTimes(1);
    now += 1000;
    await svc.getMarkets();
    expect(client.meta).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/markets', () => {
  it('returns markets from the service', async () => {
    const marketsService = {
      getMarkets: async () => ({ markets: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }], updatedAt: 123 }),
    } as any;
    const app = buildApp({ marketsService });
    const res = await app.inject({ method: 'GET', url: '/api/markets' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ markets: [{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }], updatedAt: 123 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — modules missing / `buildApp` doesn't accept deps yet.

- [ ] **Step 3: Write `apps/server/src/cache/marketStore.ts`**

```ts
import type { DB } from './db';

export interface MarketRow {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export class MarketStore {
  constructor(private db: DB) {}

  get(): { markets: MarketRow[]; updatedAt: number } | null {
    const row = this.db.prepare(`SELECT data, updatedAt FROM markets WHERE name = '__all__'`).get() as
      | { data: string; updatedAt: number }
      | undefined;
    if (!row) return null;
    return { markets: JSON.parse(row.data) as MarketRow[], updatedAt: row.updatedAt };
  }

  set(markets: MarketRow[], updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO markets (name, data, updatedAt) VALUES ('__all__', ?, ?)
         ON CONFLICT(name) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`,
      )
      .run(JSON.stringify(markets), updatedAt);
  }
}
```

- [ ] **Step 4: Write `apps/server/src/services/marketsService.ts`**

```ts
import type { HyperliquidClient } from '../hyperliquid/client';
import type { RateLimiter } from '../hyperliquid/rateLimiter';
import type { MarketRow, MarketStore } from '../cache/marketStore';

const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface MarketsServiceDeps {
  client: HyperliquidClient;
  store: MarketStore;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export class MarketsService {
  private now: () => number;
  constructor(private deps: MarketsServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async getMarkets(): Promise<{ markets: MarketRow[]; updatedAt: number }> {
    const cached = this.deps.store.get();
    const t = this.now();
    if (cached && t - cached.updatedAt < TTL_MS) return cached;
    await this.deps.rateLimiter.acquire(20);
    const meta = await this.deps.client.meta();
    const markets: MarketRow[] = meta.universe.map((u) => ({
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
    }));
    this.deps.store.set(markets, t);
    return { markets, updatedAt: t };
  }
}
```

- [ ] **Step 5: Write `apps/server/src/routes/markets.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { MarketsService } from '../services/marketsService';

export function registerMarketsRoute(app: FastifyInstance, svc: MarketsService): void {
  app.get('/api/markets', async () => svc.getMarkets());
}
```

- [ ] **Step 6: Update `apps/server/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import type { MarketsService } from './services/marketsService';

export interface AppDeps {
  marketsService: MarketsService;
}

export function buildApp(deps: Partial<AppDeps> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  return app;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/cache/marketStore.ts apps/server/src/services/marketsService.ts apps/server/src/routes/markets.ts apps/server/src/app.ts apps/server/test/markets.test.ts
git commit -m "feat(server): add markets cache, service and route"
```

---

## Task 17: Analysis service, route & full server wiring

**Files:**
- Create: `apps/server/src/services/analysisService.ts`, `apps/server/src/routes/analysis.ts`, `apps/server/test/analysis.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/server.ts`

- [ ] **Step 1: Write the failing test** — `apps/server/test/analysis.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';

const fakeResult = {
  coin: 'BTC', interval: '1h', candles: [], rsi: [], movingAverages: [],
  volume: { bars: [], sma: [] },
  volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } },
  pivots: [], meta: { lastUpdated: 0, candleCount: 0 },
};

describe('POST /api/analysis', () => {
  it('returns analysis for a valid request', async () => {
    const analysisService = { analyze: async () => fakeResult } as any;
    const app = buildApp({ analysisService });
    const res = await app.inject({ method: 'POST', url: '/api/analysis', payload: { coin: 'BTC', interval: '1h' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().coin).toBe('BTC');
  });

  it('rejects an unknown interval with 400', async () => {
    const analysisService = { analyze: async () => fakeResult } as any;
    const app = buildApp({ analysisService });
    const res = await app.inject({ method: 'POST', url: '/api/analysis', payload: { coin: 'BTC', interval: 'nope' } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/server test`
Expected: FAIL — analysis route/service missing.

- [ ] **Step 3: Write `apps/server/src/services/analysisService.ts`**

```ts
import { sma, ema, rsi, volume, volumeProfile, pivots } from '@cta/core';
import type { AnalysisResult, MovingAverageResult } from '@cta/core';
import type { CandleService } from './candleService';
import { DEFAULTS } from '../config';

export interface AnalysisRequest {
  coin: string;
  interval: string;
  lookback: number;
  rsi: { period: number };
  movingAverages: { type: 'SMA' | 'EMA'; period: number }[];
  volumeProfile: { rows: number };
  pivots: { lookback: number; maxLevels: number };
}

export type AnalysisResponse = AnalysisResult & {
  meta: { lastUpdated: number; candleCount: number };
};

export class AnalysisService {
  constructor(private candleService: CandleService) {}

  async analyze(req: AnalysisRequest): Promise<AnalysisResponse> {
    const candles = await this.candleService.getCandles(req.coin, req.interval, req.lookback);
    const movingAverages: MovingAverageResult[] = req.movingAverages.map((ma) => ({
      type: ma.type,
      period: ma.period,
      points: ma.type === 'SMA' ? sma(candles, ma.period) : ema(candles, ma.period),
    }));
    return {
      coin: req.coin,
      interval: req.interval,
      candles,
      rsi: rsi(candles, req.rsi.period),
      movingAverages,
      volume: volume(candles, DEFAULTS.volumeSmaPeriod),
      volumeProfile: volumeProfile(candles, req.volumeProfile.rows),
      pivots: pivots(candles, {
        lookback: req.pivots.lookback,
        maxLevels: req.pivots.maxLevels,
        mergeTolerance: DEFAULTS.pivotMergeTolerance,
      }),
      meta: {
        lastUpdated: candles.length ? candles[candles.length - 1].t : 0,
        candleCount: candles.length,
      },
    };
  }
}
```

- [ ] **Step 4: Write `apps/server/src/routes/analysis.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AnalysisService, AnalysisRequest } from '../services/analysisService';
import { SUPPORTED_INTERVALS, DEFAULTS, DEFAULT_LOOKBACK } from '../config';

const bodySchema = {
  type: 'object',
  required: ['coin', 'interval'],
  additionalProperties: false,
  properties: {
    coin: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: SUPPORTED_INTERVALS as unknown as string[] },
    lookback: { type: 'integer', minimum: 1, maximum: 20000, default: DEFAULT_LOOKBACK },
    rsi: {
      type: 'object', default: {},
      properties: { period: { type: 'integer', minimum: 1, default: DEFAULTS.rsiPeriod } },
    },
    movingAverages: {
      type: 'array', default: [],
      items: {
        type: 'object', required: ['type', 'period'],
        properties: { type: { type: 'string', enum: ['SMA', 'EMA'] }, period: { type: 'integer', minimum: 1 } },
      },
    },
    volumeProfile: {
      type: 'object', default: {},
      properties: { rows: { type: 'integer', minimum: 1, maximum: 200, default: DEFAULTS.volumeProfileRows } },
    },
    pivots: {
      type: 'object', default: {},
      properties: {
        lookback: { type: 'integer', minimum: 1, default: DEFAULTS.pivotLookback },
        maxLevels: { type: 'integer', minimum: 1, default: DEFAULTS.pivotMaxLevels },
      },
    },
  },
} as const;

export function registerAnalysisRoute(app: FastifyInstance, svc: AnalysisService): void {
  app.post('/api/analysis', { schema: { body: bodySchema } }, async (req) => svc.analyze(req.body as AnalysisRequest));
}
```

- [ ] **Step 5: Update `apps/server/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './routes/health';
import { registerMarketsRoute } from './routes/markets';
import { registerAnalysisRoute } from './routes/analysis';
import type { MarketsService } from './services/marketsService';
import type { AnalysisService } from './services/analysisService';

export interface AppDeps {
  marketsService: MarketsService;
  analysisService: AnalysisService;
}

export function buildApp(deps: Partial<AppDeps> = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoute(app);
  if (deps.marketsService) registerMarketsRoute(app, deps.marketsService);
  if (deps.analysisService) registerAnalysisRoute(app, deps.analysisService);
  return app;
}
```

- [ ] **Step 6: Update `apps/server/src/server.ts` to wire real dependencies**

```ts
import { buildApp } from './app';
import { openDb } from './cache/db';
import { CandleStore } from './cache/candleStore';
import { MarketStore } from './cache/marketStore';
import { HyperliquidClient } from './hyperliquid/client';
import { RateLimiter } from './hyperliquid/rateLimiter';
import { CandleService } from './services/candleService';
import { MarketsService } from './services/marketsService';
import { AnalysisService } from './services/analysisService';
import { CACHE_DB_PATH, HYPERLIQUID_BASE_URL, RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC } from './config';

const db = openDb(CACHE_DB_PATH);
const client = new HyperliquidClient({ baseUrl: HYPERLIQUID_BASE_URL });
const rateLimiter = new RateLimiter(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC);
const candleService = new CandleService({ client, store: new CandleStore(db), rateLimiter });
const marketsService = new MarketsService({ client, store: new MarketStore(db), rateLimiter });
const analysisService = new AnalysisService(candleService);

const app = buildApp({ marketsService, analysisService });
const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`server listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @cta/server test`
Expected: PASS (all server tests green).

- [ ] **Step 8: Manual smoke test (optional but recommended)**

Run: `pnpm --filter @cta/server start` then in another shell `curl -s localhost:3001/api/markets | head -c 200`
Expected: a JSON object with a `markets` array of real perps (hits the live Hyperliquid API once, then caches).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/services/analysisService.ts apps/server/src/routes/analysis.ts apps/server/src/app.ts apps/server/src/server.ts apps/server/test/analysis.test.ts
git commit -m "feat(server): add analysis service, route and full wiring"
```

---

## Task 18: `apps/web` scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/postcss.config.js`, `apps/web/tailwind.config.js`, `apps/web/test/setup.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/intervals.ts`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@cta/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 5173",
    "test": "vitest run"
  },
  "dependencies": {
    "@cta/core": "workspace:*",
    "lightweight-charts": "^4.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.3.3",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/vite.config.ts`** (dev proxy to the API avoids CORS)

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create config + entry files**

`apps/web/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hyperliquid Analysis</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { margin: 0; background: #020617; color: #e2e8f0; }
```

`apps/web/src/intervals.ts`:
```ts
export const SUPPORTED_INTERVALS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
] as const;
```

`apps/web/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`apps/web/src/App.tsx` (temporary shell, replaced in Task 23):
```tsx
export function App() {
  return <div className="p-4 text-slate-200">Hyperliquid Analysis — scaffolding…</div>;
}
```

`apps/web/test/setup.ts`:
```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Install and verify the build**

Run: `pnpm install && pnpm --filter @cta/web build`
Expected: Vite build succeeds, emits `apps/web/dist/`.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React + Tailwind app"
```

---

## Task 19: API client, types & analysis hook

**Files:**
- Create: `apps/web/src/api/types.ts`, `apps/web/src/api/client.ts`, `apps/web/src/state/useAnalysis.ts`, `apps/web/test/useAnalysis.test.ts`

- [ ] **Step 1: Create `apps/web/src/api/types.ts`**

```ts
import type { AnalysisResult } from '@cta/core';

export type {
  Candle, IndicatorPoint, MovingAverageResult, VolumeResult, VolumeProfileResult, PivotLevel, MaType,
} from '@cta/core';

export interface Market { name: string; szDecimals: number; maxLeverage: number; }
export interface MarketsResponse { markets: Market[]; updatedAt: number; }

export interface MaConfig { type: 'SMA' | 'EMA'; period: number; color: string; }

export interface AnalysisConfig {
  coin: string;
  interval: string;
  lookback: number;
  rsiPeriod: number;
  movingAverages: MaConfig[];
  volumeProfileRows: number;
  pivotLookback: number;
  pivotMaxLevels: number;
}

export type AnalysisResponse = AnalysisResult & { meta: { lastUpdated: number; candleCount: number } };
```

- [ ] **Step 2: Create `apps/web/src/api/client.ts`**

```ts
import type { AnalysisConfig, AnalysisResponse, MarketsResponse } from './types';

export async function getMarkets(): Promise<MarketsResponse> {
  const res = await fetch('/api/markets');
  if (!res.ok) throw new Error(`markets failed: ${res.status}`);
  return res.json();
}

export async function postAnalysis(cfg: AnalysisConfig): Promise<AnalysisResponse> {
  const res = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin: cfg.coin,
      interval: cfg.interval,
      lookback: cfg.lookback,
      rsi: { period: cfg.rsiPeriod },
      movingAverages: cfg.movingAverages.map((m) => ({ type: m.type, period: m.period })),
      volumeProfile: { rows: cfg.volumeProfileRows },
      pivots: { lookback: cfg.pivotLookback, maxLevels: cfg.pivotMaxLevels },
    }),
  });
  if (!res.ok) throw new Error(`analysis failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Write the failing test** — `apps/web/test/useAnalysis.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalysis } from '../src/state/useAnalysis';
import * as client from '../src/api/client';
import type { AnalysisConfig } from '../src/api/types';

const cfg: AnalysisConfig = {
  coin: 'BTC', interval: '1h', lookback: 100, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

describe('useAnalysis', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads analysis and exposes data', async () => {
    const spy = vi.spyOn(client, 'postAnalysis').mockResolvedValue({ coin: 'BTC' } as never);
    const { result } = renderHook(() => useAnalysis(cfg, 0));
    await waitFor(() => expect(result.current.data).toEqual({ coin: 'BTC' }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors', async () => {
    vi.spyOn(client, 'postAnalysis').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAnalysis(cfg, 0));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @cta/web test`
Expected: FAIL — cannot find module `../src/state/useAnalysis`.

- [ ] **Step 5: Create `apps/web/src/state/useAnalysis.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { postAnalysis } from '../api/client';
import type { AnalysisConfig, AnalysisResponse } from '../api/types';

export interface UseAnalysis {
  data: AnalysisResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAnalysis(config: AnalysisConfig, debounceMs = 300): UseAnalysis {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const key = JSON.stringify(config);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    let cancelled = false;
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await postAnalysis(config);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { data, loading, error, reload };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @cta/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api apps/web/src/state apps/web/test/useAnalysis.test.ts
git commit -m "feat(web): add API client, types and analysis hook"
```

---

## Task 20: Toolbar (market picker + timeframe pills)

**Files:**
- Create: `apps/web/src/components/TimeframePills.tsx`, `apps/web/src/components/MarketPicker.tsx`, `apps/web/src/components/Toolbar.tsx`, `apps/web/test/toolbar.test.tsx`

- [ ] **Step 1: Write the failing test** — `apps/web/test/toolbar.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeframePills } from '../src/components/TimeframePills';
import { MarketPicker } from '../src/components/MarketPicker';

describe('TimeframePills', () => {
  it('emits the clicked interval', () => {
    const onChange = vi.fn();
    render(<TimeframePills value="1h" onChange={onChange} />);
    fireEvent.click(screen.getByText('4h'));
    expect(onChange).toHaveBeenCalledWith('4h');
  });
});

describe('MarketPicker', () => {
  it('filters and selects a market', () => {
    const onChange = vi.fn();
    render(
      <MarketPicker
        markets={[{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }, { name: 'ETH', szDecimals: 4, maxLeverage: 50 }]}
        value="BTC"
        onChange={onChange}
      />,
    );
    fireEvent.focus(screen.getByPlaceholderText('Search market…'));
    fireEvent.change(screen.getByPlaceholderText('Search market…'), { target: { value: 'eth' } });
    fireEvent.mouseDown(screen.getByText('ETH'));
    expect(onChange).toHaveBeenCalledWith('ETH');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test`
Expected: FAIL — components missing.

- [ ] **Step 3: Create `apps/web/src/components/TimeframePills.tsx`**

```tsx
import { SUPPORTED_INTERVALS } from '../intervals';

export function TimeframePills({ value, onChange }: { value: string; onChange: (i: string) => void }) {
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

- [ ] **Step 4: Create `apps/web/src/components/MarketPicker.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Market } from '../api/types';

export function MarketPicker({
  markets, value, onChange,
}: { markets: Market[]; value: string; onChange: (c: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => markets.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50),
    [markets, query],
  );
  return (
    <div className="relative">
      <input
        className="w-40 rounded bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none"
        placeholder="Search market…"
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-40 overflow-auto rounded bg-slate-900 shadow-lg">
          {filtered.map((m) => (
            <li key={m.name}>
              <button
                className="block w-full px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-700"
                onMouseDown={() => { onChange(m.name); setOpen(false); }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/components/Toolbar.tsx`**

```tsx
import type { Market } from '../api/types';
import { MarketPicker } from './MarketPicker';
import { TimeframePills } from './TimeframePills';

export function Toolbar(props: {
  markets: Market[];
  coin: string;
  interval: string;
  onCoin: (c: string) => void;
  onInterval: (i: string) => void;
  onRefresh: () => void;
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <MarketPicker markets={props.markets} value={props.coin} onChange={props.onCoin} />
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

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @cta/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/TimeframePills.tsx apps/web/src/components/MarketPicker.tsx apps/web/src/components/Toolbar.tsx apps/web/test/toolbar.test.tsx
git commit -m "feat(web): add toolbar with market picker and timeframe pills"
```

---

## Task 21: Indicator drawer

**Files:**
- Create: `apps/web/src/components/IndicatorDrawer.tsx`, `apps/web/test/indicatorDrawer.test.tsx`

- [ ] **Step 1: Write the failing test** — `apps/web/test/indicatorDrawer.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IndicatorDrawer } from '../src/components/IndicatorDrawer';
import type { AnalysisConfig } from '../src/api/types';

const base: AnalysisConfig = {
  coin: 'BTC', interval: '1h', lookback: 1000, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

describe('IndicatorDrawer', () => {
  it('adds a moving average', () => {
    const onChange = vi.fn();
    render(<IndicatorDrawer config={base} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ add'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ movingAverages: [expect.objectContaining({ type: 'EMA', period: 50 })] }),
    );
  });

  it('edits the RSI period', () => {
    const onChange = vi.fn();
    render(<IndicatorDrawer config={base} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('14'), { target: { value: '21' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rsiPeriod: 21 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cta/web test`
Expected: FAIL — `IndicatorDrawer` missing.

- [ ] **Step 3: Create `apps/web/src/components/IndicatorDrawer.tsx`**

```tsx
import type { AnalysisConfig, MaConfig } from '../api/types';

const MA_COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6'];

export function IndicatorDrawer({
  config, onChange,
}: { config: AnalysisConfig; onChange: (c: AnalysisConfig) => void }) {
  const update = (patch: Partial<AnalysisConfig>) => onChange({ ...config, ...patch });
  const setMa = (idx: number, patch: Partial<MaConfig>) =>
    update({ movingAverages: config.movingAverages.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const addMa = () =>
    update({
      movingAverages: [
        ...config.movingAverages,
        { type: 'EMA', period: 50, color: MA_COLORS[config.movingAverages.length % MA_COLORS.length] },
      ],
    });
  const removeMa = (idx: number) =>
    update({ movingAverages: config.movingAverages.filter((_, i) => i !== idx) });

  const numberField = (label: string, value: number, onValue: (n: number) => void, min = 1, max?: number) => (
    <label className="flex items-center justify-between">
      {label}
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => onValue(Number(e.target.value))}
        className="w-16 rounded bg-slate-800 px-1 py-0.5 text-right"
      />
    </label>
  );

  return (
    <aside className="w-64 shrink-0 space-y-4 overflow-auto border-l border-slate-800 bg-slate-900 p-3 text-sm">
      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">RSI</h3>
        {numberField('Period', config.rsiPeriod, (n) => update({ rsiPeriod: n }))}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Moving averages</h3>
          <button onClick={addMa} className="text-xs text-blue-400">+ add</button>
        </div>
        <div className="space-y-2">
          {config.movingAverages.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded" style={{ background: m.color }} />
              <select
                value={m.type} onChange={(e) => setMa(i, { type: e.target.value as MaConfig['type'] })}
                className="rounded bg-slate-800 px-1 py-0.5"
              >
                <option>SMA</option>
                <option>EMA</option>
              </select>
              <input
                type="number" min={1} value={m.period}
                onChange={(e) => setMa(i, { period: Number(e.target.value) })}
                className="w-14 rounded bg-slate-800 px-1 py-0.5 text-right"
              />
              <button onClick={() => removeMa(i)} className="ml-auto text-xs text-slate-500 hover:text-red-400">✕</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Volume profile</h3>
        {numberField('Rows', config.volumeProfileRows, (n) => update({ volumeProfileRows: n }), 1, 200)}
      </section>

      <section>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">S/R pivots</h3>
        {numberField('Lookback', config.pivotLookback, (n) => update({ pivotLookback: n }))}
        {numberField('Max levels', config.pivotMaxLevels, (n) => update({ pivotMaxLevels: n }))}
      </section>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cta/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/IndicatorDrawer.tsx apps/web/test/indicatorDrawer.test.tsx
git commit -m "feat(web): add indicator config drawer"
```

---

## Task 22: Chart + volume-profile overlay

> lightweight-charts **v4** API (`addCandlestickSeries`, `addLineSeries`, `addHistogramSeries`, `createPriceLine`). This is a visual component — verified manually, not via unit tests.

**Files:**
- Create: `apps/web/src/components/VolumeProfileOverlay.tsx`, `apps/web/src/components/Chart.tsx`

- [ ] **Step 1: Create `apps/web/src/components/VolumeProfileOverlay.tsx`**

```tsx
import type { VolumeProfileResult } from '../api/types';

export function VolumeProfileOverlay({
  profile, priceToY, width, maxBarWidth = 130,
}: {
  profile: VolumeProfileResult;
  priceToY: (price: number) => number | null;
  width: number;
  maxBarWidth?: number;
}) {
  if (!profile.rows.length || width === 0) return null;
  const maxVol = Math.max(...profile.rows.map((r) => r.volume)) || 1;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {profile.rows.map((row, i) => {
        const yTop = priceToY(row.priceHigh);
        const yBot = priceToY(row.priceLow);
        if (yTop == null || yBot == null) return null;
        const h = Math.max(1, yBot - yTop - 1);
        const w = (row.volume / maxVol) * maxBarWidth;
        const inVA = row.priceLow >= profile.valueArea.low && row.priceHigh <= profile.valueArea.high;
        const isPoc = profile.poc >= row.priceLow && profile.poc < row.priceHigh;
        return (
          <rect
            key={i}
            x={width - w}
            y={yTop}
            width={w}
            height={h}
            fill={isPoc ? '#3b82f6' : inVA ? 'rgba(59,130,246,0.45)' : 'rgba(100,116,139,0.35)'}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/Chart.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine,
} from 'lightweight-charts';
import type { AnalysisResponse } from '../api/types';
import { VolumeProfileOverlay } from './VolumeProfileOverlay';

const toSec = (ms: number) => Math.floor(ms / 1000) as never;

export function Chart({ data, maColors }: { data: AnalysisResponse | null; maColors: string[] }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const priceChart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const volSma = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiLine = useRef<ISeriesApi<'Line'> | null>(null);
  const maRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const pivotLines = useRef<IPriceLine[]>([]);
  const [tick, setTick] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current) return;
    const common = {
      layout: { background: { type: ColorType.Solid, color: '#0b1220' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#16223a' }, horzLines: { color: '#16223a' } },
      timeScale: { timeVisible: true, borderColor: '#1e293b' },
      rightPriceScale: { borderColor: '#1e293b' },
    };
    const pc = createChart(priceRef.current, { ...common, height: 440 });
    const rc = createChart(rsiRef.current, { ...common, height: 130 });
    priceChart.current = pc;
    candle.current = pc.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false,
    });
    vol.current = pc.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
    volSma.current = pc.addLineSeries({ priceScaleId: 'vol', color: '#eab308', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    rsiLine.current = rc.addLineSeries({ color: '#a78bfa', lineWidth: 1 });
    rsiLine.current.createPriceLine({ price: 70, color: '#475569', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '70' });
    rsiLine.current.createPriceLine({ price: 30, color: '#475569', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '30' });

    const sync = (a: IChartApi, b: IChartApi) =>
      a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) b.timeScale().setVisibleLogicalRange(r); });
    sync(pc, rc);
    sync(rc, pc);
    pc.timeScale().subscribeVisibleLogicalRangeChange(() => setTick((t) => t + 1));

    const ro = new ResizeObserver(() => {
      const w = priceRef.current?.clientWidth ?? 0;
      pc.applyOptions({ width: w });
      rc.applyOptions({ width: rsiRef.current?.clientWidth ?? 0 });
      setWidth(w);
      setTick((t) => t + 1);
    });
    ro.observe(priceRef.current);
    return () => { ro.disconnect(); pc.remove(); rc.remove(); };
  }, []);

  useEffect(() => {
    const pc = priceChart.current;
    if (!data || !pc || !candle.current || !vol.current || !volSma.current || !rsiLine.current) return;
    candle.current.setData(data.candles.map((c) => ({ time: toSec(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
    vol.current.setData(data.volume.bars.map((b) => ({ time: toSec(b.t), value: b.value, color: b.up ? '#14532d' : '#7f1d1d' })));
    volSma.current.setData(data.volume.sma.map((p) => ({ time: toSec(p.t), value: p.value })));
    rsiLine.current.setData(data.rsi.map((p) => ({ time: toSec(p.t), value: p.value })));

    for (const s of maRefs.current) pc.removeSeries(s);
    maRefs.current = data.movingAverages.map((ma, i) => {
      const s = pc.addLineSeries({ color: maColors[i] ?? '#22d3ee', lineWidth: 1 });
      s.setData(ma.points.map((p) => ({ time: toSec(p.t), value: p.value })));
      return s;
    });

    for (const pl of pivotLines.current) candle.current.removePriceLine(pl);
    pivotLines.current = data.pivots.map((p) =>
      candle.current!.createPriceLine({
        price: p.price,
        color: p.type === 'resistance' ? '#f59e0b' : '#3b82f6',
        lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true,
        title: p.type === 'resistance' ? 'R' : 'S',
      }),
    );
    pc.timeScale().fitContent();
    setTick((t) => t + 1);
  }, [data, maColors]);

  const priceToY = (price: number): number | null => candle.current?.priceToCoordinate(price) ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="relative" data-tick={tick}>
        <div ref={priceRef} className="w-full" />
        {data && <VolumeProfileOverlay profile={data.volumeProfile} priceToY={priceToY} width={width} />}
      </div>
      <div ref={rsiRef} className="w-full border-t border-slate-800" />
    </div>
  );
}
```

- [ ] **Step 3: Manual verification (deferred to Task 23's end-to-end check)**

The Chart can't render meaningfully until it's wired into `App` with live data. It is verified as part of Task 23, Step 4. For now just confirm it type-checks:

Run: `pnpm --filter @cta/web build`
Expected: build succeeds (App still the shell; Chart compiles).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Chart.tsx apps/web/src/components/VolumeProfileOverlay.tsx
git commit -m "feat(web): add candlestick chart with MA/volume/RSI/pivots + volume-profile overlay"
```

---

## Task 23: Wire the app together (Layout A) + end-to-end check

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Replace `apps/web/src/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { getMarkets } from './api/client';
import type { AnalysisConfig, Market } from './api/types';
import { useAnalysis } from './state/useAnalysis';
import { Toolbar } from './components/Toolbar';
import { IndicatorDrawer } from './components/IndicatorDrawer';
import { Chart } from './components/Chart';

const DEFAULT_CONFIG: AnalysisConfig = {
  coin: 'BTC',
  interval: '1h',
  lookback: 1000,
  rsiPeriod: 14,
  movingAverages: [
    { type: 'EMA', period: 50, color: '#22d3ee' },
    { type: 'SMA', period: 200, color: '#f59e0b' },
  ],
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMaxLevels: 6,
};

export function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const { data, loading, error, reload } = useAnalysis(config);

  useEffect(() => {
    getMarkets().then((r) => setMarkets(r.markets)).catch(() => undefined);
  }, []);

  const status = useMemo(() => {
    if (error) return `error: ${error}`;
    if (loading) return 'loading…';
    if (data) return `${data.meta.candleCount} candles · updated ${new Date(data.meta.lastUpdated).toLocaleString()}`;
    return '';
  }, [error, loading, data]);

  const maColors = config.movingAverages.map((m) => m.color);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        markets={markets}
        coin={config.coin}
        interval={config.interval}
        onCoin={(coin) => setConfig({ ...config, coin })}
        onInterval={(interval) => setConfig({ ...config, interval })}
        onRefresh={reload}
        status={status}
      />
      <div className="flex min-h-0 flex-1">
        <Chart data={data} maColors={maColors} />
        <IndicatorDrawer config={config} onChange={setConfig} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests**

Run: `pnpm -r test`
Expected: PASS across `@cta/core`, `@cta/server`, `@cta/web`.

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @cta/web build`
Expected: build succeeds.

- [ ] **Step 4: End-to-end manual verification**

In one terminal: `pnpm --filter @cta/server start`
In another: `pnpm --filter @cta/web dev`
Open `http://localhost:5173`. Confirm:
- The market picker lists real perps; selecting one (e.g. BTC) loads candles.
- Candlesticks render with EMA 50 + SMA 200 overlays.
- The volume pane shows at the bottom; the RSI pane below shows the line with 70/30 guides.
- Orange (R) / blue (S) horizontal pivot lines appear.
- The volume-profile bars render on the right with a highlighted POC and shaded value area; they track the price scale when you pan/zoom.
- Changing the timeframe and editing indicators in the drawer updates the chart.

(Use the `run` skill / browser-driven verification if available.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): wire toolbar, chart and drawer into Layout A"
```

---

## Task 24: README + env example

**Files:**
- Create: `README.md`, `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
# Hyperliquid API base (override for testnet: https://api.hyperliquid-testnet.xyz)
HL_BASE_URL=https://api.hyperliquid.xyz
# Server port
PORT=3001
# SQLite candle cache location (relative to apps/server)
CACHE_DB_PATH=data/cache.sqlite
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: add README and env example"
```

---

## Spec Coverage

| Spec section | Task(s) |
|---|---|
| Monorepo / stack (§3, §4) | 1, 2, 10, 18 |
| Hyperliquid client + pagination (§5.1) | 12, 13 |
| SQLite cache, incremental fetch (§5.2) | 14, 15 |
| Rate limiter (§5.3) | 11, 15 |
| Client retry w/ exponential backoff (§5.3) | 12 |
| RSI / SMA / EMA / volume (§6) | 3, 4, 5, 6 |
| Volume profile (§6) | 7 |
| Volume-weighted pivots (§6) | 8 |
| `GET /api/markets` (§7) | 16 |
| `POST /api/analysis` + validation (§7) | 17 |
| `GET /api/health` (§7) | 10 |
| UI Layout A: toolbar / picker / pills (§8) | 20 |
| UI: indicator drawer (§8) | 21 |
| UI: chart (candles/MA/volume/RSI/pivots/profile) (§8) | 22, 23 |
| Testing strategy (§9) | every task (TDD) + 23 (e2e) |
| Defaults (§10) | 10 (config), 17 (schema), 23 (App) |

**Deferred (out of Phase 1 scope, per spec §2):** serving stale cache on hard failure (with a `stale`/`fromCache` flag) is deferred — Phase 1 surfaces an error if a fetch ultimately fails after retries. WebSocket, spot, synthetic crosses, patterns, backtesting, signals — all Phase 2/3.


