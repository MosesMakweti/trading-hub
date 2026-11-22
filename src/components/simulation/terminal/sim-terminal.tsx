"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowLeft, FastForward, LineChart, Loader2, Minimize2, Pause, Play, SkipForward, Star, StepForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/backtesting/button-link";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { advanceSimClockAction, getSimAccountStateAction, startSimClockAction } from "@/actions/simulation.actions";
import { getScriptSourcesAction } from "@/actions/charting.actions";
import { applyToCharts, chartsFor, normalizeWorkspace, type ChartStudy, type Workspace } from "@/domain/charting/workspace";
import type { ScriptState } from "@/domain/charting/render-model";
import { INDICATOR_BY_ID, sanitizeInputs } from "@/domain/indicators/catalog";
import { ChartGrid } from "@/components/charting/chart-grid";
import type { ChartPaneHandle, ScriptSource } from "@/components/charting/chart-pane";
import type { PriceLineSpec } from "@/components/charting/sim-chart";
import { ChartSettingsMenu, ChartTypeMenu, LayoutMenu } from "@/components/charting/chart-menus";
import { IndicatorPicker } from "@/components/charting/indicator-picker";
import { StudySettings } from "@/components/charting/study-settings";
import { ResizeHandle } from "@/components/charting/resize-handle";
import { useWorkspace } from "@/components/charting/use-workspace";
import type { SimAccountStateDTO } from "@/types/simulation";
import { fmtMoney, fmtWallClock, pnlTone } from "../format";
import { OrderTicket } from "./order-ticket";
import { TradeDock } from "./trade-dock";
import { QuickObservation, type StudyOption } from "../studies/quick-observation";
import { PropRulesPanel } from "../prop/prop-rules-panel";

const NO_LINES: PriceLineSpec[] = [];
const SPEEDS = [1, 5, 15, 60] as const;
type Speed = (typeof SPEEDS)[number];
type Command = { kind: "BARS"; count: number } | { kind: "CANDLE"; timeframe: ReplayTimeframe } | { kind: "SEEK"; to: number } | { kind: "NEXT_DAY" };

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-500",
  CREATED: "border-border text-muted-foreground",
  BREACHED: "border-red-400/50 text-red-400",
  FAILED: "border-red-400/50 text-red-400",
  PASSED: "border-sky-400/50 text-sky-400",
  COMPLETED: "border-sky-400/50 text-sky-400",
};

/**
 * The shared trading terminal (Strategy Lab and Prop Firm Simulator).
 *
 * Server wins: the chart, quotes, positions and money are re-read from the
 * server's reply after every replay step and every order — nothing is
 * computed or advanced optimistically in the browser, and charts only ever
 * hold candles up to the account's clock.
 *
 * Around that core sits the chart workspace (persisted per user): 1–4 charts
 * with their own instrument, interval, chart type and studies; resizable /
 * collapsible panels; focus mode; presets. None of it affects trading.
 */
