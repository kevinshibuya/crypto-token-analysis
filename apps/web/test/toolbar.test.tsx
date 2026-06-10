import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeframePills } from '../src/components/TimeframePills';
import { MarketPicker } from '../src/components/MarketPicker';
import { Toolbar } from '../src/components/Toolbar';

describe('TimeframePills', () => {
  it('emits the clicked interval', () => {
    const onChange = vi.fn();
    render(<TimeframePills value="1h" onChange={onChange} />);
    fireEvent.click(screen.getByText('4h'));
    expect(onChange).toHaveBeenCalledWith('4h');
  });
});

describe('MarketPicker', () => {
  it('filters and selects a market', () => {
    const onChange = vi.fn();
    render(
      <MarketPicker
        markets={[{ name: 'BTC', szDecimals: 5, maxLeverage: 50, dayNtlVlm: 0 }, { name: 'ETH', szDecimals: 4, maxLeverage: 50, dayNtlVlm: 0 }]}
        value="BTC"
        onChange={onChange}
      />,
    );
    fireEvent.focus(screen.getByPlaceholderText('Search market…'));
    fireEvent.change(screen.getByPlaceholderText('Search market…'), { target: { value: 'eth' } });
    fireEvent.mouseDown(screen.getByText('ETH'));
    expect(onChange).toHaveBeenCalledWith('ETH');
  });
});

describe('Toolbar tabs', () => {
  const base = {
    markets: [],
    coin: 'BTC',
    interval: '1h' as const,
    onCoin: vi.fn(),
    onInterval: vi.fn(),
    onRefresh: vi.fn(),
    status: '',
  };
  it('fires onView when a tab is clicked', () => {
    const onView = vi.fn();
    render(<Toolbar {...base} view="chart" onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backtest' }));
    expect(onView).toHaveBeenCalledWith('backtest');
  });
  it('marks the active tab', () => {
    render(<Toolbar {...base} view="backtest" onView={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Backtest' }).className).toContain('bg-blue-600');
  });
  it('offers a Signals tab', () => {
    const onView = vi.fn();
    render(<Toolbar {...base} view="chart" onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Signals' }));
    expect(onView).toHaveBeenCalledWith('signals');
  });
});
