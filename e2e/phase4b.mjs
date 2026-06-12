// e2e/phase4b.mjs — Phase 4B live dashboard + MA optimizer e2e against real Hyperliquid.
// Owns the server lifecycle like phase4a.mjs (detached group spawn on :3016) and drives the
// SERVED dashboard (apps/web/dist via @fastify/static) with system Chrome like phase3.mjs.
// Run from the repo root: node e2e/phase4b.mjs
//
// PORT 3016, BASE http://localhost:3016
// DB   apps/server/data/e2e-phase4b.sqlite
// CFG  apps/server/data/e2e-phase4b-engine.json
//
// Spec gates (the script fails unless all hold):
//   1. dashboard scan rows update live without clicks (a [data-live="1"] row appears, then the
//      live-row set grows or refreshes — new count or a changed data-ts — with zero interaction)
//   2. health chip is green ([data-testid="health-chip"][data-state="green"])
//   3. a deep-link URL (?coin=&interval=) opens the right coin+timeframe
//   4. a forced optimizer run writes auditable ma_selection rows (JSON metrics parse,
//      train.trades >= 1, fastPeriod < slowPeriod, selectedAt > 0)
// Alert-feed click-through is best-effort (alerts are market-dependent): if an alert row exists
// it is clicked and the chart must switch to the alert's coin+interval; otherwise WARN and continue.
// NOTE on plan lines: phase3.mjs asserts window.__planLineCount === 3, but Chart.tsx only sets
// that hook under import.meta.env.DEV — it is compiled out of the production build this e2e
// serves, and the lines themselves are lightweight-charts canvas price-lines with no DOM
// footprint. The click-through gate therefore asserts the observable onOpenAlert effects:
// view switched to Chart, picker shows the alert's coin, the alert's interval pill is active.
import { spawn, execFileSync, execSync } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'apps/server/data'); // gitignored as a whole (see .gitignore)
const PORT = 3016;
const BASE = `http://localhost:${PORT}`;
const DB = resolve(DATA, 'e2e-phase4b.sqlite');
const CFG = resolve(DATA, 'e2e-phase4b-engine.json');
const LOG_DIR = resolve(DATA, 'logs-e2e-4b');
const OUT = resolve(ROOT, 'e2e/out');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let server = null;
let browser = null;
let spawnedAny = false; // never sweep-kill :3016 unless this script started the server

// Listening pids only: a bare `lsof -ti :PORT` also lists this script's own keep-alive
// fetch sockets, which would make the port look occupied forever.
const listeningPids = () => {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'])
      .toString().trim().split('\n').filter(Boolean);
  } catch {
    return []; // lsof exits non-zero when nothing matches
  }
};
const killTree = (child) => {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }
  if (spawnedAny) {
    for (const pid of listeningPids()) { try { process.kill(Number(pid), 'SIGTERM'); } catch { /* gone */ } }
  }
};
const cleanup = () => {
  try { browser?.process()?.kill('SIGKILL'); } catch { /* already gone */ }
  browser = null;
  killTree(server);
  server = null;
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
const fail = (msg) => { console.error(`FAIL: ${msg}`); cleanup(); process.exit(1); };

// 0) preflight: port free, fresh artifacts, permissive engine config
if (listeningPids().length) fail(`something is already listening on :${PORT} — refusing to start`);

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(OUT, { recursive: true });
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true }); // WAL/shm survive a SIGTERM'd server; stale ones poison a fresh db
rmSync(`${DB}-shm`, { force: true });
// permissive thresholds so live data fills the dashboard within minutes;
// loadEngineConfig deep-merges, so the partial analysis/optimizer blocks keep default siblings.
// sinks pinned false: a json `false` overrides env secrets, so no real notifications can fire.
writeFileSync(CFG, JSON.stringify({
  universeCap: 6,
  timeframes: ['15m', '1h'],
  confirmedMinConfidence: 0,        // every active close-scan plan alerts → feed content
  provisionalMinConfidence: 80,
  sinks: { telegram: false, discord: false, macos: false },
  webOrigin: BASE,
  optimizer: { enabled: true, minTrainTrades: 1, minValidationTrades: 1, validationFraction: 0.3 },
  analysis: { gate: { minTrades: 1, minExpectancy: -9, topN: 50 }, window: 50 },
}));