export function SimTerminal({ initialState, initialWorkspace, backHref, studies, resultsHref }: { initialState: SimAccountStateDTO; initialWorkspace: Workspace; backHref: string; studies?: StudyOption[]; resultsHref?: string }) {
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState(initialState);
  const [ws, updateWs] = useWorkspace(initialWorkspace);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [jumpTo, setJumpTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<{ chart: number; uid: string; script: ScriptState | null } | null>(null);
  const [scriptSources, setScriptSources] = useState(new Map<string, ScriptSource>());
  // Live sizes while dragging (committed to the workspace on release).
  const [rightWidth, setRightWidth] = useState(ws.panels.right.width);
  const [bottomHeight, setBottomHeight] = useState(ws.panels.bottom.height);
  const paneRefs = useRef<(ChartPaneHandle | null)[]>([]);
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);

  const active = ws.charts[Math.min(ws.activeChart, chartsFor(ws.layout) - 1)] ?? ws.charts[0];
  const symbol = active.symbol && state.assets.includes(active.symbol) ? active.symbol : state.assets[0];
  const timeframe = active.timeframe;
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const quote = state.quotes.find((q) => q.symbol === symbol);
  const started = state.clock != null;
  const tradable = started && state.status === "ACTIVE";
  const canMove = tradable && !state.clock?.atPeriodEnd;
  const focus = ws.focus;

  // ── Workspace helpers ─────────────────────────────────────────────────────
  const patchChart = useCallback((index: number, patch: Partial<Workspace["charts"][number]>) => updateWs((w) => ({ ...w, charts: w.charts.map((c, i) => (i === index ? { ...c, ...patch } : c)) })), [updateWs]);
  const setActive = useCallback((i: number) => updateWs((w) => ({ ...w, activeChart: i })), [updateWs]);
  const setStudies = useCallback((i: number, list: ChartStudy[]) => patchChart(i, { studies: list }), [patchChart]);
  const onEditStudy = useCallback((chart: number, uid: string, script: ScriptState | null) => setEditing({ chart, uid, script }), []);

  // ── Script sources for every script study on screen ───────────────────────
  const scriptIds = useMemo(() => [...new Set(ws.charts.flatMap((c) => c.studies.flatMap((s) => (s.kind === "script" ? [s.scriptId] : []))))].sort(), [ws.charts]);
  const scriptKey = scriptIds.join(",");
  useEffect(() => {
    if (scriptIds.length) void getScriptSourcesAction({ ids: scriptIds }).then((res) => res.success && setScriptSources(new Map(res.scripts.map((s) => [s.id, s]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptKey]);

  // ── Account price lines (entries, SL/TP, pending orders) per instrument ──
  const linesBySymbol = useMemo(() => {
    const m = new Map<string, PriceLineSpec[]>();
    const add = (sym: string, price: string | null, color: string, title: string, style: PriceLineSpec["style"] = "solid") => {
      if (price == null) return;
      m.set(sym, [...(m.get(sym) ?? []), { price: Number(price), color, title, style }]);
    };
    for (const p of state.positions) {
      add(p.symbol, p.entryPrice, "#94a3b8", `${p.side === "BUY" ? "Buy" : "Sell"} ${p.remainingQuantity}`);
      add(p.symbol, p.stopLoss, "#f87171", "SL", "dashed");
      add(p.symbol, p.takeProfit, "#34d399", "TP", "dashed");
    }
    for (const o of state.orders) add(o.symbol, o.price, "#fbbf24", `${o.side === "BUY" ? "Buy" : "Sell"} ${o.type.toLowerCase()} ${o.quantity}`, "dotted");
    return m;
  }, [state.positions, state.orders]);
  const priceLinesFor = useCallback((sym: string) => linesBySymbol.get(sym) ?? NO_LINES, [linesBySymbol]);
  const digitsFor = useCallback((sym: string) => state.quotes.find((q) => q.symbol === sym)?.priceScale ?? 5, [state.quotes]);

  // ── Replay ────────────────────────────────────────────────────────────────
  const run = useCallback(
    async (command: Command): Promise<boolean> => {
      const res = await advanceSimClockAction({ accountId: state.id, command, commandId: crypto.randomUUID() });
      if (!res.success) {
        toast.error(res.error);
        return false;
      }
      setState(res.state);
      if (res.outcome.halted) {
        const msg = { PASSED: "Phase passed — the next stage is ready in the challenge history.", BREACHED: `Breached: ${res.state.statusReason ?? "a rule was broken"}`, FAILED: res.state.statusReason ?? "Phase failed." }[res.state.status as "PASSED" | "BREACHED" | "FAILED"];
        if (msg) (res.state.status === "PASSED" ? toast.success : toast.error)(msg, { duration: 8000 });
      }
      if (res.outcome.filledOrders > 0) toast.message(`${res.outcome.filledOrders} order${res.outcome.filledOrders === 1 ? "" : "s"} filled`);
      if (res.outcome.closedPositions > 0) toast.message(`${res.outcome.closedPositions} position${res.outcome.closedPositions === 1 ? "" : "s"} closed`);
      if (res.outcome.moved) setRefreshKey((k) => k + 1);
      return res.outcome.moved && res.state.status === "ACTIVE" && !res.state.clock?.atPeriodEnd;
    },
    [state.id],
  );

  const step = async (command: Command) => {
    if (busy || playingRef.current) return;
    setBusy(true);
    await run(command);
    setBusy(false);
  };

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    while (playingRef.current) {
      const t0 = performance.now();
      const more = await run({ kind: "BARS", count: speedRef.current });
      if (!more) break;
      const wait = 700 - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    playingRef.current = false;
    setPlaying(false);
  }, [run]);

  useEffect(() => () => void (playingRef.current = false), []);

  const refreshState = useCallback(async () => {
    const res = await getSimAccountStateAction({ accountId: state.id });
    if (res.success) setState(res.state);
  }, [state.id]);

  const start = async () => {
    setBusy(true);
    const res = await startSimClockAction({ accountId: state.id });
    setBusy(false);
    if (!res.success) return toast.error(res.error);
    setState(res.state);
  };

  const toggleFocus = useCallback(() => updateWs((w) => ({ ...w, focus: !w.focus })), [updateWs]);

  // Keyboard: Space play/pause · → +1m · Shift+→ +1 candle · R return to replay · Shift+F focus · Esc leave focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.closest("[data-sim-side]") || t.closest(".cm-editor"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (playingRef.current) pause();
        else if (canMove) void play();
      } else if (e.key === "ArrowRight" && canMove) {
        e.preventDefault();
        void step(e.shiftKey ? { kind: "CANDLE", timeframe: timeframeRef.current } : { kind: "BARS", count: 1 });
      } else if (e.key === "r" || e.key === "R") {
        paneRefs.current.forEach((p) => p?.sim()?.scrollToLatest());
      } else if (e.key === "F" && e.shiftKey) {
        e.preventDefault();
        toggleFocus();
      } else if (e.key === "Escape" && focus) {
        toggleFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const money = state.money;
  const strip = useMemo(
    () => [
      { label: "Balance", value: fmtMoney(money.balance, state.currency) },
      { label: "Equity", value: fmtMoney(money.equity, state.currency) },
      { label: "Floating", value: fmtMoney(money.floatingPnl, state.currency, { sign: true }), tone: pnlTone(money.floatingPnl) },
      { label: "Realized", value: fmtMoney(money.realizedPnl, state.currency, { sign: true }), tone: pnlTone(money.realizedPnl) },
      { label: "Costs", value: fmtMoney(Number(money.commissions) + Number(money.swaps), state.currency) },
    ],
    [money, state.currency],
  );

  const editingStudy = editing ? (ws.charts[editing.chart]?.studies.find((s) => s.uid === editing.uid) ?? null) : null;
  const showRight = ws.panels.right.visible && !focus;
  const showBottom = ws.panels.bottom.visible && !focus;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
        {!focus && (
          <>
            <ButtonLink href={backHref} size="icon-sm" variant="ghost" aria-label="Back">
              <ArrowLeft />
            </ButtonLink>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold">{state.name}</h1>
                <span className={cn("rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider", STATUS_TONE[state.status] ?? "border-border text-muted-foreground")}>{state.status.toLowerCase()}</span>
              </div>
              <p className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtWallClock(state.period.start)} → {fmtWallClock(state.period.end)} · server time</p>
            </div>
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
          </>
        )}
        {/* Active chart controls */}
        {state.assets.length > 1 ? (
          <select aria-label="Instrument (active chart)" value={symbol} onChange={(e) => updateWs((w) => applyToCharts(w, w.activeChart, { symbol: e.target.value }))} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-medium">
            {state.assets.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : (
          <span className="text-xs font-medium">{symbol}</span>
        )}
        <div role="group" aria-label="Interval (active chart)" className="flex items-center rounded-md border border-border">
          {ws.favoriteTimeframes.map((tf) => (
            <button key={tf} type="button" aria-pressed={timeframe === tf} onClick={() => updateWs((w) => applyToCharts(w, w.activeChart, { timeframe: tf }))} className={cn("h-6 px-1.5 font-mono text-[11px] first:rounded-l-md", timeframe === tf ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {tf}
            </button>
          ))}
          <TimeframeMore current={timeframe} favorites={ws.favoriteTimeframes} onPick={(tf) => updateWs((w) => applyToCharts(w, w.activeChart, { timeframe: tf }))} onToggleFavorite={(tf) => updateWs((w) => ({ ...w, favoriteTimeframes: w.favoriteTimeframes.includes(tf) ? w.favoriteTimeframes.filter((x) => x !== tf) : REPLAY_TIMEFRAMES.filter((x) => x === tf || w.favoriteTimeframes.includes(x)).slice(0, 16) }))} />
        </div>
        <ChartTypeMenu key={`${ws.activeChart}-${active.chartType}`} value={active.chartType} param={active.chartParam} onChange={(chartType, chartParam) => patchChart(ws.activeChart, { chartType, chartParam })} />
        <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted" aria-label="Indicators and scripts">
          <LineChart className="size-3.5" /> <span className="max-sm:hidden">Indicators</span>
        </button>
        <ChartSettingsMenu settings={ws.settings} onChange={(settings) => updateWs((w) => ({ ...w, settings }))} />
        <LayoutMenu
          ws={ws}
          onLayout={(layout) => updateWs((w) => normalizeWorkspace({ ...w, layout }))}
          onSync={(k, v) => updateWs((w) => ({ ...w, sync: { ...w.sync, [k]: v } }))}
          onPanels={(panels) => updateWs((w) => ({ ...w, panels }))}
          onFocus={toggleFocus}
          onApplyPreset={(p) => {
            setRightWidth(p.panels.right.width);
            setBottomHeight(p.panels.bottom.height);
            updateWs((w) => normalizeWorkspace({ ...w, panels: p.panels, layout: p.layout, focus: false }));
          }}
          onSavePreset={(name) => updateWs((w) => ({ ...w, presets: [...w.presets.filter((p) => p.name !== name), { name, layout: w.layout, panels: w.panels }].slice(-12) }))}
          onDeletePreset={(name) => updateWs((w) => ({ ...w, presets: w.presets.filter((p) => p.name !== name) }))}
        />
        {focus && (
          <Button size="sm" variant="ghost" onClick={toggleFocus} title="Leave focus mode (Esc)">
            <Minimize2 /> Exit focus
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs tabular-nums" aria-live="polite" title="Replay time (broker server clock)">
            {state.clock ? fmtWallClock(state.clock.time) : "Not started"}
          </span>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "BARS", count: 1 })} title="Advance one minute (→)"><StepForward /> 1m</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "BARS", count: 5 })} className="max-lg:hidden">5m</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "CANDLE", timeframe })} title={`Finish the current ${timeframe} candle (Shift+→)`}><SkipForward /> Candle</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "NEXT_DAY" })} title="Finish the trading day" className="max-lg:hidden"><FastForward /> Day</Button>
          <Button size="sm" variant={playing ? "secondary" : "outline"} disabled={!canMove && !playing} onClick={() => (playing ? pause() : void play())} aria-pressed={playing} title="Play / pause (Space)">
            {playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}
          </Button>
          <div role="group" aria-label="Replay speed (minutes per step)" className="flex items-center rounded-md border border-border">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => { speedRef.current = s; setSpeed(s); }} className={cn("h-6 px-1.5 text-[11px] tabular-nums first:rounded-l-md last:rounded-r-md", speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {s}m
              </button>
            ))}
          </div>
          {!focus && (
            <form
              className="flex items-center gap-1 max-xl:hidden"
              onSubmit={(e) => {
                e.preventDefault();
                const to = parseWallClock(jumpTo);
                if (to == null) return toast.error("Pick a date and time to jump to.");
                void step({ kind: "SEEK", to });
              }}
            >
              <input type="datetime-local" aria-label="Jump to (server time)" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs tabular-nums" />
              <Button type="submit" size="sm" variant="outline" disabled={!canMove || busy || playing || !jumpTo}>Jump</Button>
            </form>
          )}
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Working" />}
          {resultsHref && !focus && <ButtonLink href={resultsHref} size="sm" variant="ghost">Results</ButtonLink>}
        </div>
      </header>

      {/* ── Account strip ───────────────────────────────────────────────── */}
      {!focus && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-4 py-1.5" aria-label="Account">
          {strip.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
              <span className={cn("font-mono text-sm tabular-nums", s.tone)}>{s.value}</span>
            </div>
          ))}
          {state.statusReason && <span className="text-xs text-red-400">{state.statusReason}</span>}
        </div>
      )}

      {/* ── Charts + side panel ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label="Charts">
          <ChartGrid
            ws={ws}
            accountId={state.id}
            defaultSymbol={state.assets[0]}
            digitsFor={digitsFor}
            priceLinesFor={priceLinesFor}
            theme={resolvedTheme}
            refreshKey={refreshKey}
            started={started}
            scripts={scriptSources}
            onActivate={setActive}
            onStudiesChange={setStudies}
            onEditStudy={onEditStudy}
            paneRefs={paneRefs}
          />
          {state.clock?.atPeriodEnd && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-sm" role="status">
              End of this account&apos;s historical period.
            </div>
          )}
          {!started && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-background/80 p-6">
              <div className="max-w-sm space-y-3 text-center">
                <h2 className="text-base font-semibold">Ready to replay</h2>
                <p className="text-sm text-muted-foreground">
                  The chart starts at the first bar of {fmtWallClock(state.period.start)}. From then on time only moves forward, and this account&apos;s data and costs are locked.
                </p>
                <Button onClick={() => void start()} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Start replay</Button>
              </div>
            </div>
          )}
        </main>

        {showRight && (
          <>
            <ResizeHandle direction="left" value={rightWidth} min={240} max={560} label="Resize order panel" onChange={setRightWidth} onCommit={(width) => updateWs((w) => ({ ...w, panels: { ...w.panels, right: { ...w.panels.right, width } } }))} />
            <aside data-sim-side aria-label="Trade" style={{ width: rightWidth }} className="flex shrink-0 flex-col gap-4 overflow-y-auto p-3 max-md:hidden">
              <OrderTicket state={state} quote={quote} disabled={!tradable || playing} onPlaced={setState} />
              {studies && started && <QuickObservation state={state} studies={studies} timeframe={timeframe} />}
              {state.product === "PROP_FIRM" && <PropRulesPanel state={state} onPaidOut={() => void refreshState()} />}
            </aside>
          </>
        )}
      </div>

      {/* ── Dock ─────────────────────────────────────────────────────────── */}
      {showBottom && (
        <>
          <ResizeHandle direction="up" value={bottomHeight} min={120} max={640} label="Resize bottom panel" onChange={setBottomHeight} onCommit={(height) => updateWs((w) => ({ ...w, panels: { ...w.panels, bottom: { ...w.panels.bottom, height } } }))} />
          <div style={{ height: bottomHeight }} className="shrink-0">
            <TradeDock state={state} readOnly={!tradable} onState={setState} />
          </div>
        </>
      )}

      <IndicatorPicker open={pickerOpen} onOpenChange={setPickerOpen} count={active.studies.length} onAdd={(s) => setStudies(ws.activeChart, [...active.studies, s])} />
      <StudySettings
        study={editingStudy}
        script={editing?.script ?? null}
        onClose={() => setEditing(null)}
        onSave={(inputs) => {
          if (!editing || !editingStudy) return;
          const clean = editingStudy.kind === "indicator" ? sanitizeInputs(INDICATOR_BY_ID.get(editingStudy.id)!, inputs) : inputs;
          setStudies(editing.chart, ws.charts[editing.chart].studies.map((s) => (s.uid === editing.uid ? ({ ...s, inputs: clean } as ChartStudy) : s)));
          setEditing(null);
        }}
      />
    </div>
  );
}

