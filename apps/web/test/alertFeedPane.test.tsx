import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlertFeedPane } from '../src/components/AlertFeedPane';
import type { LiveAlert } from '../src/api/types';

const alert = (kind: LiveAlert['kind'], coin: string, ts: number): LiveAlert => ({
  ts, kind, coin, interval: '1h',
  payload: {
    kind, identity: `${coin}-${ts}`, coin, interval: '1h', direction: 'bullish',
    setup: ['ma-golden-cross'], entry: 10, stop: 9, target: 12, rr: 2, confidence: 81, ts, link: '',
  },
});

describe('AlertFeedPane', () => {
  it('lists alerts chronologically (as given) with kind badges', () => {
    render(<AlertFeedPane
      alerts={[alert('provisional-new', 'BTC', 3), alert('provisional-confirmed', 'ETH', 2), alert('provisional-withdrawn', 'SOL', 1)]}
      onOpen={() => {}}
    />);
    const rows = screen.getAllByTestId('alert-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('⚠');
    expect(rows[0].textContent).toContain('BTC');
    expect(rows[1].textContent).toContain('✓');
    expect(rows[2].textContent).toContain('✗');
  });

  it('confirmed-new gets the bell badge', () => {
    render(<AlertFeedPane alerts={[alert('confirmed-new', 'BTC', 1)]} onOpen={() => {}} />);
    expect(screen.getByTestId('alert-row').textContent).toContain('🔔');
  });

  it('clicking an alert opens it', () => {
    const opened: LiveAlert[] = [];
    const a = alert('confirmed-new', 'BTC', 1);
    render(<AlertFeedPane alerts={[a]} onOpen={(x) => opened.push(x)} />);
    fireEvent.click(screen.getByTestId('alert-row'));
    expect(opened).toEqual([a]);
  });

  it('renders an empty state', () => {
    render(<AlertFeedPane alerts={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no alerts yet/i)).toBeInTheDocument();
  });
});
