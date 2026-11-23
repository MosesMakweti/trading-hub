"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, Loader2, Redo2, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getSimCandlesAction } from "@/actions/simulation.actions";
import { applyRevealed, fromWire, wireToBars } from "@/domain/native-replay/chart-model";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { CHART_TYPES } from "@/domain/indicators/chart-types";
import { buildDisplay, buildStudies, type ScriptState, type StudyRender } from "@/domain/charting/render-model";
import type { ChartConfig, ChartSettings, ChartStudy } from "@/domain/charting/workspace";
import { runScriptInWorker } from "@/components/scripting/run-script";
import { DrawingController } from "@/components/native-replay/drawings/drawing-controller";
import type { ChartDrawing, DrawingType } from "@/domain/native-replay/drawings/model";
import type { DrawingOp } from "@/domain/native-replay/drawings/history";
import { nominalMinutes } from "@/domain/native-replay/timeframes";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { SimRevealedDTO } from "@/types/simulation";
import { notePerf } from "./replay-perf";
import { SimChart, type PriceLineSpec, type SimChartHandle } from "./sim-chart";

/** Chart types whose time axis is price-driven: drawings (anchored in time) can't be placed there. */
export const PRICE_DRIVEN_TYPES = new Set(["renko", "linebreak", "kagi", "pointfigure", "range"]);

export interface SharedDrawings {
  list: ChartDrawing[];
  /** Pane that produced this version (it already shows it), or null for a server load. */
  origin: number | null;
  rev: number;
}

export type DrawingStateEvent = { selected: ChartDrawing | null } | { tool: DrawingType | null } | { list: ChartDrawing[] };

/** Candles per chart: enough warm-up for long indicators, small enough to stay fast. */
const CANDLE_LIMIT = 1500;
/** Incremental steps grow the window; past this it is trimmed back to CANDLE_LIMIT. */
const CANDLE_TRIM_AT = CANDLE_LIMIT + 500;

export interface ScriptSource {
  id: string;
  name: string;
  version: number;
  source: string;
}

export interface ChartPaneHandle {
  sim(): SimChartHandle | null;
  drawings(): DrawingController;
  /**
   * Folds a step's newly revealed M1 bars (fromMinute, toMinute] into this
   * chart's candles — no request. If the chart's candles don't end exactly at
   * fromMinute (still loading, or a different instrument), it reloads its
   * window from the server instead. Returns true when applied in place.
   */
  reveal(revealed: SimRevealedDTO | undefined, fromMinute: number, toMinute: number): boolean;
  /** The instrument this chart shows. */
  symbol(): string;
}

interface Props {
  accountId: string;
  symbol: string;
  config: ChartConfig;
  settings: ChartSettings;
  theme: string | undefined;
  priceDigits: number;
  /** Bumped after every replay step / order: reload candles. */
  refreshKey: number;
  started: boolean;
  active: boolean;
  /** More than one chart is shown (draws the active outline). */
  multi: boolean;
  priceLines: PriceLineSpec[];
  scripts: Map<string, ScriptSource>;
  onActivate: () => void;
  onStudiesChange: (studies: ChartStudy[]) => void;
  onEditStudy: (uid: string, descriptors: ScriptState | null) => void;
  /** Position of this chart in the grid (passed back with sync events). */
  index: number;
  onCrosshair: (index: number, t: number | null) => void;
  onTimeRange: (index: number, range: { from: number; to: number } | null) => void;
  /** Exposes the displayed candles (drawings, legend of other panels). */
  onCandles?: (candles: EngineCandle[]) => void;
  /** Drawings of this chart's instrument (shared by every chart of it). */
  drawings?: SharedDrawings;
  drawingsReadOnly: boolean;
  onDrawingCommit: (index: number, symbol: string, op: DrawingOp, list: ChartDrawing[]) => void;
  onDrawingState: (index: number, event: DrawingStateEvent) => void;
  children?: React.ReactNode;
}

