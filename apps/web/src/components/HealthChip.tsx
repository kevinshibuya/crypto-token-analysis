import type { LiveHealth } from '../api/types';

export type HealthLevel = 'green' | 'amber' | 'red';

const STALE_TICK_MS = 15_000;
const DEEP_QUEUE = 25;

export function healthLevel(connected: boolean, health: LiveHealth | null): HealthLevel {
  if (!connected || !health || !health.wsConnected) return 'red';
  if (health.lastTickAgeMs < 0 || health.lastTickAgeMs > STALE_TICK_MS || health.queueDepth > DEEP_QUEUE) return 'amber';
  return 'green';
}

const DOT: Record<HealthLevel, string> = {
  green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-500',
};

export function HealthChip({ connected, health }: { connected: boolean; health: LiveHealth | null }) {
  const level = healthLevel(connected, health);
  const label = level === 'red'
    ? 'engine offline'
    : level === 'amber'
      ? `degraded · q${health!.queueDepth} · tick ${health!.lastTickAgeMs < 0 ? '—' : `${Math.round(health!.lastTickAgeMs / 1000)}s`}`
      : `live · ${health!.coinsLive} coins`;
  const title = health
    ? `ws ${health.wsConnected ? 'up' : 'down'} · tick age ${health.lastTickAgeMs}ms · queue ${health.queueDepth} · scans ${health.scansCompleted}`
    : 'no engine feed';
  return (
    <span
      data-testid="health-chip"
      data-state={level}
      title={title}
      className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[level]}`} />
      {label}
    </span>
  );
}