const env = {
  ...process.env,
  PORT: String(PORT),
  CACHE_DB_PATH: DB, // apps/server/src/config.ts: process.env.CACHE_DB_PATH ?? 'data/cache.sqlite'
  ENGINE_ENABLED: '1',
  ENGINE_CONFIG: CFG,
  ENGINE_LOG_DIR: LOG_DIR,
  // push sinks disabled via CFG above; alerts still persist to SQLite and stream over SSE
};
const serverLog = createWriteStream(resolve(LOG_DIR, 'server-stdio.log'), { flags: 'a' });
const startServer = () => {
  spawnedAny = true;
  const child = spawn('pnpm', ['--filter', '@cta/server', 'start'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  // drain stdio (an unread 'pipe' blocks the child once the 64KB buffer fills) into a log
  child.stdout.pipe(serverLog, { end: false });
  child.stderr.pipe(serverLog, { end: false });
  return child;
};

const health = async () => {
  try { return await (await fetch(`${BASE}/api/health`)).json(); } catch { return null; }
};
const until = async (label, cond, timeoutMs, stepMs = 2_000) => {
  const t0 = Date.now();
  for (;;) {
    const h = await health();
    if (h && cond(h)) return h;
    if (Date.now() - t0 > timeoutMs) fail(`${label} (after ${Math.round((Date.now() - t0) / 1000)}s): ${JSON.stringify(h)}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
};
const untilPortFree = async (timeoutMs = 15_000) => {
  const t0 = Date.now();
  while (listeningPids().length) {
    if (Date.now() - t0 > timeoutMs) fail(`:${PORT} still occupied ${timeoutMs}ms after SIGTERM`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

/** One-shot SSE client: connects to GET /live, returns the first snapshot frame's parsed JSON. */
const fetchSnapshot = async (timeoutMs = 10_000) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/live`, { signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`GET /live → ${res.status}`);
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8');
      const m = buf.match(/^event: snapshot\ndata: (.*)\n\n/m); // sseFrame() emits single-line JSON
      if (m) return JSON.parse(m[1]);
    }
    throw new Error('SSE stream ended before a snapshot frame');
  } finally {
    clearTimeout(timer);
    ac.abort(); // release the held SSE connection
  }
};

// 1) serve a fresh dist (app.ts checks for index.html at boot — build BEFORE spawning)
console.log('building apps/web/dist…');
execSync('pnpm --filter @cta/web build', { cwd: ROOT, stdio: 'inherit' });

// 2) boot the server with the engine; 3) wait for live coins
server = startServer();
let h = await until('engine never reported live coins', (x) => x.engine && x.engine.coinsLive >= 3, 240_000);
console.log(`PASS: ${h.engine.coinsLive} coins live, wsConnected=${h.engine.wsConnected}`);

// 4) SSE handshake: first frame on a fresh connection is a full snapshot
const snap = await fetchSnapshot().catch((err) => fail(`SSE handshake failed: ${err.message}`));
if (!Array.isArray(snap.scans) || !Array.isArray(snap.alerts) || typeof snap.health !== 'object' || snap.health === null) {
  fail(`snapshot missing scans[]/alerts[]/health{}: ${JSON.stringify(Object.keys(snap))}`);
}
console.log(`PASS: SSE snapshot — ${snap.scans.length} scan row(s), ${snap.alerts.length} alert(s), health.coinsLive=${snap.health.coinsLive}`);

// 5) the served dashboard: green chip, then live rows that update with zero interaction
browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 950 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => fail(`cannot reach ${BASE}`));

const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) fail(`button "${text}" not found`);
};

await page.waitForSelector('[data-testid="health-chip"][data-state="green"]', { timeout: 90_000 })
  .catch(() => fail('health chip never turned green'));
console.log('PASS: health chip green');

await clickByText('Signals');
// Watch on the 15m interval: the scanner filters rows to the selected interval (default 1h),
// and 1h rows only re-emit on hourly closes / boot scans — a 300s watch starves once backfill
// completes (observed in the 2026-06-11 run). 15m rows refresh on every 15m close, and a 960s
// window always straddles at least one 900s-spaced close.
await clickByText('15m');
await page.waitForSelector('[data-testid="scan-row"][data-live="1"]', { timeout: 300_000 })
  .catch(() => fail('no live scan row appeared'));