export const ChartPane = forwardRef<ChartPaneHandle, Props>(function ChartPane(props, ref) {
  const { accountId, symbol, config, settings, theme, priceDigits, refreshKey, started, active, multi, priceLines, scripts, onActivate, onStudiesChange, onEditStudy, index, onCrosshair, onTimeRange, onCandles } = props;
  const [candles, setCandles] = useState<EngineCandle[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Bumped to reload the window from the server (a step this chart couldn't fold in). */
  const [reloadNonce, setReloadNonce] = useState(0);
  /** The candles this chart holds and the account clock they reflect. */
  const candlesRef = useRef<EngineCandle[]>([]);
  const clockRef = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [scriptStates, setScriptStates] = useState(new Map<string, ScriptState>());
  const simRef = useRef<SimChartHandle>(null);
  const viewKey = `${symbol}|${config.timeframe}`;
  const viewRef = useRef(viewKey);
  useEffect(() => {
    viewRef.current = viewKey;
  }, [viewKey]);

  // ── Drawings: one controller per chart, anchored in (wall-clock minute, price) ──
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  // Callbacks read the latest props when they fire (never during render).
  const [ctl] = useState(
    // eslint-disable-next-line react-hooks/refs
    () =>
      new DrawingController({
        onSelection: (d) => latest.current.onDrawingState(latest.current.index, { selected: d }),
        onToolChange: (t) => latest.current.onDrawingState(latest.current.index, { tool: t }),
        onListChange: (list) => latest.current.onDrawingState(latest.current.index, { list: [...list] }),
      }),
  );
  const drawable = !PRICE_DRIVEN_TYPES.has(config.chartType);
  useEffect(() => {
    ctl.setCommitHandler((op) => latest.current.onDrawingCommit(latest.current.index, latest.current.symbol, op, [...ctl.getDrawings()]));
  }, [ctl]);
  const onReady = useCallback(
    (chart: IChartApi, series: ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area" | "Baseline" | "Histogram" | "Custom">, el: HTMLElement) => {
      if (!PRICE_DRIVEN_TYPES.has(latest.current.config.chartType)) ctl.attach(chart, series as ISeriesApi<"Candlestick">, el);
    },
    [ctl],
  );
  const onDetach = useCallback(() => ctl.detach(), [ctl]);
  // Candles ↔ Renko etc. keep the same series kind (no onReady): attach/detach here.
  useEffect(() => {
    const sim = simRef.current;
    const chart = sim?.chart();
    const series = sim?.mainSeries();
    const el = sim?.element();
    if (!drawable) ctl.detach();
    else if (chart && series && el) ctl.attach(chart, series as ISeriesApi<"Candlestick">, el);
  }, [ctl, drawable]);
  useEffect(() => () => ctl.detach(), [ctl]);
  const pipSize = (() => {
    const spec = lookupInstrument(symbol);
    return spec?.pipSize ? Number(spec.pipSize) : null;
  })();
  useEffect(() => {
    ctl.setContext({ assetSymbol: symbol, priceScale: priceDigits, pipSize, tfMinutes: nominalMinutes(config.timeframe), dark: theme !== "light", readOnly: props.drawingsReadOnly || !drawable });
  }, [ctl, symbol, priceDigits, pipSize, config.timeframe, theme, props.drawingsReadOnly, drawable]);
  useEffect(() => {
    if (drawable) ctl.setCandles(candles, priceDigits);
  }, [ctl, candles, priceDigits, drawable]);
  const shared = props.drawings;
  useEffect(() => {
    if (shared && shared.origin !== index) ctl.setDrawings(shared.list.filter((d) => d.assetSymbol === symbol));
    else if (!shared) ctl.setDrawings([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shared revision
  }, [ctl, shared?.rev, symbol]);

  useImperativeHandle(ref, () => ({
    sim: () => simRef.current,
    drawings: () => ctl,
    symbol: () => latest.current.symbol,
    reveal(revealed, fromMinute, toMinute) {
      const t0 = performance.now();
      const list = candlesRef.current;
      if (!revealed || revealed.symbol !== latest.current.symbol || !revealed.bars || clockRef.current !== fromMinute || list.length === 0) {
        clockRef.current = null;
        setReloadNonce((n) => n + 1);
        return false;
      }
      // Same pure fold as Native Replay and the server's aggregation (tested equal).
      const next = list.length > CANDLE_TRIM_AT ? list.slice(list.length - CANDLE_LIMIT) : [...list];
      applyRevealed(next, wireToBars(revealed.bars, revealed.priceScale), latest.current.config.timeframe, toMinute);
      candlesRef.current = next;
      clockRef.current = toMinute;
      setCandles(next);
      latest.current.onCandles?.(next);
      notePerf("pane:fold", performance.now() - t0);
      return true;
    },
  }));

  // ── Candles (server-bounded by the account clock: never future bars) ──────
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const key = viewKey;
    clockRef.current = null; // nothing can be folded in until this load lands
    void getSimCandlesAction({ accountId, symbol, timeframe: config.timeframe, limit: CANDLE_LIMIT }).then((res) => {
      if (cancelled || viewRef.current !== key) return;
      setLoadedKey(`${key}|${refreshKey}|${reloadNonce}`);
      if (!res.success) return void toast.error(res.error);
      const list = res.candles.candles.map((c) => fromWire(c, res.candles.priceScale));
      candlesRef.current = list;
      clockRef.current = res.candles.clockMinute;
      setCandles(list);
      onCandles?.(list);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol, config.timeframe, refreshKey, reloadNonce, started]);

  const loading = started && loadedKey !== `${viewKey}|${refreshKey}|${reloadNonce}`;
  const display = useMemo(() => buildDisplay(candles, priceDigits, config.chartType, config.chartParam), [candles, priceDigits, config.chartType, config.chartParam]);

  // ── Scripts: run each in its own sandboxed worker when its inputs change ──
  const scriptStudies = config.studies.filter((s): s is Extract<ChartStudy, { kind: "script" }> => s.kind === "script");
  const scriptRunKey = JSON.stringify(scriptStudies.map((s) => [s.uid, s.scriptId, scripts.get(s.scriptId)?.version ?? 0, s.inputs]));
  const runToken = useRef(0);
  useEffect(() => {
    if (!scriptStudies.length || !display.inputs.length) return;
    const token = ++runToken.current;
    for (const st of scriptStudies) {
      const src = scripts.get(st.scriptId);
      if (!src) continue; // shown as "not available" by the legend
      void runScriptInWorker(src.source, display.inputs, { inputs: st.inputs, lastBarForming: display.lastForming }).then((out) => {
        if (token !== runToken.current) return; // a newer run superseded this one
        setScriptStates((m) => {
          const next = new Map(m);
          if (out.ok) next.set(st.uid, { status: "ok", result: out.result, name: src.name });
          else next.set(st.uid, { status: "error", message: `${out.error.line ? `Line ${out.error.line}: ` : ""}${out.error.message}`, name: src.name });
          return next;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, scriptRunKey]);

  const studies = useMemo(() => buildStudies(display, config, scriptStates, priceDigits), [display, config, scriptStates, priceDigits]);

  const onChartCrosshair = useCallback(
    (i: number | null, t: number | null) => {
      setHover(i);
      onCrosshair(index, t);
    },
    [onCrosshair, index],
  );
  const onChartRange = useCallback((r: { from: number; to: number } | null) => onTimeRange(index, r), [onTimeRange, index]);
  const onFollow = useCallback((f: boolean) => setFollowing(f), []);

  const i = hover ?? display.bars.length - 1;
  const bar = display.bars[i];
  const fmt = (n: number | undefined, digits = priceDigits) => (n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(digits));
  const typeDef = CHART_TYPES.find((t) => t.key === config.chartType)!;

  const setStudy = (uid: string, patch: Partial<ChartStudy> | null) =>
    onStudiesChange(patch === null ? config.studies.filter((s) => s.uid !== uid) : config.studies.map((s) => (s.uid === uid ? ({ ...s, ...patch } as ChartStudy) : s)));

  return (
    <div
      className={cn("relative h-full min-h-0 min-w-0", multi && "outline-1 -outline-offset-1", multi && (active ? "outline-primary/60" : "outline-border"))}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      aria-label={`${symbol} ${config.timeframe} chart${active ? " (active)" : ""}`}
    >
      {started && settings.showLegend && (
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 max-w-[calc(100%-5rem)] space-y-0.5 font-mono text-[11px] tabular-nums">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="font-sans text-xs font-semibold">
              {symbol} · {config.timeframe}
              {config.chartType !== "candles" && <span className="font-normal text-muted-foreground"> · {typeDef.label}</span>}
            </span>
            {bar && (
              <>
                <span>O {fmt(bar.open)}</span>
                <span>H {fmt(bar.high)}</span>
                <span>L {fmt(bar.low)}</span>
                <span>C {fmt(bar.close)}</span>
                {bar.volume != null && <span className="text-muted-foreground">Tick vol {bar.volume}</span>}
                {i === display.bars.length - 1 && display.lastForming && <span className="font-sans text-muted-foreground">forming</span>}
              </>
            )}
            {loading && <Loader2 className="size-3 animate-spin self-center text-muted-foreground" aria-label="Loading candles" />}
          </div>
          {display.synthetic && (
            <p className="font-sans text-[10px] text-amber-500/90">
              {typeDef.label} values are calculated, not market prices{config.chartType !== "heikinashi" ? "; the time axis is price-driven" : ""}. Indicators use these values.
            </p>
          )}
          {studies.map((st) => (
            <StudyLegendRow key={st.uid} study={st} index={i} onToggle={() => setStudy(st.uid, { visible: !st.visible })} onRemove={() => setStudy(st.uid, null)} onEdit={() => onEditStudy(st.uid, scriptStates.get(st.uid) ?? null)} />
          ))}
        </div>
      )}
      <SimChart
        ref={simRef}
        theme={theme}
        priceDigits={priceDigits}
        chartType={config.chartType}
        display={display}
        studies={studies}
        settings={settings}
        priceLines={display.synthetic && config.chartType !== "heikinashi" ? [] : priceLines}
        fitKey={`${viewKey}|${config.chartType}|${config.chartParam}`}
        onCrosshair={onChartCrosshair}
        onTimeRange={onChartRange}
        onFollowChange={onFollow}
        onReady={onReady}
        onDetach={onDetach}
      />
      {props.children}
      {!following && started && (
        <Button type="button" size="sm" variant="secondary" className="absolute bottom-4 right-16 z-20 shadow" onClick={() => simRef.current?.scrollToLatest()} title="Return to the replay position (R)">
          <Redo2 /> Return to replay
        </Button>
      )}
    </div>
  );
});

function StudyLegendRow({ study, index, onToggle, onRemove, onEdit }: { study: StudyRender; index: number; onToggle: () => void; onRemove: () => void; onEdit: () => void }) {
  const digits = study.digits;
  return (
    <div className="group pointer-events-auto flex w-fit max-w-full items-center gap-1.5 rounded px-1 -mx-1 hover:bg-background/80">
      <span className={cn("font-sans", !study.visible && "text-muted-foreground line-through")}>
        {study.name}
        {study.params && <span className="text-muted-foreground"> {study.params}</span>}
        {study.kind === "script" && <span className="ml-1 rounded border border-border px-1 text-[9px] uppercase text-muted-foreground">script</span>}
      </span>
      {study.error ? (
        <span className="flex items-center gap-1 font-sans text-red-400" title={study.error}>
          <AlertTriangle className="size-3" /> <span className="max-w-64 truncate">{study.error}</span>
        </span>
      ) : (
        study.visible &&
        study.plots.slice(0, 6).map((p) => (
          <span key={p.key} style={{ color: p.colors?.[index] ?? p.color }}>
            {Number.isFinite(p.values[index]) ? p.values[index].toFixed(digits) : "—"}
          </span>
        ))
      )}
      <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" onClick={onToggle} className="rounded p-0.5 hover:bg-muted" aria-label={study.visible ? `Hide ${study.name}` : `Show ${study.name}`}>
          {study.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
        <button type="button" onClick={onEdit} className="rounded p-0.5 hover:bg-muted" aria-label={`${study.name} settings`}>
          <Settings2 className="size-3" />
        </button>
        <button type="button" onClick={onRemove} className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${study.name}`}>
          <X className="size-3" />
        </button>
      </span>
    </div>
  );
}
