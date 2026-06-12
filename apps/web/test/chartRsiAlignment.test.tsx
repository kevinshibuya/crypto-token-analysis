// The price and RSI panes are separate chart instances synced by *logical range*
// (bar index, not time). That only aligns if both series share the same timeline,
// so the RSI series must be padded with whitespace points over the warm-up candles.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { AnalysisResponse } from '../src/api/types';

type SetDataPoint = { time: number; value?: number };

interface FakeSeries {
  kind: string;
  data: SetDataPoint[];
  setData: (d: SetDataPoint[]) => void;
  setMarkers: () => void;
  createPriceLine: () => object;
  removePriceLine: () => void;
}

interface FakeChart {
  series: FakeSeries[];
}

const charts: FakeChart[] = [];

const makeSeries = (kind: string): FakeSeries => {
  const s: FakeSeries = {
    kind,
    data: [],
    setData: (d) => { s.data = d; },
    setMarkers: () => {},
    createPriceLine: () => ({}),
    removePriceLine: () => {},
  };
  return s;
};

vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dashed: 2 },
  createChart: () => {
    const chart: FakeChart = { series: [] };
    charts.push(chart);
    const add = (kind: string) => {
      const s = makeSeries(kind);
      chart.series.push(s);
      return s;
    };
    return {
      addCandlestickSeries: () => add('candlestick'),
      addHistogramSeries: () => add('histogram'),
      addLineSeries: () => add('line'),
      removeSeries: () => {},
      applyOptions: () => {},
      remove: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      timeScale: () => ({
        subscribeVisibleLogicalRangeChange: () => {},
        setVisibleLogicalRange: () => {},
        fitContent: () => {},
      }),
    };
  },
}));

import { Chart } from '../src/components/Chart';

beforeEach(() => {
  charts.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

const min = 60_000;
const candles = [1, 2, 3, 4, 5, 6].map((i) => ({ t: i * min, o: 100, h: 101, l: 99, c: 100, v: 10 }));
// RSI warm-up: first point only at the 4th candle, like rsi(candles, period)
const rsiPoints = [
  { t: 4 * min, value: 55 },
  { t: 5 * min, value: 60 },
  { t: 6 * min, value: 48 },
];

const data: AnalysisResponse = {
  coin: 'BTC', interval: '15m',
  candles,
  rsi: rsiPoints,
  movingAverages: [],
  volume: { bars: [], sma: [] },
  volumeProfile: { rows: [], poc: 0, valueArea: { low: 0, high: 0 } },
  pivots: [],
  signals: [],
  meta: { lastUpdated: 6 * min, candleCount: candles.length },
} as unknown as AnalysisResponse;

describe('Chart RSI time alignment', () => {
  it('pads the RSI series onto the candle timeline so logical-range sync aligns by time', () => {
    render(<Chart data={data} maColors={[]} markers={[]} plan={null} />);

    const candleSeries = charts[0].series.find((s) => s.kind === 'candlestick')!;
    const rsiSeries = charts[1].series.find((s) => s.kind === 'line')!;

    // identical timelines → identical logical indices on both charts
    expect(rsiSeries.data.map((p) => p.time)).toEqual(candleSeries.data.map((p) => p.time));

    // warm-up candles are whitespace points, real RSI values keep their value
    const bySec = new Map(rsiSeries.data.map((p) => [p.time, p.value]));
    expect(bySec.get(1 * 60)).toBeUndefined();
    expect(bySec.get(3 * 60)).toBeUndefined();
    expect(bySec.get(4 * 60)).toBe(55);
    expect(bySec.get(6 * 60)).toBe(48);
  });
});
