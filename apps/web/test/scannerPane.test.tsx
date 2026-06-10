import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScannerPane } from '../src/components/ScannerPane';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';
import type { Interval, Market } from '../src/api/types';

afterEach(() => { vi.unstubAllGlobals(); });

const mk = (name: string, vol: number): Market => ({ name, szDecimals: 2, maxLeverage: 50, dayNtlVlm: vol });
const markets = [mk('BTC', 100), mk('ETH', 50), mk('SOL', 25)];
const settings = { ...DEFAULT_SIGNALS_SETTINGS, scanTopN: 3 };

const plan = (score: number, status = 'active') => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 95, target: 110, rr: 2, status,
  metrics: {}, confidence: { edge: 0, sample: 0, confluence: 0, bracket: 0, score },
});
const ok = (coin: string, plans: unknown[]) =>
  new Response(JSON.stringify({ coin, interval: '1h', plans, qualifiedCount: 1, candleCount: 100, lastCandleT: 1 }));

const stub = () => vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
  const { coin } = JSON.parse(init.body as string) as { coin: string };
  if (coin === 'BTC') return ok('BTC', [plan(80)]);
  if (coin === 'ETH') return new Response('thin', { status: 422 });
  return ok('SOL', [plan(90)]);
}));

describe('ScannerPane', () => {
  it('runs a sweep, ranks by confidence, dims thin rows, and reports progress', async () => {
    stub();
    render(<ScannerPane markets={markets} interval={'1h' as Interval} settings={settings} onCoin={vi.fn()} />);
    fireEvent.click(screen.getByTestId('scan-start'));
    await waitFor(() => expect(screen.getByTestId('scan-progress').textContent).toBe('3/3'));
    const rows = screen.getAllByTestId('scan-row');
    expect(rows[0].textContent).toContain('SOL'); // 90 ranks above 80
    expect(rows[1].textContent).toContain('BTC');
    const skipped = screen.getAllByTestId('scan-skip');
    expect(skipped[0].textContent).toContain('ETH');
    expect(skipped[0].textContent).toContain('insufficient data');
    expect(skipped[0].className).toContain('opacity-50');
  });

  it('clicking a ranked row selects the coin', async () => {
    stub();
    const onCoin = vi.fn();
    render(<ScannerPane markets={markets} interval={'1h' as Interval} settings={settings} onCoin={onCoin} />);
    fireEvent.click(screen.getByTestId('scan-start'));
    await waitFor(() => expect(screen.getAllByTestId('scan-row').length).toBe(2));
    fireEvent.click(screen.getAllByTestId('scan-row')[0]);
    expect(onCoin).toHaveBeenCalledWith('SOL');
  });
});