const liveState = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="scan-row"][data-live="1"]')];
  return {
    count: rows.length,
    keys: rows.map((r) => `${r.querySelectorAll('td')[1]?.textContent?.trim()}|${r.getAttribute('data-ts')}`),
  };
});
console.log(`live rows: ${liveState.count} — waiting for growth or a data-ts refresh (no interaction)…`);
await page.waitForFunction((prevCount, prevKeys) => {
  const rows = [...document.querySelectorAll('[data-testid="scan-row"][data-live="1"]')];
  const keys = rows.map((r) => `${r.querySelectorAll('td')[1]?.textContent?.trim()}|${r.getAttribute('data-ts')}`);
  return rows.length > prevCount || keys.some((k) => !prevKeys.includes(k));
}, { timeout: 960_000, polling: 1_000 }, liveState.count, liveState.keys)
  .catch(() => fail('live rows never grew or refreshed without interaction'));
const liveAfter = await page.$$eval('[data-testid="scan-row"][data-live="1"]', (rows) => rows.length);
console.log(`PASS: live rows updated hands-off (${liveState.count} → ${liveAfter})`);
await page.screenshot({ path: resolve(OUT, 'phase4b-dashboard.png') });

// 6) deep link: ?coin=&interval= must select that coin and timeframe
const coin = await page.$eval(
  '[data-testid="scan-row"][data-live="1"] td:nth-child(2)',
  (el) => el.textContent.trim(),
);
await page.goto(`${BASE}/?coin=${encodeURIComponent(coin)}&interval=1h`, { waitUntil: 'networkidle2', timeout: 60_000 })
  .catch(() => fail('deep-link navigation failed'));
const pickerValue = await page.$eval('input[placeholder="Search market…"]', (el) => el.value)
  .catch(() => fail('market picker input not found'));
if (pickerValue !== coin) fail(`deep link selected "${pickerValue}", expected "${coin}"`);
// TimeframePills has no aria state; the active pill is the button whose text is the interval
// and whose class includes bg-blue-600 (inactive pills are bg-slate-800).
const pillActive = await page.evaluate((interval) => {
  const pill = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === interval);
  return Boolean(pill && pill.className.includes('bg-blue-600'));
}, '1h');
if (!pillActive) fail('deep link did not activate the 1h timeframe pill');
console.log(`PASS: deep link opened ${coin} @ 1h`);
await page.screenshot({ path: resolve(OUT, 'phase4b-deeplink.png') });

// 7) best-effort alert click-through (alerts are market-dependent — WARN if none)
await clickByText('Alerts');
const alertRow = await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 }).catch(() => null);
if (alertRow) {
  // alert-row span order (AlertFeedPane): badge, timestamp, coin, interval, direction, …
  const target = await page.$eval('[data-testid="alert-row"]', (el) => {
    const spans = el.querySelectorAll('span');
    return { coin: spans[2]?.textContent?.trim(), interval: spans[3]?.textContent?.trim() };
  });
  await page.click('[data-testid="alert-row"]');
  // onOpenAlert: switches view to Chart and selects the alert's coin+interval (plan lines are
  // canvas-drawn and __planLineCount is DEV-only — see header note).
  await page.waitForFunction((coin, interval) => {
    const input = document.querySelector('input[placeholder="Search market…"]');
    const buttons = [...document.querySelectorAll('button')];
    const chartTab = buttons.find((b) => b.textContent?.trim() === 'Chart');
    const pill = buttons.find((b) => b.textContent?.trim() === interval);
    return Boolean(
      input && input.value === coin
      && chartTab && chartTab.className.includes('bg-blue-600')
      && pill && pill.className.includes('bg-blue-600'),
    );
  }, { timeout: 15_000 }, target.coin, target.interval)
    .catch(() => fail(`alert click-through did not open chart for ${target.coin} @ ${target.interval}`));
  console.log(`PASS: alert click-through → chart ${target.coin} @ ${target.interval}`);
} else {
  console.warn('WARN: no alerts in feed during run — click-through skipped');
}
await page.screenshot({ path: resolve(OUT, 'phase4b-alerts.png') });

