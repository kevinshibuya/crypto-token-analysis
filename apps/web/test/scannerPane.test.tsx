import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScannerPane } from '../src/components/ScannerPane';
import { DEFAULT_SIGNALS_SETTINGS } from '../src/state/signalsSettings';
import type { Interval, LiveScanRow, Market } from '../src/api/types';

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

const liveRow = (coin: string, interval: string, confidence: number, ts = 1): LiveScanRow => ({
  coin, interval: interval as LiveScanRow['interval'], ts, candleCount: 2000,
  plan: { direction: 'bullish', setup: ['ma-golden-cross'], entry: 10, stop: 9, target: 12, rr: 2, confidence },
});

describe('ScannerPane live mode', () => {
  it('renders live rows sorted by confidence without clicking, filtered to the current interval', () => {
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: true, rows: [liveRow('ETH', '1h', 60), liveRow('BTC', '1h', 90), liveRow('SOL', '4h', 99), { ...liveRow('DOGE', '1h', 0), plan: null }] }}
    />);
    const rows = screen.getAllByTestId('scan-row');
    expect(rows).toHaveLength(2); // SOL is 4h, DOGE has no plan
    expect(rows[0].textContent).toContain('BTC'); // confidence desc
    expect(rows[0].dataset.live).toBe('1');
    expect(rows[0].dataset.ts).toBe('1');
    expect(screen.getByTestId('scan-live-indicator')).toBeInTheDocument();
  });

  it('falls back to manual mode when the feed is disconnected', () => {
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: false, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    expect(screen.queryAllByTestId('scan-row')).toHaveLength(0); // no live rows shown
    expect(screen.getByTestId('scan-start')).toBeDisabled(); // no markets loaded in this render — same as today
  });

  it('clicking Scan market switches to manual results; the Live button returns', async () => {
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={() => {}}
      live={{ connected: true, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    expect(screen.getAllByTestId('scan-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('scan-start')); // manual sweep of zero markets → empty
    await waitFor(() => expect(screen.queryAllByTestId('scan-row')).toHaveLength(0));
    fireEvent.click(screen.getByTestId('scan-live'));
    expect(screen.getAllByTestId('scan-row')).toHaveLength(1);
  });

  it('live row click selects the coin', async () => {
    const picked: string[] = [];
    render(<ScannerPane
      markets={[]} interval="1h" settings={DEFAULT_SIGNALS_SETTINGS} onCoin={(c) => picked.push(c)}
      live={{ connected: true, rows: [liveRow('BTC', '1h', 90)] }}
    />);
    fireEvent.click(screen.getAllByTestId('scan-row')[0]);
    expect(picked).toEqual(['BTC']);
  });
});
