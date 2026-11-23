"use client";

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { chartsFor, type ChartStudy, type Workspace } from "@/domain/charting/workspace";
import type { ScriptState } from "@/domain/charting/render-model";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import type { DrawingOp } from "@/domain/native-replay/drawings/history";
import { ChartPane, type ChartPaneHandle, type DrawingStateEvent, type ScriptSource, type SharedDrawings } from "./chart-pane";
import type { PriceLineSpec } from "./sim-chart";

const GRID: Record<Workspace["layout"], string> = {
  "1": "grid-cols-1 grid-rows-1",
  "2h": "grid-cols-2 grid-rows-1 max-md:grid-cols-1 max-md:grid-rows-2",
  "2v": "grid-cols-1 grid-rows-2",
  "3": "grid-cols-2 grid-rows-2",
  "4": "grid-cols-2 grid-rows-2",
};

interface Props {
  ws: Workspace;
  accountId: string;
  defaultSymbol: string;
  digitsFor: (symbol: string) => number;
  priceLinesFor: (symbol: string) => PriceLineSpec[];
  theme: string | undefined;
  refreshKey: number;
  asOf: number | null;
  sessionOverlay?: import("./chart-pane").ChartPaneProps["sessionOverlay"];
  started: boolean;
  scripts: Map<string, ScriptSource>;
  onActivate: (index: number) => void;
  onStudiesChange: (index: number, studies: ChartStudy[]) => void;
  onEditStudy: (index: number, uid: string, script: ScriptState | null) => void;
  /** Candles of the active chart (for drawings). */
  onActiveCandles?: (candles: EngineCandle[]) => void;
  paneRefs: React.RefObject<(ChartPaneHandle | null)[]>;
  drawingsBySymbol: Map<string, SharedDrawings>;
  drawingsReadOnly: boolean;
  onDrawingCommit: (index: number, symbol: string, op: DrawingOp, list: ChartDrawing[]) => void;
  onDrawingState: (index: number, event: DrawingStateEvent) => void;
  overlay?: (index: number) => React.ReactNode;
}

/**
 * 1–4 charts of the same account. Each chart has its own instrument,
 * interval, type and studies; crosshair and visible time can be synced.
 * Every chart is bounded by the same account clock — none can show bars the
 * account hasn't reached.
 */
export function ChartGrid(props: Props) {
  const { ws, accountId, defaultSymbol, digitsFor, priceLinesFor, theme, refreshKey, asOf, sessionOverlay, started, scripts, onActivate, onStudiesChange, onEditStudy, onActiveCandles, paneRefs, overlay, drawingsBySymbol, drawingsReadOnly, onDrawingCommit, onDrawingState } = props;
  const n = chartsFor(ws.layout);
  const syncRef = useRef(ws.sync);
  useEffect(() => {
    syncRef.current = ws.sync;
  }, [ws.sync]);

  const crosshair = useCallback(
    (from: number, t: number | null) => {
      if (!syncRef.current.crosshair) return;
      paneRefs.current.forEach((p, i) => i !== from && p?.sim()?.syncCrosshair(t));
    },
    [paneRefs],
  );
  const timeRange = useCallback(
    (from: number, range: { from: number; to: number } | null) => {
      if (!syncRef.current.time) return;
      paneRefs.current.forEach((p, i) => i !== from && p?.sim()?.syncTimeRange(range));
    },
    [paneRefs],
  );

  return (
    <div className={cn("grid h-full min-h-0 gap-px bg-border", GRID[ws.layout])}>
      {ws.charts.slice(0, n).map((c, i) => {
        const symbol = c.symbol ?? defaultSymbol;
        return (
          <div key={i} className={cn("relative min-h-0 min-w-0 bg-background", ws.layout === "3" && i === 0 && "row-span-2")}>
            <ChartPane
              ref={(h) => {
                paneRefs.current[i] = h;
              }}
              accountId={accountId}
              symbol={symbol}
              config={c}
              settings={ws.settings}
              theme={theme}
              priceDigits={digitsFor(symbol)}
              refreshKey={refreshKey}
              asOf={asOf}
              sessionOverlay={sessionOverlay}
              started={started}
              active={i === ws.activeChart}
              multi={n > 1}
              priceLines={priceLinesFor(symbol)}
              scripts={scripts}
              onActivate={() => i !== ws.activeChart && onActivate(i)}
              onStudiesChange={(s) => onStudiesChange(i, s)}
              onEditStudy={(uid, st) => onEditStudy(i, uid, st)}
              index={i}
              onCrosshair={crosshair}
              onTimeRange={timeRange}
              onCandles={i === ws.activeChart ? onActiveCandles : undefined}
              drawings={drawingsBySymbol.get(symbol)}
              drawingsReadOnly={drawingsReadOnly}
              onDrawingCommit={onDrawingCommit}
              onDrawingState={onDrawingState}
            >
              {overlay?.(i)}
            </ChartPane>
          </div>
        );
      })}
    </div>
  );
}
