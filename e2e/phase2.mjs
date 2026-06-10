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
