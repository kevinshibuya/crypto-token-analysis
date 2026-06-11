// apps/server/src/engine/types.ts
import type { Interval, SignalDirection, SignalKind } from '@cta/core';
import type { AlertKind, AlertRow } from '../cache/alertStore';
import type { HealthSnapshot } from './metrics';

export interface PlanAlert {
  kind: AlertKind;
  identity: string;
  coin: string;
  interval: Interval;
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
  ts: number;
  note?: string;
  link: string;
}

export interface DigestAlert {
  kind: 'digest';
  ts: number;
  count: number;
  coins: string[];
  top: PlanAlert[]; // top 5 by confidence
}

export interface ScanPlanSummary {
  direction: SignalDirection;
  setup: SignalKind[];
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
}

export interface ScanEvent {
  coin: string;
  interval: Interval;
  ts: number;
  candleCount: number;
  plan: ScanPlanSummary | null; // best active plan, null when none
}

export interface HealthEvent extends HealthSnapshot { ts: number }

export interface LiveSnapshot {
  scans: ScanEvent[];   // current rankings, confidence desc
  alerts: AlertRow[];   // newest first
  health: HealthEvent;
}
