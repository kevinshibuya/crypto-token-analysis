import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BacktestPanel } from '../src/components/BacktestPanel';

const metrics = (over: Partial<Record<string, number | null>>) => ({
  trades: 30, wins: 18, winRate: 0.6, avgR: 0.5, profitFactor: 2, expectancy: 0.5,
  maxDrawdownR: 2, filtered: 4, longTrades: 20, shortTrades: 10, ...over,
});

const scanResponse = {
  cached: false, candleCount: 300, lastCandleT: 300,
  results: [
    { kinds: ['hammer'], metrics: metrics({ expectancy: 0.9, trades: 40 }) },
    { kinds: ['doji', 'volume-spike-up'], metrics: metrics({ expectancy: 0.4, trades: 5 }) },
  ],
};

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scanResponse })));

describe('BacktestPanel', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('runs a scan and renders ranked rows with low-sample dimming', async () => {
    stubFetch();
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(screen.getAllByTestId('bt-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('bt-row');
    expect(rows[0].textContent).toContain('hammer');
    expect(rows[1].className).toContain('opacity-50');         // 5 trades < 20
    expect(rows[1].textContent).toContain('low sample');
  });

  it('re-sorts when a column header is clicked', async () => {
    stubFetch();
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(screen.getAllByTestId('bt-row')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /trades/i })); // 1st click: trades desc
    fireEvent.click(screen.getByRole('button', { name: /trades/i })); // 2nd click: trades asc
    expect(screen.getAllByTestId('bt-row')[0].textContent).toContain('doji'); // 5 trades first
  });

  it('pins a custom-set result', async () => {
    const customResponse = {
      ...scanResponse,
      results: [{ kinds: ['hammer', 'rsi-oversold-exit'], metrics: metrics({}) }],
    };
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => (body.config.signalKinds ? customResponse : scanResponse) };
    }));
    render(<BacktestPanel coin="BTC" interval="1h" />);
    fireEvent.click(screen.getByLabelText('hammer'));
    fireEvent.click(screen.getByLabelText('rsi-oversold-exit'));
    fireEvent.click(screen.getByRole('button', { name: 'Test selection' }));
    await waitFor(() => expect(screen.getByTestId('bt-pinned')).toBeInTheDocument());
    expect(screen.getByTestId('bt-pinned').textContent).toContain('rsi-oversold-exit');
  });
});
