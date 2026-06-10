import { describe, it, expect, vi, afterEach } from 'vitest';
import { postSignals, ApiError } from '../src/api/client';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

afterEach(() => { vi.unstubAllGlobals(); });

describe('postSignals', () => {
  it('serializes gate/weights/window (not scanTopN) and parses the response', async () => {
    const fetchMock = vi.fn<[string, RequestInit], Promise<Response>>(
      async () => new Response(JSON.stringify({ coin: 'BTC', plans: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await postSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS);
    expect(r.coin).toBe('BTC');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.config.gate).toEqual(DEFAULT_SIGNALS_SETTINGS.gate);
    expect(body.config.weights).toEqual(DEFAULT_SIGNALS_SETTINGS.weights);
    expect(body.config.window).toBe(DEFAULT_SIGNALS_SETTINGS.window);
    expect(body.config.scanTopN).toBeUndefined();
    expect(body.config.force).toBeUndefined();
  });

  it('throws ApiError carrying the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 422 })));
    await expect(postSignals('XX', '1h', DEFAULT_SIGNALS_SETTINGS)).rejects.toMatchObject(
      { status: 422, constructor: ApiError },
    );
  });
});
