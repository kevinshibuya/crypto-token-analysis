import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignalsPanel } from '../src/components/SignalsPanel';
import type { Interval, TradePlan } from '../src/api/types';

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  setup: ['hammer'], direction: 'bullish', signalT: 1, ageCandles: 1,
  entry: 100, stop: 96.8, target: 106, rr: 1.875, status: 'active',
  metrics: { trades: 40, wins: 0, winRate: 0, avgR: 0, profitFactor: null, expectancy: 0.3, maxDrawdownR: 0, filtered: 0, longTrades: 0, shortTrades: 0 },
  confidence: { edge: 0.6, sample: 0.57, confluence: 0.33, bracket: 0.62, score: 56 },
  ...over,
});

const stubSignals = (plans: TradePlan[]) =>
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ coin: 'BTC', interval: '1h', plans, qualifiedCount: 2, candleCount: 500, lastCandleT: 1 }))));

const props = {
  coin: 'BTC', interval: '1h' as Interval, markets: [], active: true,
  onCoin: vi.fn(), onViewPlan: vi.fn(),
};

describe('SignalsPanel cards', () => {
  it('renders active and dimmed expired cards with confidence breakdown', async () => {
    stubSignals([plan(), plan({ setup: ['doji'], status: 'expired', confidence: { edge: 0.2, sample: 0.4, confluence: 0, bracket: 0.3, score: 24 } })]);
    render(<SignalsPanel {...props} />);
    const cards = await screen.findAllByTestId('sig-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('▲ LONG');
    expect(cards[0].textContent).toContain('56');
    expect(cards[0].textContent).toContain('edge');
    expect(cards[1].className).toContain('opacity-50');
    expect(cards[1].textContent).toContain('expired');
  });

  it('shows the empty state when no plans qualify', async () => {
    stubSignals([]);
    render(<SignalsPanel {...props} />);
    expect(await screen.findByTestId('sig-empty')).toBeTruthy();
  });

  it('fires onViewPlan with the plan when View on chart is clicked', async () => {
    const p = plan();
    stubSignals([p]);
    const onViewPlan = vi.fn();
    render(<SignalsPanel {...props} onViewPlan={onViewPlan} />);
    fireEvent.click(await screen.findByText('View on chart'));
    expect(onViewPlan).toHaveBeenCalledWith(expect.objectContaining({ entry: 100, stop: 96.8, target: 106 }));
  });

  it('persists settings changes and resets to defaults', async () => {
    stubSignals([]);
    render(<SignalsPanel {...props} />);
    await screen.findByTestId('sig-empty');
    fireEvent.change(screen.getByTestId('sig-window'), { target: { value: '7' } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('cta:signals-settings:v1')!).window).toBe(7));
    fireEvent.click(screen.getByTestId('sig-reset'));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('cta:signals-settings:v1')!).window).toBe(3));
  });
});
