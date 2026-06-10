import { useEffect, useMemo, useState } from 'react';
import { getMarkets } from './api/client';
import type { AnalysisConfig, Market } from './api/types';
import { useAnalysis } from './state/useAnalysis';
import { Toolbar } from './components/Toolbar';
import type { View } from './components/Toolbar';
import { IndicatorDrawer } from './components/IndicatorDrawer';
import { Chart } from './components/Chart';
import { buildMarkers, DEFAULT_FAMILIES, type FamilyToggles } from './signals';
import { BacktestPanel } from './components/BacktestPanel';
import { SignalsPanel } from './components/SignalsPanel';

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

export function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [view, setView] = useState<View>('chart');
  const [families, setFamilies] = useState<FamilyToggles>(DEFAULT_FAMILIES);
  const { data, loading, error, reload } = useAnalysis(config);

  useEffect(() => {
    getMarkets().then((r) => setMarkets(r.markets)).catch((e) => console.error('markets fetch failed', e));
  }, []);

  const status = useMemo(() => {
    if (error) return `error: ${error}`;
    if (loading) return 'loading…';
    if (data) return `${data.meta.candleCount} candles · updated ${new Date(data.meta.lastUpdated).toLocaleString()}`;
    return '';
  }, [error, loading, data]);

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
      />
      <div className={view === 'chart' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <Chart data={data} maColors={maColors} markers={markers} />
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
          onViewPlan={() => {}}
        />
      </div>
    </div>
  );
}
