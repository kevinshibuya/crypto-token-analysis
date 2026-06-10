import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
  type SeriesMarker, type Time,
} from 'lightweight-charts';
import type { AnalysisResponse } from '../api/types';
import { VolumeProfileOverlay } from './VolumeProfileOverlay';
import type { ChartMarker } from '../signals';

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function Chart({ data, maColors, markers, plan }: {
  data: AnalysisResponse | null;
  maColors: string[];
  markers: ChartMarker[];
  plan: { entry: number; stop: number; target: number } | null;
}) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const priceChart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const volSma = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiLine = useRef<ISeriesApi<'Line'> | null>(null);
  const maRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const pivotLines = useRef<IPriceLine[]>([]);
  const planLines = useRef<IPriceLine[]>([]);
  const [tick, setTick] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current) return;
    const common = {
      layout: { background: { type: ColorType.Solid, color: '#0b1220' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#16223a' }, horzLines: { color: '#16223a' } },
      timeScale: { timeVisible: true, borderColor: '#1e293b' },
      rightPriceScale: { borderColor: '#1e293b' },
    };
    const pc = createChart(priceRef.current, { ...common, height: 440 });
    const rc = createChart(rsiRef.current, { ...common, height: 130 });
    priceChart.current = pc;
    candle.current = pc.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false,
    });
    vol.current = pc.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
    volSma.current = pc.addLineSeries({ priceScaleId: 'vol', color: '#eab308', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    rsiLine.current = rc.addLineSeries({ color: '#a78bfa', lineWidth: 1 });
    rsiLine.current.createPriceLine({ price: 70, color: '#475569', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '70' });
    rsiLine.current.createPriceLine({ price: 30, color: '#475569', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '30' });

    const sync = (a: IChartApi, b: IChartApi) =>
      a.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) b.timeScale().setVisibleLogicalRange(r); });
    sync(pc, rc);
    sync(rc, pc);
    pc.timeScale().subscribeVisibleLogicalRangeChange(() => setTick((t) => t + 1));

    const ro = new ResizeObserver(() => {
      const w = priceRef.current?.clientWidth ?? 0;
      pc.applyOptions({ width: w });
      rc.applyOptions({ width: rsiRef.current?.clientWidth ?? 0 });
      setWidth(w);
      setTick((t) => t + 1);
    });
    ro.observe(priceRef.current);
    return () => { ro.disconnect(); pc.remove(); rc.remove(); maRefs.current = []; pivotLines.current = []; planLines.current = []; };
  }, []);

  useEffect(() => {
    const pc = priceChart.current;
    if (!data || !pc || !candle.current || !vol.current || !volSma.current || !rsiLine.current) return;
    candle.current.setData(data.candles.map((c) => ({ time: toSec(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
    vol.current.setData(data.volume.bars.map((b) => ({ time: toSec(b.t), value: b.value, color: b.up ? '#14532d' : '#7f1d1d' })));
    volSma.current.setData(data.volume.sma.map((p) => ({ time: toSec(p.t), value: p.value })));
    rsiLine.current.setData(data.rsi.map((p) => ({ time: toSec(p.t), value: p.value })));

    for (const s of maRefs.current) pc.removeSeries(s);
    maRefs.current = data.movingAverages.map((ma, i) => {
      const s = pc.addLineSeries({ color: maColors[i] ?? '#22d3ee', lineWidth: 1 });
      s.setData(ma.points.map((p) => ({ time: toSec(p.t), value: p.value })));
      return s;
    });

    for (const pl of pivotLines.current) candle.current.removePriceLine(pl);
    pivotLines.current = data.pivots.map((p) =>
      candle.current!.createPriceLine({
        price: p.price,
        color: p.type === 'resistance' ? '#f59e0b' : '#3b82f6',
        lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true,
        title: p.type === 'resistance' ? 'R' : 'S',
      }),
    );
    pc.timeScale().fitContent();
    setTick((t) => t + 1);
  }, [data, maColors]);

  useEffect(() => {
    if (!candle.current) return;
    candle.current.setMarkers(markers as unknown as SeriesMarker<Time>[]);
    if (import.meta.env.DEV) {
      (window as unknown as { __markerCount?: number }).__markerCount = markers.length;
    }
  }, [markers, data]);

  useEffect(() => {
    const c = candle.current;
    if (!c) return;
    for (const pl of planLines.current) c.removePriceLine(pl);
    planLines.current = [];
    if (plan) {
      planLines.current = [
        c.createPriceLine({ price: plan.entry, color: '#e2e8f0', lineStyle: LineStyle.Solid, lineWidth: 1, axisLabelVisible: true, title: 'entry' }),
        c.createPriceLine({ price: plan.stop, color: '#ef4444', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'stop' }),
        c.createPriceLine({ price: plan.target, color: '#22c55e', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'target' }),
      ];
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __planLineCount?: number }).__planLineCount = planLines.current.length;
    }
  }, [plan, data]);

  const priceToY = (price: number): number | null => candle.current?.priceToCoordinate(price) ?? null;

  const axisWidth = priceChart.current?.priceScale('right').width() ?? 0;
  const overlayWidth = Math.max(0, width - axisWidth);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="relative" data-tick={tick}>
        <div ref={priceRef} className="w-full" />
        {data && <VolumeProfileOverlay profile={data.volumeProfile} priceToY={priceToY} width={overlayWidth} />}
      </div>
      <div ref={rsiRef} className="w-full border-t border-slate-800" />
    </div>
  );
}
