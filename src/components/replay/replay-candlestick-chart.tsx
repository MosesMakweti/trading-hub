"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@/domain/market-data/candle";
import { REPLAY_CHART_COLORS_DARK, getReplayChartColors, type ReplayChartColors } from "@/components/replay/replay-chart-colors";
import { assertLightweightChartSafeColors } from "@/components/replay/chart-color-safety";

/** One Replay position price line (Stage 14 §9, §31) — entry/SL/target(s).
 *  Deliberately a distinct type from anything real-Trade-shaped: this chart
 *  must never be capable of rendering a real Trade's price levels. */
export interface ReplayPriceLine {
  id: string;
  price: number;
  color: string;
  title: string;
  lineStyle?: 0 | 1 | 2 | 3 | 4; // lightweight-charts LineStyle (0 = solid, 2 = dashed, ...)
}

export interface ReplayChartMarker {
  time: number; // UTC ms
  color: string;
  shape: "circle" | "arrowUp" | "arrowDown" | "square";
  text?: string;
  position?: "aboveBar" | "belowBar" | "inBar";
}

/** A point in a two-point drawing — UTC ms + price, the same units
 *  everywhere else in Replay uses (never a screen pixel). */
export interface AnnotationPoint {
  time: number;
  price: number;
}

/** Stage 18 §15/§18 — the two shapes that need custom canvas rendering
 *  (lightweight-charts has no native trend-line/rectangle primitive).
 *  HORIZONTAL_LINE annotations are rendered through the exact same
 *  `IPriceLine` mechanism as `priceLines` (see `drawingLines` below) —
 *  they need no canvas work at all. */
export interface ReplayAnnotationShape {
  id: string;
  type: "TREND_LINE" | "RECTANGLE" | "TEXT";
  p1: AnnotationPoint;
  p2?: AnnotationPoint; // TEXT has no p2
  text?: string | null;
  selected?: boolean;
}

/**
 * The first real Replay candlestick chart (Stage 13 §18), extended in Stage
 * 14 §9/§31 with simulated-position price lines + fill/partial/close
 * markers, and in Stage 18 §12/§15 with click-to-select-price and a minimal
 * drawing/annotation overlay. Purely presentational: it renders EXACTLY the
 * `candles`/`priceLines`/`markers`/`annotationShapes` it's given — never a
 * real Trade's levels, never anything beyond what the caller already knows.
 */
export function ReplayCandlestickChart({
  candles,
  currentTime,
  priceLines = [],
  drawingLines = [],
  markers = [],
  annotationShapes = [],
  height = 420,
  onChartClick,
}: {
  candles: Candle[];
  /** UTC ms — rendered as a vertical "now" marker on the time scale. */
  currentTime: number;
  priceLines?: ReplayPriceLine[];
  /** HORIZONTAL_LINE drawings — same rendering mechanism as `priceLines`
   *  but kept as a separate prop so plan/position lines and free-hand
   *  drawings never get confused with each other by the caller. */
  drawingLines?: ReplayPriceLine[];
  markers?: ReplayChartMarker[];
  annotationShapes?: ReplayAnnotationShape[];
  height?: number;
  /** Stage 18 §12 — fires on every chart click with the clicked bar's UTC
   *  ms time and the y-coordinate's price. The caller decides what a click
   *  means (nothing, price-selection, drawing-tool point capture) — this
   *  component has no concept of "modes." */
  onChartClick?: (point: AnnotationPoint) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const drawingLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const shapesRef = useRef<ReplayAnnotationShape[]>(annotationShapes);
  const onChartClickRef = useRef(onChartClick);
  // An explicit, static, lightweight-charts-safe palette (never a
  // dynamically-resolved CSS color — see `replay-chart-colors.ts`'s own
  // doc comment for why runtime CSS-variable/canvas-serialization
  // resolution proved unreliable across browsers, specifically Safari).
  // Starts at the dark palette (the app's `defaultTheme`) so a value
  // always exists for the very first synchronous paint frame; the mount
  // effect below replaces it with the theme-correct palette immediately.
  const colorsRef = useRef<ReplayChartColors>(REPLAY_CHART_COLORS_DARK);
  const { resolvedTheme } = useTheme();

  // Keep both refs in sync with the latest props — read by imperative
  // chart-event callbacks below, never during render (refs must only be
  // written/read outside render).
  useEffect(() => {
    onChartClickRef.current = onChartClick;
    shapesRef.current = annotationShapes;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = getReplayChartColors(resolvedTheme);
    assertLightweightChartSafeColors(colors);
    colorsRef.current = colors;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: colors.textColor,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.gridColor },
        horzLines: { color: colors.gridColor },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.borderColor },
      rightPriceScale: { borderColor: colors.borderColor },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderVisible: false,
      wickUpColor: colors.upColor,
      wickDownColor: colors.downColor,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersPluginRef.current = createSeriesMarkers(series, []);
    const priceLines = priceLinesRef.current;
    const drawingLines = drawingLinesRef.current;

    const redraw = () => drawAnnotationShapes(canvasRef.current, chart, series, shapesRef.current, colorsRef.current);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    chart.subscribeCrosshairMove(redraw); // cheap, but keeps shapes in sync during a hover/drag without a separate render loop

    const clickHandler = (param: Parameters<Parameters<IChartApi["subscribeClick"]>[0]>[0]) => {
      const callback = onChartClickRef.current;
      if (!callback || !param.point || param.time == null) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      callback({ time: (param.time as number) * 1000, price });
    };
    chart.subscribeClick(clickHandler);

    const resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      chart.unsubscribeCrosshairMove(redraw);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLines.clear();
      drawingLines.clear();
      markersPluginRef.current = null;
    };
    // Chart instance is created once per mount; data updates flow through the
    // effects below. `resolvedTheme` is read once here for the initial paint
    // only — the dedicated theme effect right below applies any subsequent
    // change via `applyOptions`, so intentionally NOT a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme reactivity (dark <-> light) — re-resolves colors and applies them
  // to the EXISTING chart/series via `applyOptions` rather than recreating
  // the chart. Runs on mount too (harmless — re-applies the same colors the
  // creation effect above already set) and on every subsequent theme change.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const colors = getReplayChartColors(resolvedTheme);
    assertLightweightChartSafeColors(colors);
    colorsRef.current = colors;
    chart.applyOptions({
      layout: { textColor: colors.textColor },
      grid: { vertLines: { color: colors.gridColor }, horzLines: { color: colors.gridColor } },
      timeScale: { borderColor: colors.borderColor },
      rightPriceScale: { borderColor: colors.borderColor },
    });
    series.applyOptions({ upColor: colors.upColor, downColor: colors.downColor, wickUpColor: colors.upColor, wickDownColor: colors.downColor });
    drawAnnotationShapes(canvasRef.current, chart, series, shapesRef.current, colors);
  }, [resolvedTheme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    if (currentTime) {
      chartRef.current?.timeScale().scrollToPosition(2, false);
    }
    drawAnnotationShapes(canvasRef.current, chartRef.current, seriesRef.current, shapesRef.current, colorsRef.current);
  }, [candles, currentTime]);

  // Replay position price lines (entry/SL/targets) — reconciled by id so a
  // line that's still present just gets its price/title updated in place,
  // rather than flicker-removed and recreated every render.
  useEffect(() => {
    reconcilePriceLines(seriesRef.current, priceLinesRef.current, priceLines);
  }, [priceLines]);

  // Free-hand HORIZONTAL_LINE drawings — same reconciliation, separate map
  // so they're never confused with plan/position lines when either list changes.
  useEffect(() => {
    reconcilePriceLines(seriesRef.current, drawingLinesRef.current, drawingLines);
  }, [drawingLines]);

  useEffect(() => {
    markersPluginRef.current?.setMarkers(
      markers
        .map(
          (m): SeriesMarker<Time> => ({
            time: Math.floor(m.time / 1000) as UTCTimestamp,
            color: m.color,
            shape: m.shape,
            text: m.text,
            position: m.position ?? "inBar",
          }),
        )
        .sort((a, b) => (a.time as number) - (b.time as number)),
    );
  }, [markers]);

  useEffect(() => {
    drawAnnotationShapes(canvasRef.current, chartRef.current, seriesRef.current, annotationShapes, colorsRef.current);
  }, [annotationShapes]);

  return (
    <div ref={containerRef} style={{ height }} className="relative w-full">
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}

