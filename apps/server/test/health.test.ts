import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('includes the engine block when a status provider is registered', async () => {
    const app = buildApp({
      engineStatus: () => ({ wsConnected: true, lastTickAgeMs: 120, queueDepth: 0, busyWorkers: 1, coinsTracked: 20, coinsLive: 18, scansCompleted: 42, latencies: {} }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.engine.wsConnected).toBe(true);
    expect(body.engine.scansCompleted).toBe(42);
  });

  it('omits the engine block when no provider is registered (existing shape unchanged)', async () => {
    const app = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSec).toBe('number');
    expect(body.engine).toBeUndefined();
  });
});
