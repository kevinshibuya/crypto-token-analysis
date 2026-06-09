import { useEffect, useMemo, useState } from 'react';
import { getMarkets } from './api/client';
import type { AnalysisConfig, Market } from './api/types';
import { useAnalysis } from './state/useAnalysis';
import { Toolbar } from './components/Toolbar';
import { IndicatorDrawer } from './components/IndicatorDrawer';
import { Chart } from './components/Chart';

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
  const { data, loading, error, reload } = useAnalysis(config);

  useEffect(() => {
    getMarkets().then((r) => setMarkets(r.markets)).catch(() => undefined);
  }, []);

  const status = useMemo(() => {
    if (error) return `error: ${error}`;
    if (loading) return 'loading…';
    if (data) return `${data.meta.candleCount} candles · updated ${new Date(data.meta.lastUpdated).toLocaleString()}`;
    return '';
  }, [error, loading, data]);

  const maColors = config.movingAverages.map((m) => m.color);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        markets={markets}
        coin={config.coin}
        interval={config.interval}
        onCoin={(coin) => setConfig({ ...config, coin })}
        onInterval={(interval) => setConfig({ ...config, interval })}
        onRefresh={reload}
        status={status}
      />
      <div className="flex min-h-0 flex-1">
        <Chart data={data} maColors={maColors} />
        <IndicatorDrawer config={config} onChange={setConfig} />
      </div>
    </div>
  );
}
