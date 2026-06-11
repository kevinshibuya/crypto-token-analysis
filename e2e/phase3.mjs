// e2e/phase3.mjs — Signals tab, market sweep, and chart plan lines against live Hyperliquid.
// Prereqs: `pnpm --filter @cta/server start` and `pnpm --filter @cta/web dev` running.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.WEB_URL ?? 'http://localhost:5173';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

mkdirSync('e2e/out', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 950 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => fail(`cannot reach ${URL}`));

const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) fail(`button "${text}" not found`);
};
// Native setter + input event: headless Chrome drops/garbles keystrokes on number inputs
// (triple-click doesn't select, '-' is swallowed), so page.type is unreliable here.
const setField = async (testid, value) => {
  const sel = `[data-testid="${testid}"]`;
  await page.$eval(sel, (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};

// 1) Signals tab with permissive settings (BTC 1h should yield plans)
await clickByText('Signals');
await setField('sig-mintrades', 1);
await setField('sig-minexp', -5);
await setField('sig-topn', 50); // default topN=10 can exclude recently-fired setups (gate ranks by expectancy)
await setField('sig-window', 50);
await page.waitForSelector('[data-testid="sig-card"]', { timeout: 120_000 })
  .catch(() => fail('no signal cards rendered'));
const cards = (await page.$$('[data-testid="sig-card"]')).length;
console.log(`PASS: ${cards} signal card(s) for BTC`);
await page.screenshot({ path: 'e2e/out/signals.png' });

// 2) market sweep, top 5
await setField('sig-scantopn', 5);
await page.click('[data-testid="scan-start"]');
await page.waitForFunction(() => {
  const el = document.querySelector('[data-testid="scan-progress"]');
  if (!el) return false;
  const [d, t] = el.textContent.split('/').map(Number);
  return t > 0 && d === t;
}, { timeout: 300_000 }).catch(() => fail('market scan did not finish'));
const ranked = (await page.$$('[data-testid="scan-row"]')).length;
const skipped = (await page.$$('[data-testid="scan-skip"]')).length;
console.log(`PASS: scan finished — ${ranked} ranked, ${skipped} skipped`);
await page.screenshot({ path: 'e2e/out/scanner.png' });

// 3) view on chart → three price lines
await clickByText('View on chart');
await page.waitForFunction(() => window.__planLineCount === 3, { timeout: 15_000 })
  .catch(() => fail('plan lines not rendered on chart'));
console.log('PASS: entry/stop/target lines on chart');
await page.screenshot({ path: 'e2e/out/chart-lines.png' });

await browser.close();
console.log('E2E PASS');
