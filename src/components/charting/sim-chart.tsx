"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { ChartTypeKey } from "@/domain/indicators/chart-types";
import { formatCrosshairTime, formatTickMark } from "@/domain/native-replay/chart-time";
import type { ChartSettings } from "@/domain/charting/workspace";
import { barIndexAt, studySignature, type Display, type StudyRender } from "@/domain/charting/render-model";
import { replayChartPalette } from "@/components/native-replay/chart/chart-theme";

/**
 * Simulation chart: one lightweight-charts instance showing a chart type,
 * built-in indicators and script outputs in panes, account price lines, and
 * markers. Holds only candles the account has already revealed — scrolling
 * right shows empty space, never future bars (clamped to MAX_EMPTY_BARS).
 *
 * React renders it once per theme/precision; everything else is applied
 * imperatively by effects keyed on what actually changed (structure vs data).
 */

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
  style: "solid" | "dashed" | "dotted";
}

export interface SimChartHandle {
  /** Shows the crosshair at chart time `t` (seconds) — from a synced chart. */
  syncCrosshair(t: number | null): void;
  /** Shows the same time span as a synced chart. */
  syncTimeRange(range: { from: number; to: number } | null): void;
  scrollToLatest(): void;
  chart(): IChartApi | null;
  mainSeries(): ISeriesApi<SeriesType> | null;
  /** Element the chart is drawn in (for overlays such as drawings). */
  element(): HTMLDivElement | null;
}

interface Props {
  theme: string | undefined;
  priceDigits: number;
  chartType: ChartTypeKey;
  display: Display;
  studies: StudyRender[];
  settings: ChartSettings;
  priceLines: PriceLineSpec[];
  /** Changes when the view should re-fit (instrument / timeframe / type switch). */
  fitKey: string;
  onCrosshair: (index: number | null, time: number | null) => void;
  onTimeRange: (range: { from: number; to: number } | null) => void;
  onFollowChange: (following: boolean) => void;
  /** The chart was rebuilt (theme/precision) or its main series replaced. */
  onReady?: (chart: IChartApi, series: ISeriesApi<SeriesType>) => void;
}

const RIGHT_OFFSET_BARS = 10;
const DEFAULT_BAR_SPACING = 8;
const MAX_EMPTY_BARS = 40;
const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

type MainKind = "candle" | "hollow" | "bar" | "line" | "area" | "baseline";
function mainKindOf(t: ChartTypeKey): MainKind {
  if (t === "bars") return "bar";
  if (t === "line") return "line";
  if (t === "area") return "area";
  if (t === "baseline") return "baseline";
  if (t === "hollow") return "hollow";
  return "candle";
}

const ts = (t: number) => t as UTCTimestamp;

