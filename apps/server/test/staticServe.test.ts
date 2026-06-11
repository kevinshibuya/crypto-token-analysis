import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';

describe('static web serving', () => {
  it('serves index.html and assets from webDistDir', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cta-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html><body>cta-dashboard</body></html>');
    writeFileSync(join(dist, 'app.js'), 'console.log(1)');
    const app = buildApp({ webDistDir: dist });
    await app.ready();
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('cta-dashboard');
    const asset = await app.inject({ method: 'GET', url: '/app.js' });
    expect(asset.statusCode).toBe(200);
  });

  it('still routes /api and /live family endpoints with static registered', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cta-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    const app = buildApp({ webDistDir: dist });
    await app.ready();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');
  });

  it('a missing dist dir degrades to API-only with a warning, not a crash', async () => {
    const app = buildApp({ webDistDir: '/nonexistent/web/dist' });
    await app.ready();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(404);
  });
});
