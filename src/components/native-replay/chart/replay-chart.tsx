"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { formatCrosshairTime, formatTickMark, fromChartTime, toChartTime } from "@/domain/native-replay/chart-time";
import { replayChartPalette } from "./chart-theme";
import type { DrawingController } from "../drawings/drawing-controller";

/**
 * Native Replay chart — a thin imperative wrapper over lightweight-charts.
 *
 * React renders this component once (per theme/precision); after that the
 * workspace drives it through the handle: `setCandles` (initial load, asset/
 * timeframe switch, history prepend, reconciliation) and `updateCandles`
 * (per replay step: only the changed candles — the forming one and any new
 * one — via the series' incremental `update`, never a full reload).
 *
 * Time: every value handed to the chart is the dataset wall-clock minute × 60
 * (`toChartTime`), and every label is produced by our own formatters — the
 * library renders UTC and the browser's timezone is never involved.
 *
 * No future: the chart only ever holds candles up to the replay position, so
 * scrolling right shows empty space (`rightOffset`), never unrevealed bars;
 * the scroll is clamped to MAX_EMPTY_BARS past the last candle.
 *
 * Prompt 4 foundation: `chart()`/`series()` expose the library's coordinate
 * conversions (timeToCoordinate/coordinateToTime, priceToCoordinate/
 * coordinateToPrice) and primitive attachment for drawing overlays.
 */

export interface CrosshairInfo {
  candle: EngineCandle | null; // null = pointer left the chart → show latest
}

export interface ReplayChartHandle {
  setCandles(candles: EngineCandle[], options?: { prepended?: number; fit?: boolean }): void;
  updateCandles(changed: EngineCandle[]): void;
  scrollToReplay(): void;
  chart(): IChartApi | null;
  series(): ISeriesApi<"Candlestick"> | null;
}

interface Props {
  theme: string | undefined;
  priceScale: number;
  showVolume: boolean;
  onCrosshair: (info: CrosshairInfo) => void;
  /** The visible range approached the oldest loaded candle — load more history. */
  onNearLeftEdge: () => void;
  /** Whether the right edge (the replay position) is in view. */
  onFollowChange: (following: boolean) => void;
  /** Chart drawings: attached to the chart's series (re-attached if the chart is rebuilt). */
  drawings?: DrawingController;
}

const RIGHT_OFFSET_BARS = 10;
const DEFAULT_BAR_SPACING = 8;
/** How far past the replay position the view may scroll (empty space — never candles). */
const MAX_EMPTY_BARS = 40;

declare global {
  interface Window {
    __nativeReplayMetrics?: { chartMounts: number; chartCommits: number; workspaceCommits: number; setData: number; updates: number; updateMs: number[] };
  }
}
function metrics() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  window.__nativeReplayMetrics ??= { chartMounts: 0, chartCommits: 0, workspaceCommits: 0, setData: 0, updates: 0, updateMs: [] };
  return window.__nativeReplayMetrics;
}

/** Dev-only render accounting (proves replay steps don't re-render the chart). */
export function countCommit(kind: "chartCommits" | "workspaceCommits"): void {
  const m = metrics();
  if (m) m[kind] += 1;
}