function TimeframeMore({ current, favorites, onPick, onToggleFavorite }: { current: ReplayTimeframe; favorites: ReplayTimeframe[]; onPick: (tf: ReplayTimeframe) => void; onToggleFavorite: (tf: ReplayTimeframe) => void }) {
  const notFav = !favorites.includes(current);
  return (
    <Popover>
      <PopoverTrigger className={cn("h-6 rounded-r-md px-1.5 font-mono text-[11px]", notFav ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")} aria-label="All intervals">
        {notFav ? current : "▾"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1.5">
        <ul aria-label="Intervals" className="grid grid-cols-2 gap-0.5">
          {REPLAY_TIMEFRAMES.map((tf) => (
            <li key={tf} className="flex items-center">
              <button type="button" onClick={() => onPick(tf)} className={cn("flex-1 rounded px-1.5 py-1 text-left font-mono text-xs hover:bg-muted", tf === current && "bg-muted font-semibold")}>
                {tf}
              </button>
              <button type="button" onClick={() => onToggleFavorite(tf)} className="rounded p-1 hover:bg-muted" aria-label={favorites.includes(tf) ? `Remove ${tf} from favourites` : `Add ${tf} to favourites`} aria-pressed={favorites.includes(tf)}>
                <Star className={cn("size-3", favorites.includes(tf) ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
