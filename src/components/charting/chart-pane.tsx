"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, Loader2, Redo2, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getSimCandlesAction } from "@/actions/simulation.actions";
import { fromWire } from "@/domain/native-replay/chart-model";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { CHART_TYPES } from "@/domain/indicators/chart-types";
import { buildDisplay, buildStudies, type ScriptState, type StudyRender } from "@/domain/charting/render-model";
import type { ChartConfig, ChartSettings, ChartStudy } from "@/domain/charting/workspace";
import { runScriptInWorker } from "@/components/scripting/run-script";
import { SimChart, type PriceLineSpec, type SimChartHandle } from "./sim-chart";

/** Candles per chart: enough warm-up for long indicators, small enough to stay fast. */
const CANDLE_LIMIT = 1500;

export interface ScriptSource {
  id: string;
  name: string;
  version: number;
  source: string;
}

export interface ChartPaneHandle {
  sim(): SimChartHandle | null;
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
  children?: React.ReactNode;
}

export const ChartPane = forwardRef<ChartPaneHandle, Props>(function ChartPane(props, ref) {
  const { accountId, symbol, config, settings, theme, priceDigits, refreshKey, started, active, multi, priceLines, scripts, onActivate, onStudiesChange, onEditStudy, index, onCrosshair, onTimeRange, onCandles } = props;
  const [candles, setCandles] = useState<EngineCandle[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [scriptStates, setScriptStates] = useState(new Map<string, ScriptState>());
  const simRef = useRef<SimChartHandle>(null);
  const viewKey = `${symbol}|${config.timeframe}`;
  const viewRef = useRef(viewKey);
  useEffect(() => {
    viewRef.current = viewKey;
  }, [viewKey]);

  useImperativeHandle(ref, () => ({ sim: () => simRef.current }));

  // ── Candles (server-bounded by the account clock: never future bars) ──────
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const key = viewKey;
    void getSimCandlesAction({ accountId, symbol, timeframe: config.timeframe, limit: CANDLE_LIMIT }).then((res) => {
      if (cancelled || viewRef.current !== key) return;
      setLoadedKey(`${key}|${refreshKey}`);
      if (!res.success) return void toast.error(res.error);
      const list = res.candles.candles.map((c) => fromWire(c, res.candles.priceScale));
      setCandles(list);
      onCandles?.(list);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, symbol, config.timeframe, refreshKey, started]);

  const loading = started && loadedKey !== `${viewKey}|${refreshKey}`;
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
