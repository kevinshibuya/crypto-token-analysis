import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeframePills } from '../src/components/TimeframePills';
import { MarketPicker } from '../src/components/MarketPicker';

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
        markets={[{ name: 'BTC', szDecimals: 5, maxLeverage: 50 }, { name: 'ETH', szDecimals: 4, maxLeverage: 50 }]}
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