const ReplayChartInner = forwardRef<ReplayChartHandle, Props>(function ReplayChart({ theme, priceScale, showVolume, onCrosshair, onNearLeftEdge, onFollowChange, drawings }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesByTime = useRef(new Map<number, EngineCandle>());
  /** Same candles, ascending — kept incrementally for the drawing layer's coordinates. */
  const sorted = useRef<EngineCandle[]>([]);
  const scaleRef = useRef(priceScale);
  const callbacks = useRef({ onCrosshair, onNearLeftEdge, onFollowChange });
  const followRef = useRef(true);

  useEffect(() => {
    callbacks.current = { onCrosshair, onNearLeftEdge, onFollowChange };
    countCommit("chartCommits");
  });

  const toBar = (c: EngineCandle) => {
    const s = 10 ** scaleRef.current;
    return { time: toChartTime(c.time) as UTCTimestamp, open: c.open / s, high: c.high / s, low: c.low / s, close: c.close / s };
  };
  const palette = replayChartPalette(theme);
  const toVolume = (c: EngineCandle) => ({ time: toChartTime(c.time) as UTCTimestamp, value: c.tickVolume ?? 0, color: c.close >= c.open ? palette.volumeUp : palette.volumeDown });

  // Create once; rebuilt only when theme or precision change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    scaleRef.current = priceScale;
    const minMove = 1 / 10 ** priceScale;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text, fontSize: 11, attributionLogo: true, panes: { separatorColor: palette.border } },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel, width: 1, style: 3 },
        horzLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshairLabel, width: 1, style: 3 },
      },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: palette.border,
        rightOffset: RIGHT_OFFSET_BARS,
        barSpacing: DEFAULT_BAR_SPACING,
        minBarSpacing: 1,
        // Not fixRightEdge (it removes the empty space right of the last candle,
        // where positions/projections are planned): scrolling right is clamped
        // to MAX_EMPTY_BARS instead — see onRange. No candle exists there.
        fixRightEdge: false,
        shiftVisibleRangeOnNewBar: true, // follows the market only while the right edge is in view
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickType: number) => formatTickMark(time as number, tickType),
      },
      localization: {
        timeFormatter: (time: Time) => formatCrosshairTime(time as number),
        priceFormatter: (price: number) => price.toFixed(priceScale),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.upWick,
      wickDownColor: palette.downWick,
      borderVisible: false,
      priceFormat: { type: "price", precision: priceScale, minMove },
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const m = metrics();
    if (m) m.chartMounts += 1;

    const existing = [...candlesByTime.current.values()].sort((a, b) => a.time - b.time);
    if (existing.length) series.setData(existing.map(toBar));
    sorted.current = existing;
    drawings?.attach(chart, series, el);
    drawings?.setCandles(existing, priceScale);

    const onRange = (range: LogicalRange | null) => {
      // Prefetch older history while ~1.5 screens are still loaded to the left,
      // so panning back never hits a wall.
      if (range && range.from < Math.max(50, 1.5 * (range.to - range.from))) callbacks.current.onNearLeftEdge();
      // Following = the latest candle (the replay position) is on screen.
      const info = range ? series.barsInLogicalRange(range) : null;
      // Keep the right edge near the replay position: at most MAX_EMPTY_BARS of empty space.
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
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onMove = (param: MouseEventParams) => {
      if (param.time == null) return callbacks.current.onCrosshair({ candle: null });
      callbacks.current.onCrosshair({ candle: candlesByTime.current.get(fromChartTime(param.time as number)) ?? null });
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      drawings?.detach();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt deliberately on theme/precision only
  }, [theme, priceScale]);

  // Optional compact volume pane (pane 1) — the foundation for future panes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (showVolume && !volumeRef.current) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
      chart.panes()[1]?.setHeight(90);
      vol.setData([...candlesByTime.current.values()].sort((a, b) => a.time - b.time).map(toVolume));
      volumeRef.current = vol;
    } else if (!showVolume && volumeRef.current) {
      chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVolume, theme, priceScale]);

  useImperativeHandle(ref, () => ({
    setCandles(candles, options) {
      const chart = chartRef.current;
      const series = seriesRef.current;
      candlesByTime.current = new Map(candles.map((c) => [c.time, c]));
      sorted.current = [...candles];
      drawings?.setCandles(sorted.current, scaleRef.current);
      if (!chart || !series) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      series.setData(candles.map(toBar));
      volumeRef.current?.setData(candles.map(toVolume));
      const m = metrics();
      if (m) m.setData += 1;
      if (options?.prepended && range) {
        // Older history arrived on the left: keep the trader's view where it was.
        chart.timeScale().setVisibleLogicalRange({ from: range.from + options.prepended, to: range.to + options.prepended });
      } else if (options?.fit) {
        // Few candles (short history): spread them across the width instead of
        // bunching them at the right edge; otherwise show the latest candles.
        // A fresh view (timeframe/asset switch) starts from the default zoom —
        // never inherit a fitted zoom (e.g. 2 D1 candles stretched to 700px
        // each would open M1 as three giant candles).
        const ts = chart.timeScale();
        ts.applyOptions({ barSpacing: DEFAULT_BAR_SPACING });
        if (candles.length * DEFAULT_BAR_SPACING < ts.width() * 0.8) ts.fitContent();
        else ts.scrollToRealTime();
      }
    },
    updateCandles(changed) {
      const series = seriesRef.current;
      if (!series) return;
      const t0 = performance.now();
      for (const c of changed) {
        candlesByTime.current.set(c.time, c);
        const last = sorted.current[sorted.current.length - 1];
        if (!last || c.time > last.time) sorted.current.push(c);
        else if (c.time === last.time) sorted.current[sorted.current.length - 1] = c;
        series.update(toBar(c));
        volumeRef.current?.update(toVolume(c));
      }
      drawings?.setCandles(sorted.current, scaleRef.current);
      const m = metrics();
      if (m) {
        m.updates += 1;
        m.updateMs.push(performance.now() - t0);
        if (m.updateMs.length > 2000) m.updateMs.shift();
      }
    },
    scrollToReplay() {
      chartRef.current?.timeScale().scrollToRealTime();
    },
    chart: () => chartRef.current,
    series: () => seriesRef.current,
  }));

  return <div ref={containerRef} className="absolute inset-0" role="img" aria-label="Replay price chart (candlesticks); the latest values are summarised above the chart." />;
});

/** Memoised: parent re-renders (legend, clock text) never touch the chart. */
export const ReplayChart = memo(ReplayChartInner);