const SimChartInner = forwardRef<SimChartHandle, Props>(function SimChart(props, ref) {
  const { theme, priceDigits, chartType, display, studies, settings, priceLines, fitKey } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const studySeries = useRef(new Map<string, ISeriesApi<SeriesType>[]>());
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const displayRef = useRef(display);
  const callbacks = useRef(props);
  const followRef = useRef(true);
  const syncingRange = useRef(false);
  const lastFit = useRef<string | null>(null);
  const [gen, setGen] = useState(0); // bumps when the chart is rebuilt
  const [mainGen, setMainGen] = useState(0); // bumps when the main series is replaced
  const [structGen, setStructGen] = useState(0); // bumps when study series are rebuilt

  useEffect(() => {
    callbacks.current = props;
    displayRef.current = display;
  });

  const palette = replayChartPalette(theme);
  const up = settings.upColor ?? palette.up;
  const down = settings.downColor ?? palette.down;

  // ── Chart (theme / precision) ─────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text, fontSize: 11, attributionLogo: true, panes: { separatorColor: palette.border, enableResize: true } },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: {
        vertLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel, width: 1, style: 3 },
        horzLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel, width: 1, style: 3 },
      },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: palette.border,
        rightOffset: RIGHT_OFFSET_BARS,
        barSpacing: DEFAULT_BAR_SPACING,
        minBarSpacing: 0.5,
        fixRightEdge: false,
        shiftVisibleRangeOnNewBar: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickType: number) => formatTickMark(time as number, tickType),
      },
      // Precision comes from each series' priceFormat (price digits for prices, 2 for oscillators).
      localization: { timeFormatter: (time: Time) => formatCrosshairTime(time as number) },
    });
    chartRef.current = chart;

    const onRange = (range: LogicalRange | null) => {
      const main = mainRef.current;
      const info = range && main ? main.barsInLogicalRange(range) : null;
      if (range && info && info.barsAfter < -MAX_EMPTY_BARS) {
        const excess = -MAX_EMPTY_BARS - info.barsAfter;
        chart.timeScale().setVisibleLogicalRange({ from: range.from - excess, to: range.to - excess });
        return;
      }
      const following = info == null || info.barsAfter <= 0;
      if (following !== followRef.current) {
        followRef.current = following;
        callbacks.current.onFollowChange(following);
      }
      if (syncingRange.current) {
        syncingRange.current = false;
        return;
      }
      const tr = chart.timeScale().getVisibleRange();
      callbacks.current.onTimeRange(tr ? { from: tr.from as number, to: tr.to as number } : null);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onMove = (p: MouseEventParams) => {
      if (!p.sourceEvent) return; // programmatic (synced) moves don't echo back
      if (p.time == null) return callbacks.current.onCrosshair(null, null);
      const t = p.time as number;
      callbacks.current.onCrosshair(barIndexAt(displayRef.current.bars, t), t);
    };
    chart.subscribeCrosshairMove(onMove);
    const registry = studySeries.current;
    setGen((g) => g + 1);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      markersRef.current = null;
      volumeRef.current = null;
      registry.clear();
      linesRef.current = [];
      lastFit.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt deliberately on theme/precision only
  }, [theme, priceDigits]);

  // ── Settings ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      grid: { vertLines: { visible: settings.grid }, horzLines: { visible: settings.grid } },
      crosshair: { mode: settings.crosshair === "magnet" ? CrosshairMode.Magnet : settings.crosshair === "hidden" ? CrosshairMode.Hidden : CrosshairMode.Normal },
    });
    const mode = { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 }[settings.priceScale];
    chart.priceScale("right").applyOptions({ mode });
  }, [gen, settings.grid, settings.crosshair, settings.priceScale]);

  // ── Main series (chart type) ──────────────────────────────────────────────
  const mainKind = mainKindOf(chartType);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainRef.current) {
      markersRef.current?.detach();
      markersRef.current = null;
      chart.removeSeries(mainRef.current);
      linesRef.current = [];
    }
    const priceFormat = { type: "price" as const, precision: priceDigits, minMove: 1 / 10 ** priceDigits };
    const common = { priceFormat, lastValueVisible: settings.showLastPrice, priceLineVisible: settings.showLastPrice };
    let s: ISeriesApi<SeriesType>;
    if (mainKind === "candle" || mainKind === "hollow") {
      s = chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: mainKind === "hollow" ? "rgba(0,0,0,0)" : up,
        downColor: down,
        borderVisible: mainKind === "hollow",
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
    } else if (mainKind === "bar") s = chart.addSeries(BarSeries, { ...common, upColor: up, downColor: down, thinBars: false });
    else if (mainKind === "line") s = chart.addSeries(LineSeries, { ...common, color: palette.text, lineWidth: 2 });
    else if (mainKind === "area") s = chart.addSeries(AreaSeries, { ...common, lineColor: up, topColor: `${up}55`, bottomColor: `${up}05`, lineWidth: 2 });
    else s = chart.addSeries(BaselineSeries, { ...common, topLineColor: up, bottomLineColor: down, topFillColor1: `${up}40`, topFillColor2: `${up}05`, bottomFillColor1: `${down}05`, bottomFillColor2: `${down}40` });
    mainRef.current = s;
    markersRef.current = createSeriesMarkers(s, []);
    lastFit.current = null;
    setMainGen((g) => g + 1);
    callbacks.current.onReady?.(chart, s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, mainKind, up, down]);

  useEffect(() => {
    mainRef.current?.applyOptions({ lastValueVisible: settings.showLastPrice, priceLineVisible: settings.showLastPrice });
  }, [mainGen, settings.showLastPrice]);

  // ── Main data + markers + fit ─────────────────────────────────────────────
  const barColors = studies.find((s) => s.visible && s.barcolor)?.barcolor ?? null;
  useEffect(() => {
    const chart = chartRef.current;
    const s = mainRef.current;
    if (!chart || !s) return;
    const bars = display.bars;
    if (mainKind === "line" || mainKind === "area" || mainKind === "baseline") {
      s.setData(bars.map((b) => ({ time: ts(b.time), value: b.close })));
      if (mainKind === "baseline" && bars.length) (s as ISeriesApi<"Baseline">).applyOptions({ baseValue: { type: "price", price: bars[0].close } });
    } else {
      s.setData(bars.map((b, i) => (barColors?.[i] ? { time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close, color: barColors[i]!, wickColor: barColors[i]!, borderColor: barColors[i]! } : { time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    }
    const markers = studies
      .filter((st) => st.visible)
      .flatMap((st) => st.markers.filter((m) => bars[m.bar]).map((m) => ({ time: ts(bars[m.bar].time), position: m.position === "inBar" ? ("inBar" as const) : m.position, shape: m.shape, color: m.color, text: m.text })))
      .sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);
    if (lastFit.current !== fitKey && bars.length) {
      lastFit.current = fitKey;
      const t = chart.timeScale();
      // Default zoom, latest bar at the right edge. Never stretch a handful of
      // bars (the start of a replay) across the whole width.
      t.applyOptions({ barSpacing: DEFAULT_BAR_SPACING });
      t.scrollToRealTime();
    }
  }, [mainGen, display, studies, barColors, mainKind, fitKey]);

  // ── Account price lines ───────────────────────────────────────────────────
  useEffect(() => {
    const s = mainRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.removePriceLine(l);
    linesRef.current = priceLines.map((p) => s.createPriceLine({ price: p.price, color: p.color, lineWidth: 1, lineStyle: LINE_STYLE[p.style], axisLabelVisible: true, title: p.title }));
  }, [mainGen, priceLines]);

  // ── Study structure (series + panes) ──────────────────────────────────────
  const hasVolume = settings.showVolume && display.bars.some((b) => b.volume != null);
  const signature = studySignature(studies, hasVolume);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const list of studySeries.current.values()) for (const s of list) chart.removeSeries(s);
    studySeries.current.clear();
    if (volumeRef.current) chart.removeSeries(volumeRef.current);
    volumeRef.current = null;
    for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);

    let pane = 0;
    for (const st of studies) {
      if (!st.plots.length && !st.bgcolor) continue;
      const target = st.overlay ? 0 : ++pane;
      const list: ISeriesApi<SeriesType>[] = [];
      if (st.bgcolor) {
        list.push(chart.addSeries(HistogramSeries, { priceScaleId: `bg-${st.uid}`, priceLineVisible: false, lastValueVisible: false, visible: st.visible, base: 0 }, target));
        chart.priceScale(`bg-${st.uid}`, target).applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      }
      for (const p of st.plots) {
        const base = { priceLineVisible: false, lastValueVisible: st.visible, visible: st.visible, title: "", priceFormat: { type: "price" as const, precision: st.digits, minMove: 1 / 10 ** st.digits } };
        let s: ISeriesApi<SeriesType>;
        if (p.kind === "histogram") s = chart.addSeries(HistogramSeries, { ...base, color: p.color }, target);
        else if (p.kind === "area") s = chart.addSeries(AreaSeries, { ...base, lineColor: p.color, topColor: `${p.color.slice(0, 7)}40`, bottomColor: `${p.color.slice(0, 7)}05`, lineWidth: p.width as 1 }, target);
        else
          s = chart.addSeries(
            LineSeries,
            { ...base, color: p.color, lineWidth: Math.max(1, p.width) as 1, lineVisible: p.kind !== "dots", pointMarkersVisible: p.kind === "dots", pointMarkersRadius: 1.5, lineType: p.kind === "step" ? LineType.WithSteps : LineType.Simple, crosshairMarkerVisible: false },
            target,
          );
        list.push(s);
      }
      const first = list.find((_, i) => !(st.bgcolor && i === 0));
      if (first) for (const l of st.levels) first.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: l.title });
      studySeries.current.set(st.uid, list);
    }
    if (hasVolume) {
      volumeRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false, title: "Tick vol" }, ++pane);
    }
    // Relative sizes, so panes keep their proportions when the chart is resized.
    const panes = chart.panes();
    panes[0]?.setStretchFactor(panes.length > 2 ? 3 : 2.5);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(i === panes.length - 1 && hasVolume ? 0.6 : 1);
    setStructGen((g) => g + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` captures the structure of `studies`
  }, [gen, signature]);

  // ── Study data ────────────────────────────────────────────────────────────
  useEffect(() => {
    const bars = display.bars;
    for (const st of studies) {
      const list = studySeries.current.get(st.uid);
      if (!list) continue;
      let k = 0;
      if (st.bgcolor) {
        const bg = st.bgcolor;
        list[k++].setData(bars.map((b, i) => (bg[i] ? { time: ts(b.time), value: 1, color: bg[i]! } : { time: ts(b.time) })));
      }
      for (const p of st.plots) {
        const s = list[k++];
        if (!s) break;
        s.setData(
          bars.map((b, i) => {
            const v = p.values[i];
            if (v === undefined || !Number.isFinite(v)) return { time: ts(b.time) };
            const c = p.colors?.[i];
            return c && c !== p.color ? { time: ts(b.time), value: v, color: c } : { time: ts(b.time), value: v };
          }),
        );
      }
    }
    if (volumeRef.current) {
      volumeRef.current.setData(bars.map((b) => (b.volume == null ? { time: ts(b.time) } : { time: ts(b.time), value: b.volume, color: b.close >= b.open ? palette.volumeUp : palette.volumeDown })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structGen, display, studies]);

  useImperativeHandle(ref, () => ({
    syncCrosshair(t) {
      const chart = chartRef.current;
      const s = mainRef.current;
      if (!chart || !s) return;
      const bars = displayRef.current.bars;
      const i = t == null ? -1 : barIndexAt(bars, t);
      if (i < 0) chart.clearCrosshairPosition();
      else chart.setCrosshairPosition(bars[i].close, ts(bars[i].time), s);
    },
    syncTimeRange(range) {
      const chart = chartRef.current;
      if (!chart || !range || !displayRef.current.bars.length) return;
      syncingRange.current = true;
      try {
        chart.timeScale().setVisibleRange({ from: ts(range.from), to: ts(range.to) });
      } catch {
        syncingRange.current = false; // range outside data: ignore
      }
    },
    scrollToLatest() {
      chartRef.current?.timeScale().scrollToRealTime();
    },
    chart: () => chartRef.current,
    mainSeries: () => mainRef.current,
    element: () => containerRef.current,
  }));

  return <div ref={containerRef} className="absolute inset-0" role="img" aria-label="Price chart; values for the bar under the pointer are shown in the legend above the chart." />;
});

/** Memoised: legend/clock re-renders in the parent never touch the chart. */
export const SimChart = memo(SimChartInner);
