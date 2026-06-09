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