// 8) forced optimizer run on live coins → auditable ma_selection rows
const snap2 = await fetchSnapshot().catch((err) => fail(`SSE re-snapshot failed: ${err.message}`));
const liveCoins = [...new Set(snap2.scans.map((s) => s.coin))];
if (liveCoins.length < 2) fail(`need ≥2 live coins for the optimizer gate, have ${liveCoins.length}`);
const [c1, c2] = liveCoins;
const postOptimize = async (csv) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 280_000);
  try {
    const res = await fetch(`${BASE}/engine/optimize-ma?coins=${csv}`, { method: 'POST', signal: ac.signal });
    if (res.status !== 200) fail(`POST /engine/optimize-ma?coins=${csv} → ${res.status}`);
    return await res.json();
  } catch (err) {
    fail(`optimize-ma POST failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};
const summary = await postOptimize(`${c1},${c2}`);
// 2 coins × 2 timeframes; degraded series count as 'skipped'/'failed' decisions, still 4 entries
if (!Array.isArray(summary.decisions) || summary.decisions.length !== 4) {
  fail(`expected 4 optimizer decisions for ${c1},${c2}, got: ${JSON.stringify(summary)}`);
}
console.log(`optimizer decisions: ${summary.decisions.map((d) => `${d.coin}/${d.interval}=${d.decision}`).join(' ')}`);

const { createRequire } = await import('node:module');
const Database = createRequire(resolve(ROOT, 'apps/server/package.json'))('better-sqlite3');
const readSelections = () => {
  const db = new Database(DB, { readonly: true });
  const rows = db.prepare('SELECT * FROM ma_selection').all();
  db.close();
  return rows;
};
let rows = readSelections();
if (rows.length === 0) {
  // ma_selection rows only exist for 'challenger' decisions; with permissive gates a challenger
  // is very likely but not certain for any given coin — retry once with a third live coin.
  const c3 = liveCoins.find((c) => c !== c1 && c !== c2);
  if (!c3) fail(`no challenger among ${c1},${c2} and no third live coin to retry with`);
  console.warn(`WARN: no challenger among ${c1},${c2} — retrying optimizer with ${c3}`);
  const retry = await postOptimize(c3);
  if (!Array.isArray(retry.decisions) || retry.decisions.length !== 2) {
    fail(`expected 2 optimizer decisions for ${c3}, got: ${JSON.stringify(retry)}`);
  }
  console.log(`optimizer retry decisions: ${retry.decisions.map((d) => `${d.coin}/${d.interval}=${d.decision}`).join(' ')}`);
  rows = readSelections();
  if (rows.length === 0) fail('optimizer produced no auditable ma_selection rows after retry');
}
for (const r of rows) {
  let setupKinds; let train; let validation;
  try {
    setupKinds = JSON.parse(r.setupKinds);
    train = JSON.parse(r.train);
    validation = JSON.parse(r.validation);
    if (r.baselineTrain) JSON.parse(r.baselineTrain);
    if (r.baselineValidation) JSON.parse(r.baselineValidation);
  } catch (err) {
    fail(`ma_selection ${r.coin}/${r.interval}: metrics JSON does not parse — ${err.message}`);
  }
  if (!Array.isArray(setupKinds) || setupKinds.length === 0) fail(`ma_selection ${r.coin}/${r.interval}: empty setupKinds`);
  if (!(train.trades >= 1)) fail(`ma_selection ${r.coin}/${r.interval}: train.trades=${train.trades}, expected >= 1`);
  if (!(validation.trades >= 1)) fail(`ma_selection ${r.coin}/${r.interval}: validation.trades=${validation.trades}, expected >= 1`);
  if (!(r.fastPeriod < r.slowPeriod)) fail(`ma_selection ${r.coin}/${r.interval}: fastPeriod ${r.fastPeriod} !< slowPeriod ${r.slowPeriod}`);
  if (!(r.selectedAt > 0)) fail(`ma_selection ${r.coin}/${r.interval}: selectedAt=${r.selectedAt}`);
}
console.log(`PASS: ${rows.length} auditable ma_selection row(s): ${
  rows.map((r) => `${r.coin}/${r.interval} ${r.fastType}${r.fastPeriod}<${r.slowType}${r.slowPeriod}`).join(', ')}`);

// 9) teardown
await browser.close();
browser = null;
killTree(server);
server = null;
await untilPortFree();
console.log('E2E PASS');
process.exit(0);