function reconcilePriceLines(series: ISeriesApi<"Candlestick"> | null, existing: Map<string, IPriceLine>, next: ReplayPriceLine[]) {
  if (!series) return;
  const nextIds = new Set(next.map((l) => l.id));
  for (const [id, line] of existing) {
    if (!nextIds.has(id)) {
      series.removePriceLine(line);
      existing.delete(id);
    }
  }
  for (const spec of next) {
    const current = existing.get(spec.id);
    if (current) {
      current.applyOptions({ price: spec.price, color: spec.color, title: spec.title, lineStyle: spec.lineStyle ?? 2 });
    } else {
      existing.set(
        spec.id,
        series.createPriceLine({
          price: spec.price,
          color: spec.color,
          lineWidth: 1,
          lineStyle: spec.lineStyle ?? 2,
          axisLabelVisible: true,
          title: spec.title,
        }),
      );
    }
  }
}

/**
 * Stage 18 §15 — the minimal drawing layer. TREND_LINE/RECTANGLE/TEXT have
 * no native lightweight-charts primitive, so they're drawn on a plain
 * absolutely-positioned `<canvas>` sized to the chart container, converting
 * each point's (time, price) to a pixel (x, y) via the chart's own
 * coordinate APIs on every redraw — never a custom drawing ENGINE (no
 * hit-testing, no dragging, no persistence logic lives here; this function
 * only paints). `pointer-events-none` on the canvas keeps chart
 * interaction (pan/zoom/click) working exactly as before underneath it.
 */
function drawAnnotationShapes(
  canvas: HTMLCanvasElement | null,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  shapes: ReplayAnnotationShape[],
  colors: ReplayChartColors,
) {
  if (!canvas || !chart || !series) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const toXY = (p: AnnotationPoint): { x: number; y: number } | null => {
    const x = chart.timeScale().timeToCoordinate((Math.floor(p.time / 1000) as UTCTimestamp) as Time);
    const y = series.priceToCoordinate(p.price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  for (const shape of shapes) {
    const a = toXY(shape.p1);
    const b = shape.p2 ? toXY(shape.p2) : null;
    const color = shape.selected ? colors.selectedShapeColor : colors.unselectedShapeColor;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = shape.selected ? 2 : 1;

    if (shape.type === "TREND_LINE" && a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (shape.type === "RECTANGLE" && a && b) {
      ctx.fillStyle = colors.rectangleFillColor;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (shape.type === "TEXT" && a && shape.text) {
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(shape.text, a.x + 4, a.y - 4);
    }
  }
}
