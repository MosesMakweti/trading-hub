"use client";

import { useEffect, useRef } from "react";
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

/**
 * The first real Replay candlestick chart (Stage 13 §18), extended in Stage
 * 14 §9/§31 with simulated-position price lines + fill/partial/close
 * markers. Purely presentational: it renders EXACTLY the `candles`/
 * `priceLines`/`markers` it's given — never a real Trade's levels, never
 * anything beyond what the caller (which itself only ever sees
 * `ReplayPositionState`, not a real Trade) already knows.
 */
export function ReplayCandlestickChart({
  candles,
  currentTime,
  priceLines = [],
  markers = [],
  height = 420,
}: {
  candles: Candle[];
  /** UTC ms — rendered as a vertical "now" marker on the time scale. */
  currentTime: number;
  priceLines?: ReplayPriceLine[];
  markers?: ReplayChartMarker[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "var(--muted-foreground)",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "color-mix(in oklch, var(--border) 60%, transparent)" },
        horzLines: { color: "color-mix(in oklch, var(--border) 60%, transparent)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "var(--border)" },
      rightPriceScale: { borderColor: "var(--border)" },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "var(--success)",
      downColor: "var(--danger)",
      borderVisible: false,
      wickUpColor: "var(--success)",
      wickDownColor: "var(--danger)",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersPluginRef.current = createSeriesMarkers(series, []);
    const priceLines = priceLinesRef.current;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLines.clear();
      markersPluginRef.current = null;
    };
    // Chart instance is created once per mount; data updates flow through the effect below.
  }, []);

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
  }, [candles, currentTime]);

  // Replay position price lines (entry/SL/targets) — reconciled by id so a
  // line that's still present just gets its price/title updated in place,
  // rather than flicker-removed and recreated every render.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const existing = priceLinesRef.current;
    const nextIds = new Set(priceLines.map((l) => l.id));

    for (const [id, line] of existing) {
      if (!nextIds.has(id)) {
        series.removePriceLine(line);
        existing.delete(id);
      }
    }
    for (const spec of priceLines) {
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
  }, [priceLines]);

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

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
