import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IndicatorDrawer } from '../src/components/IndicatorDrawer';
import type { AnalysisConfig } from '../src/api/types';
import { DEFAULT_FAMILIES } from '../src/signals';

const base: AnalysisConfig = {
  coin: 'BTC', interval: '1h', lookback: 1000, rsiPeriod: 14,
  movingAverages: [], volumeProfileRows: 24, pivotLookback: 5, pivotMaxLevels: 6,
};

describe('IndicatorDrawer', () => {
  it('adds a moving average', () => {
    const onChange = vi.fn();
    render(<IndicatorDrawer config={base} onChange={onChange} families={DEFAULT_FAMILIES} onFamilies={vi.fn()} />);
    fireEvent.click(screen.getByText('+ add'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ movingAverages: [expect.objectContaining({ type: 'EMA', period: 50 })] }),
    );
  });

  it('edits the RSI period', () => {
    const onChange = vi.fn();
    render(<IndicatorDrawer config={base} onChange={onChange} families={DEFAULT_FAMILIES} onFamilies={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('14'), { target: { value: '21' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rsiPeriod: 21 }));
  });

  it('toggles a signal family', () => {
    const onFamilies = vi.fn();
    render(
      <IndicatorDrawer
        config={base} onChange={vi.fn()}
        families={{ pattern: true, rsi: true, ma: true, volume: true, sr: true }}
        onFamilies={onFamilies}
      />,
    );
    fireEvent.click(screen.getByLabelText('Candle patterns'));
    expect(onFamilies).toHaveBeenCalledWith({ pattern: false, rsi: true, ma: true, volume: true, sr: true });
  });
});
