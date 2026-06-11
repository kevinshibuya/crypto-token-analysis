import { useEffect, useMemo, useState } from 'react';
import type { LiveAlert, LiveHealth, LiveScanRow, LiveSnapshot } from '../api/types';

export const MAX_FEED_ALERTS = 200;

export interface LiveFeedState {
  connected: boolean;
  scans: LiveScanRow[];      // latest per coin×interval, insertion order
  alerts: LiveAlert[];       // newest first, digests excluded
  health: LiveHealth | null;
}

const keyOf = (s: LiveScanRow): string => `${s.coin}|${s.interval}`;
const dropDigests = (alerts: LiveAlert[]): LiveAlert[] => alerts.filter((a) => a.kind !== 'digest');

/** Subscribes to GET /live (SSE). EventSource auto-reconnects; each reconnect replays a fresh snapshot. */
export function useLiveFeed(url = '/live'): LiveFeedState {
  const [connected, setConnected] = useState(false);
  const [scanMap, setScanMap] = useState<Map<string, LiveScanRow>>(new Map());
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [health, setHealth] = useState<LiveHealth | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('snapshot', (ev) => {
      const snap = JSON.parse((ev as MessageEvent).data) as LiveSnapshot;
      setScanMap(new Map(snap.scans.map((s) => [keyOf(s), s])));
      setAlerts(dropDigests(snap.alerts).slice(0, MAX_FEED_ALERTS));
      setHealth(snap.health);
    });
    es.addEventListener('scan', (ev) => {
      const s = JSON.parse((ev as MessageEvent).data) as LiveScanRow;
      setScanMap((prev) => new Map(prev).set(keyOf(s), s));
    });
    es.addEventListener('alert', (ev) => {
      const a = JSON.parse((ev as MessageEvent).data) as LiveAlert;
      if (a.kind === 'digest') return;
      setAlerts((prev) => [a, ...prev].slice(0, MAX_FEED_ALERTS));
    });
    es.addEventListener('health', (ev) => {
      setHealth(JSON.parse((ev as MessageEvent).data) as LiveHealth);
    });
    return () => es.close();
  }, [url]);

  const scans = useMemo(() => [...scanMap.values()], [scanMap]);
  return { connected, scans, alerts, health };
}
