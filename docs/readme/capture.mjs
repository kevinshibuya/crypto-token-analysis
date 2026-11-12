// docs/readme/capture.mjs: regenerates the README screenshots from the running app.
//
// Prereqs, from the repo root:
//   1. API with the engine on a 20-coin universe and lowered alert thresholds, so the
//      alert feed fills within minutes (sinks are pinned off; nothing is sent anywhere):
//        CACHE_DB_PATH=data/readme-capture.sqlite \
//        ENGINE_CONFIG=../../docs/readme/capture-engine.json \
//        pnpm --filter @cta/server start
//   2. Web dev server (dev build, so the chart exposes its marker count):
//        pnpm --filter @cta/web dev
//   3. Wait until `curl -s localhost:3001/api/health` shows coinsLive >= 20.
//
// Run: node docs/readme/capture.mjs
// Uses the system Chrome; set CHROME_PATH (and HEADLESS=shell for a headless-shell build) to override.
// Writes chart.webp, backtest.webp, signals.webp and alerts.webp next to this file.
import puppeteer from 'puppeteer-core';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.WEB_URL ?? 'http://localhost:5173';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// A chrome-headless-shell build needs HEADLESS=shell.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: process.env.HEADLESS ?? 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

// Crops to the lowest bottom edge of `selector` matches, so empty page below the content is cut.
const shot = async (name, selector) => {
  await new Promise((r) => setTimeout(r, 1_500)); // let canvas redraws and transitions settle
  const bottom = selector
    ? await page.$$eval(selector, (els) => Math.max(...els.map((e) => e.getBoundingClientRect().bottom)))
    : 800;
  const clip = { x: 0, y: 0, width: 1280, height: Math.min(800, Math.ceil(bottom) + 16) };
  await page.screenshot({ path: `${OUT}/${name}.webp`, type: 'webp', quality: 82, clip });
  console.log(`wrote ${name}.webp`);
};
const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) fail(`button "${text}" not found`);
};
const uncheck = async (labelText) => {
  const ok = await page.evaluate((t) => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === t);
    const box = label?.querySelector('input[type="checkbox"]');
    if (box?.checked) box.click();
    return Boolean(box);
  }, labelText);
  if (!ok) fail(`checkbox "${labelText}" not found`);
};
// Native setter + input event: headless Chrome garbles keystrokes on number inputs.
const setField = async (testid, value) => {
  await page.$eval(`[data-testid="${testid}"]`, (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};

await page.goto(`${URL}/?coin=BTC&interval=1h`, { waitUntil: 'networkidle2', timeout: 60_000 })
  .catch(() => fail(`cannot reach ${URL}`));

// 1) Chart: candles, EMA 50 / SMA 200, pivots, volume profile, RSI, signal markers.
//    Candle-pattern and volume markers are switched off: on 1000 candles they cover the price.
await page.waitForFunction(() => window.__markerCount > 0, { timeout: 60_000 })
  .catch(() => fail('chart rendered no signal markers'));
await page.waitForSelector('[data-testid="health-chip"][data-state="green"]', { timeout: 60_000 })
  .catch(() => fail('engine health chip is not green'));
await uncheck('Candle patterns');
await uncheck('Volume');
await shot('chart', 'canvas');

// 2) Backtest: full single + pair scan, ranked by expectancy.
await clickByText('Backtest');
await clickByText('Run scan');
await page.waitForSelector('[data-testid="bt-row"]', { timeout: 180_000 })
  .catch(() => fail('scan produced no rows'));
await shot('backtest');

// 3) Signals: trade plans with the confidence breakdown, live scanner on the right.
await clickByText('Signals');
await setField('sig-mintrades', 10);
await setField('sig-minexp', 0);
await setField('sig-topn', 50);
await setField('sig-window', 10);
await page.waitForSelector('[data-testid="sig-card"]', { timeout: 180_000 })
  .catch(() => fail('no signal cards rendered'));
await page.waitForSelector('[data-testid="scan-row"][data-live="1"]', { timeout: 120_000 })
  .catch(() => fail('live scanner has no rows'));
await shot('signals', '[data-testid="sig-card"], [data-testid="scan-row"]');

// 4) Alerts: the engine's feed (provisional, confirmed, withdrawn).
await clickByText('Alerts');
await page.waitForSelector('[data-testid="alert-row"]', { timeout: 600_000 })
  .catch(() => fail('alert feed stayed empty'));
await shot('alerts');

await browser.close();
console.log('capture done');
