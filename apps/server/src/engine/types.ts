// apps/server/src/engine/types.ts
import type { Interval, SignalDirection, SignalKind } from '@cta/core';
import type { AlertKind } from '../cache/alertStore';

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
