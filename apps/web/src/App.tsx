import { useEffect, useMemo, useState } from 'react';
import { getMarkets } from './api/client';
import type { AnalysisConfig, LiveAlert, Market, TradePlan } from './api/types';
import { useAnalysis } from './state/useAnalysis';
import { useLiveFeed } from './state/useLiveFeed';
import { Toolbar } from './components/Toolbar';
import type { View } from './components/Toolbar';
import { IndicatorDrawer } from './components/IndicatorDrawer';
import { Chart } from './components/Chart';
import { HealthChip } from './components/HealthChip';
import { AlertFeedPane } from './components/AlertFeedPane';
import { buildMarkers, DEFAULT_FAMILIES, type FamilyToggles } from './signals';
import { BacktestPanel } from './components/BacktestPanel';
import { SignalsPanel } from './components/SignalsPanel';
import { applyUrlParams } from './urlParams';

const DEFAULT_CONFIG: AnalysisConfig = {
  coin: 'BTC',
  interval: '1h',
  lookback: 1000,
  rsiPeriod: 14,
  movingAverages: [
    { type: 'EMA', period: 50, color: '#22d3ee' },
    { type: 'SMA', period: 200, color: '#f59e0b' },
  ],
  volumeProfileRows: 24,
  pivotLookback: 5,
  pivotMaxLevels: 6,
};

/** Chart plan lines, pinned to the coin×interval they belong to (only shown while it is selected). */
interface PlanTarget { coin: string; interval: string; entry: number; stop: number; target: number }

export function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(
    () => applyUrlParams(DEFAULT_CONFIG, window.location.search),
  );
  const [view, setView] = useState<View>('chart');
  const [families, setFamilies] = useState<FamilyToggles>(DEFAULT_FAMILIES);
  const [planTarget, setPlanTarget] = useState<PlanTarget | null>(null);
  const { data, loading, error, reload } = useAnalysis(config);
  const live = useLiveFeed();

  useEffect(() => {
    getMarkets().then((r) => setMarkets(r.markets)).catch((e) => console.error('markets fetch failed', e));
  }, []);

  const onViewPlan = (p: TradePlan) => {
    setPlanTarget({ coin: config.coin, interval: config.interval, entry: p.entry, stop: p.stop, target: p.target });
    setView('chart');
  };

  const onOpenAlert = (a: LiveAlert) => {
    const p = a.payload;
    setConfig((prev) => ({ ...prev, coin: a.coin, interval: a.interval as AnalysisConfig['interval'] }));
    setPlanTarget({ coin: a.coin, interval: a.interval, entry: p.entry, stop: p.stop, target: p.target });
    setView('chart');
  };

  const status = useMemo(() => {
    if (error) return `error: ${error}`;
    if (loading) return 'loading…';
    if (data) return `${data.meta.candleCount} candles · updated ${new Date(data.meta.lastUpdated).toLocaleString()}`;
    return '';
  }, [error, loading, data]);

  const plan = planTarget && planTarget.coin === config.coin && planTarget.interval === config.interval
    ? { entry: planTarget.entry, stop: planTarget.stop, target: planTarget.target }
    : null;

  const maColors = useMemo(() => config.movingAverages.map((m) => m.color), [config.movingAverages]);
  const markers = useMemo(() => buildMarkers(data?.signals ?? [], families), [data, families]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        markets={markets}
        coin={config.coin}
        interval={config.interval}
        view={view}
        onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
        onInterval={(interval) => setConfig((prev) => ({ ...prev, interval }))}
        onView={setView}
        onRefresh={reload}
        status={status}
        healthChip={<HealthChip connected={live.connected} health={live.health} />}
      />
      <div className={view === 'chart' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <Chart data={data} maColors={maColors} markers={markers} plan={plan} />
        <IndicatorDrawer config={config} onChange={setConfig} families={families} onFamilies={setFamilies} />
      </div>
      <div className={view === 'backtest' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <BacktestPanel coin={config.coin} interval={config.interval} />
      </div>
      <div className={view === 'signals' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <SignalsPanel
          coin={config.coin}
          interval={config.interval}
          markets={markets}
          active={view === 'signals'}
          onCoin={(coin) => setConfig((prev) => ({ ...prev, coin }))}
          onViewPlan={onViewPlan}
          live={{ connected: live.connected, rows: live.scans }}
        />
      </div>
      <div className={view === 'alerts' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <AlertFeedPane alerts={live.alerts} onOpen={onOpenAlert} />
      </div>
    </div>
  );
}
