import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSignals } from '../src/state/useSignals';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';

afterEach(() => { vi.unstubAllGlobals(); });

const ok = (coin: string) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans: [], qualifiedCount: 0, candleCount: 100, lastCandleT: 1 }));

describe('useSignals', () => {
  it('fetches when enabled and exposes data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok('BTC')));
    const { result } = renderHook(() => useSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS, true, 0));
    await waitFor(() => expect(result.current.data?.coin).toBe('BTC'));
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch while disabled, fetches on activation', async () => {
    const fetchMock = vi.fn(async () => ok('BTC'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHook(
      ({ enabled }) => useSignals('BTC', '1h', DEFAULT_SIGNALS_SETTINGS, enabled, 0),
      { initialProps: { enabled: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('aborts the in-flight request when coin changes', async () => {
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => {
      seen.push(init.signal as AbortSignal);
      return new Promise<Response>((resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        setTimeout(() => resolve(ok('?')), 50);
      });
    }));
    const { rerender, result } = renderHook(
      ({ coin }) => useSignals(coin, '1h', DEFAULT_SIGNALS_SETTINGS, true, 0),
      { initialProps: { coin: 'BTC' } },
    );
    await waitFor(() => expect(seen.length).toBe(1));
    rerender({ coin: 'ETH' });
    await waitFor(() => expect(seen[0].aborted).toBe(true));
    await waitFor(() => expect(result.current.error).toBeNull()); // aborted request must not surface as error
  });
});
