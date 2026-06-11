import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthChip, healthLevel } from '../src/components/HealthChip';
import type { LiveHealth } from '../src/api/types';

const health = (over: Partial<LiveHealth> = {}): LiveHealth => ({
  wsConnected: true, lastTickAgeMs: 500, queueDepth: 2, busyWorkers: 1,
  coinsTracked: 140, coinsLive: 138, scansCompleted: 1000, ts: 1, ...over,
});

describe('healthLevel', () => {
  it('red when the feed is disconnected or engine WS is down or health unknown', () => {
    expect(healthLevel(false, health())).toBe('red');
    expect(healthLevel(true, null)).toBe('red');
    expect(healthLevel(true, health({ wsConnected: false }))).toBe('red');
  });
  it('amber when ticks are stale or the queue is deep', () => {
    expect(healthLevel(true, health({ lastTickAgeMs: 20_000 }))).toBe('amber');
    expect(healthLevel(true, health({ lastTickAgeMs: -1 }))).toBe('amber');
    expect(healthLevel(true, health({ queueDepth: 30 }))).toBe('amber');
  });
  it('green when connected, ws up, ticks fresh, queue shallow', () => {
    expect(healthLevel(true, health())).toBe('green');
  });
});

describe('HealthChip', () => {
  it('exposes its level via data-state and shows live coin count when green', () => {
    render(<HealthChip connected={true} health={health()} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('green');
    expect(chip.textContent).toContain('138');
  });
  it('shows offline when red', () => {
    render(<HealthChip connected={false} health={null} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('red');
    expect(chip.textContent?.toLowerCase()).toContain('offline');
  });
  it('shows degraded when amber', () => {
    render(<HealthChip connected={true} health={health({ queueDepth: 99 })} />);
    const chip = screen.getByTestId('health-chip');
    expect(chip.dataset.state).toBe('amber');
    expect(chip.textContent?.toLowerCase()).toContain('degraded');
  });
});
