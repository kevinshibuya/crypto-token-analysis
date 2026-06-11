// Chart is canvas-heavy; assert App-level behavior with Chart mocked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TradePlan } from '../src/api/types';

const chartProps: unknown[] = [];
vi.mock('../src/components/Chart', () => ({
  Chart: (props: { plan: unknown }) => {
    chartProps.push(props.plan);
    return <div data-testid="chart-mock" />;
  },
}));
import { App } from '../src/App';

afterEach(() => { vi.unstubAllGlobals(); chartProps.length = 0; });

const plan: TradePlan = {
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 0,
  entry: 100, stop: 96.8, target: 106, rr: 1.875, status: 'active',
  metrics: { trades: 40, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy: 0.3, maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0 },
  confidence: { edge: 0.6, sample: 0.57, confluence: 0.33, bracket: 0.62, score: 56 },
};

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/api/markets') return new Response(JSON.stringify({ markets: [], updatedAt: 1 }));
  if (url === '/api/signals') return new Response(JSON.stringify({ coin: 'BTC', interval: '1h', plans: [plan], qualifiedCount: 1, candleCount: 500, lastCandleT: 1 }));
  // /api/analysis
  return new Response(JSON.stringify({
    coin: 'BTC', interval: '1h', candles: [], rsi: [], movingAverages: [], volume: { bars: [], sma: [] },
    volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } }, pivots: [], signals: [],
    meta: { lastUpdated: 1, candleCount: 0 },
  }));
}));

describe('view on chart', () => {
  it('passes plan prices to Chart, switches to the Chart tab, and clears on interval change', async () => {
    stubFetch();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Signals' }));
    fireEvent.click(await screen.findByText('View on chart'));
    await waitFor(() =>
      expect(chartProps.at(-1)).toEqual({ entry: 100, stop: 96.8, target: 106 }));
    expect(screen.getByRole('button', { name: 'Chart' }).className).toContain('bg-blue-600');
    // planTarget is pinned to coin×interval — switching interval makes it no longer match,
    // so the chart receives plan=null (same visible behavior as the old reset effect)
    fireEvent.click(screen.getByText('4h'));
    await waitFor(() => expect(chartProps.at(-1)).toBeNull());
  });
});
