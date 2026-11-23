"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowLeft, LineChart, Loader2, Minimize2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/backtesting/button-link";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { advanceSimClockAction, cancelSimOrderAction, getSimAccountStateAction, getSimCandlesAction, reviewTargetAction, startSimClockAction } from "@/actions/simulation.actions";
import { isPositionDrawing, linkStatus, positionFromTicket, samePosition, LINK_LABEL } from "@/domain/charting/order-sync";
import type { InstrumentEconomics, TicketLink } from "./order-ticket";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import { changeSpeed, planPlayback, startPlayback } from "@/domain/charting/playback-scheduler";
import { ReplayBar } from "@/components/charting/replay-bar";
import { SessionNavigator, type SessionJump } from "@/components/charting/session-navigator";
import { SessionEditor } from "@/components/charting/session-editor";
import { BUILTIN_SESSIONS, type SessionDef } from "@/domain/charting/sessions";
import { listTradingSessionsAction } from "@/actions/charting.actions";
import { fromWire } from "@/domain/native-replay/chart-model";
import { ScriptWorkbench, type TestData } from "@/components/scripting/script-workbench";
import { deleteSimDrawingAction, getInstrumentPointValueAction, getScriptSourcesAction, listSimDrawingsAction, saveSimDrawingAction } from "@/actions/charting.actions";
import { TOOLS, type ChartDrawing, type DrawingType } from "@/domain/native-replay/drawings/model";
import type { DrawingOp } from "@/domain/native-replay/drawings/history";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";
import { DrawingToolbar } from "@/components/native-replay/drawings/drawing-toolbar";
import { DrawingManager } from "@/components/native-replay/drawings/drawing-manager";
import { SelectionToolbar } from "@/components/native-replay/drawings/selection-toolbar";
import { applyToCharts, chartsFor, newUid, normalizeWorkspace, type ChartStudy, type Workspace } from "@/domain/charting/workspace";
import type { ScriptState } from "@/domain/charting/render-model";
import { INDICATOR_BY_ID, sanitizeInputs } from "@/domain/indicators/catalog";
import { ChartGrid } from "@/components/charting/chart-grid";
import { PRICE_DRIVEN_TYPES, type ChartPaneHandle, type DrawingStateEvent, type ScriptSource, type SharedDrawings } from "@/components/charting/chart-pane";
import type { PriceLineSpec } from "@/components/charting/sim-chart";
import { ChartSettingsMenu, ChartTypeMenu, LayoutMenu } from "@/components/charting/chart-menus";
import { IndicatorPicker } from "@/components/charting/indicator-picker";
import { StudySettings } from "@/components/charting/study-settings";
import { ResizeHandle } from "@/components/charting/resize-handle";
import { useWorkspace } from "@/components/charting/use-workspace";
import { applyStepPatch, type SimAccountStateDTO } from "@/types/simulation";
import { noteStep } from "@/components/charting/replay-perf";
import { fmtMoney, fmtWallClock, pnlTone } from "../format";
import { OrderTicket } from "./order-ticket";
import { TradeDock } from "./trade-dock";
import { QuickObservation, type StudyOption } from "../studies/quick-observation";
import { PropRulesPanel } from "../prop/prop-rules-panel";

const NO_LINES: PriceLineSpec[] = [];
type Command = { kind: "BARS"; count: number } | { kind: "CANDLE"; timeframe: ReplayTimeframe; count?: number } | { kind: "SEEK"; to: number; align?: "AT_OR_BEFORE" | "AT_OR_AFTER"; until?: number } | { kind: "NEXT_DAY" };

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
  const stateRef = useRef(initialState);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [ws, updateWs] = useWorkspace(initialWorkspace);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** Review position (≤ the clock) while looking back; null = following the live replay. */
  const [review, setReview] = useState<number | null>(null);
  const reviewRef = useRef<number | null>(null);
  useEffect(() => {
    reviewRef.current = review;
  }, [review]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<{ chart: number; uid: string; script: ScriptState | null } | null>(null);
  const [scriptSources, setScriptSources] = useState(new Map<string, ScriptSource>());
  const [bottomTab, setBottomTab] = useState<"trading" | "scripts">("trading");
  // Drawings (per instrument, shared by every chart of it).
  const [drawingsBySymbol, setDrawingsBySymbol] = useState(new Map<string, SharedDrawings>());
  const [drawTool, setDrawTool] = useState<DrawingType | null>(null);
  const [drawSelected, setDrawSelected] = useState<ChartDrawing | null>(null);
  const [drawList, setDrawList] = useState<ChartDrawing[]>([]);
  const [drawCanUndo, setDrawCanUndo] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [magnet, setMagnet] = useState(false);
  const [customSessions, setCustomSessions] = useState<SessionDef[]>([]);
  const [sessionEditor, setSessionEditor] = useState(false);
  const lastMoveRef = useRef<{ moved: boolean; toMinute: number } | null>(null);
  /** The position drawing linked to the order ticket (stable across selection changes). */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const linkedIdRef = useRef(linkedId);
  useEffect(() => {
    linkedIdRef.current = linkedId;
  }, [linkedId]);
  const [economics, setEconomics] = useState<{ symbol: string; value: InstrumentEconomics | null } | null>(null);
  // Live sizes while dragging (committed to the workspace on release).
  const [rightWidth, setRightWidth] = useState(ws.panels.right.width);
  const [bottomHeight, setBottomHeight] = useState(ws.panels.bottom.height);
  const paneRefs = useRef<(ChartPaneHandle | null)[]>([]);
  const playingRef = useRef(false);
  const replayRef = useRef(initialWorkspace.replay);

  const active = ws.charts[Math.min(ws.activeChart, chartsFor(ws.layout) - 1)] ?? ws.charts[0];
  const symbol = active.symbol && state.assets.includes(active.symbol) ? active.symbol : state.assets[0];
  const timeframe = active.timeframe;
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const quote = state.quotes.find((q) => q.symbol === symbol);
  useEffect(() => {
    let live = true;
    void getInstrumentPointValueAction({ accountId: state.id, symbol }).then((r) => live && setEconomics({ symbol, value: r.success && r.value ? r.value : null }));
    return () => {
      live = false;
    };
  }, [state.id, symbol]);
  const started = state.clock != null;
  const tradable = started && state.status === "ACTIVE";
  const canMove = tradable && !state.clock?.atPeriodEnd;
  const focus = ws.focus;
  useEffect(() => {
    replayRef.current = ws.replay;
  }, [ws.replay]);
  const periodFrom = parseWallClock(`${state.period.start}T00:00`) ?? 0;
  const periodTo = (parseWallClock(`${state.period.end}T00:00`) ?? 0) + 1439;
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    void listTradingSessionsAction().then((r) => r.success && setCustomSessions(r.sessions));
  }, []);
  const allSessions = useMemo(() => [...BUILTIN_SESSIONS, ...customSessions], [customSessions]);
  const sessionOverlay = useMemo(() => {
    const ss = ws.sessions;
    const defs = allSessions.filter((d) => d.enabled && ss.show.includes(d.id));
    return { defs, all: allSessions, dataTimeZone: ss.dataTimeZone, shading: ss.shading, highLow: ss.highLow, labels: ss.labels };
  }, [allSessions, ws.sessions]);
  const activeIndex = Math.min(ws.activeChart, chartsFor(ws.layout) - 1);
  const activeCtl = useCallback(() => paneRefs.current[activeIndex]?.drawings() ?? null, [activeIndex]);
  const drawingsReadOnly = !(state.status === "ACTIVE" || state.status === "CREATED");
  const activePriceDriven = PRICE_DRIVEN_TYPES.has(active.chartType);

  // ── Workspace helpers ─────────────────────────────────────────────────────
  const patchChart = useCallback((index: number, patch: Partial<Workspace["charts"][number]>) => updateWs((w) => ({ ...w, charts: w.charts.map((c, i) => (i === index ? { ...c, ...patch } : c)) })), [updateWs]);
  const setActive = useCallback(
    (i: number) => {
      // Drawing tool/selection belong to the active chart: hand over cleanly.
      const prev = paneRefs.current[activeIndex]?.drawings();
      prev?.setTool(null);
      prev?.select(null);
      const next = paneRefs.current[i]?.drawings();
      setDrawSelected(null);
      setDrawTool(null);
      setDrawList(next ? [...next.getDrawings()] : []);
      updateWs((w) => ({ ...w, activeChart: i }));
    },
    [updateWs, activeIndex],
  );
  const setStudies = useCallback((i: number, list: ChartStudy[]) => patchChart(i, { studies: list }), [patchChart]);
  const onEditStudy = useCallback((chart: number, uid: string, script: ScriptState | null) => setEditing({ chart, uid, script }), []);

  // ── Script sources for every script study on screen ───────────────────────
  const scriptIds = useMemo(() => [...new Set(ws.charts.flatMap((c) => c.studies.flatMap((s) => (s.kind === "script" ? [s.scriptId] : []))))].sort(), [ws.charts]);
  const scriptKey = scriptIds.join(",");
  const [scriptsVersion, setScriptsVersion] = useState(0); // bumped when a script is saved in the editor
  useEffect(() => {
    if (scriptIds.length) void getScriptSourcesAction({ ids: scriptIds }).then((res) => res.success && setScriptSources(new Map(res.scripts.map((s) => [s.id, s]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptKey, scriptsVersion]);

  // Strategy Tester / script runs use the active chart's REAL candles (never a
  // synthetic chart type), as far back as the server allows, up to the clock.
  const loadTestData = useCallback(async (): Promise<TestData | null> => {
    if (!started) {
      toast.error("Start the replay first.");
      return null;
    }
    const [res, pv] = await Promise.all([getSimCandlesAction({ accountId: state.id, symbol, timeframe, limit: 5000 }), getInstrumentPointValueAction({ accountId: state.id, symbol })]);
    if (!res.success) {
      toast.error(res.error);
      return null;
    }
    const scale = 10 ** res.candles.priceScale;
    const list = res.candles.candles.map((c) => fromWire(c, res.candles.priceScale));
    return {
      bars: list.map((c) => ({ time: c.time, open: c.open / scale, high: c.high / scale, low: c.low / scale, close: c.close / scale, volume: c.tickVolume ?? 0 })),
      lastForming: list[list.length - 1]?.state === "FORMING",
      priceDigits: res.candles.priceScale,
      label: `${symbol} ${timeframe}`,
      pointValue: pv.success && pv.value ? pv.value : null,
    };
  }, [started, state.id, symbol, timeframe]);

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

  // ── Drawings: load per instrument on screen; persist every edit ──────────
  const shownSymbols = useMemo(() => [...new Set(ws.charts.slice(0, chartsFor(ws.layout)).map((c) => (c.symbol && state.assets.includes(c.symbol) ? c.symbol : state.assets[0])))].sort(), [ws.charts, ws.layout, state.assets]);
  const loadedSymbols = useRef(new Set<string>());
  const revRef = useRef(0);
  const reloadDrawings = useCallback(
    async (sym: string) => {
      const res = await listSimDrawingsAction({ accountId: state.id, assetSymbol: sym });
      if (!res.success) return void toast.error(res.error);
      setDrawingsBySymbol((m) => new Map(m).set(sym, { list: res.drawings, origin: null, rev: ++revRef.current }));
    },
    [state.id],
  );
  const shownKey = shownSymbols.join(",");
  useEffect(() => {
    for (const sym of shownSymbols) {
      if (loadedSymbols.current.has(sym)) continue;
      loadedSymbols.current.add(sym);
      void reloadDrawings(sym);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, reloadDrawings]);

  const onDrawingCommit = useCallback(
    (index: number, sym: string, op: DrawingOp, list: ChartDrawing[]) => {
      setDrawingsBySymbol((m) => new Map(m).set(sym, { list, origin: index, rev: ++revRef.current }));
      if (op.kind === "delete") {
        if (op.drawing.id === linkedIdRef.current) setLinkedId(null);
        const ref = op.drawing.data.orderRef;
        // Deleting the plan never touches the order it became — but offer it.
        if (ref && stateRef.current.orders.some((o) => o.id === ref.orderId)) {
          toast.message("The drawing is gone; its pending order is still working.", {
            duration: 10_000,
            action: {
              label: "Cancel order",
              onClick: () =>
                void cancelSimOrderAction({ accountId: stateRef.current.id, orderId: ref.orderId }).then((r) => (r.success ? (setState(r.state), toast.success("Order cancelled")) : toast.error(r.error))),
            },
          });
        }
      }
      const task =
        op.kind === "delete"
          ? deleteSimDrawingAction({ accountId: state.id, assetSymbol: sym, drawingId: op.drawing.id })
          : (() => {
              const d = op.kind === "create" ? op.drawing : op.after;
              const { linkedTradeId: _ignored, ...rest } = d;
              void _ignored;
              return saveSimDrawingAction({ accountId: state.id, drawing: rest });
            })();
      void task.then((res) => {
        if (!res.success) {
          toast.error(res.error);
          void reloadDrawings(sym); // the server's copy wins
        }
      });
    },
    [state.id, reloadDrawings],
  );
  const onDrawingState = useCallback(
    (index: number, ev: DrawingStateEvent) => {
      if (index !== activeIndex) return;
      if ("selected" in ev) {
        setDrawSelected(ev.selected);
        // Selecting a long/short drawing links it to the ticket; it stays linked until another is selected or it's unlinked.
        if (isPositionDrawing(ev.selected)) setLinkedId(ev.selected.id);
      }
      else if ("tool" in ev) setDrawTool(ev.tool);
      else {
        setDrawList(ev.list);
        setDrawCanUndo(!!paneRefs.current[index]?.drawings().canUndo());
      }
    },
    [activeIndex],
  );
  useEffect(() => {
    activeCtl()?.setMagnet(magnet);
  }, [magnet, activeCtl]);
  const live = useMemo(() => ({ orderIds: new Set(state.orders.map((o) => o.id)), positionIds: new Set(state.positions.map((p) => p.id)) }), [state.orders, state.positions]);
  const syncOn = ws.trading.syncPositionDrawing;
  const linkedDrawing = syncOn && linkedId ? (drawList.find((d) => d.id === linkedId && d.assetSymbol === symbol) ?? null) : null;
  const ticketLink: TicketLink | null =
    linkedDrawing && isPositionDrawing(linkedDrawing)
      ? {
          drawing: linkedDrawing,
          status: linkStatus(linkedDrawing.data.orderRef, true, live),
          onEdit: (edit) =>
            activeCtl()?.update(linkedDrawing.id, (d) => {
              if (!d.data.position) return;
              const next = positionFromTicket(d.data.position, edit);
              if (!samePosition(next, d.data.position)) d.data.position = next;
            }),
          onUnlink: () => setLinkedId(null),
        }
      : null;
  const badgeFor = (d: ChartDrawing) => {
    if (!isPositionDrawing(d)) return null;
    const st = linkStatus(d.data.orderRef, syncOn && d.id === linkedId, live);
    return { label: LINK_LABEL[st], tone: st === "draft" ? ("muted" as const) : st === "linked" ? ("info" as const) : ("good" as const) };
  };
  const pipSize = (() => {
    const spec = lookupInstrument(symbol);
    return spec?.pipSize ? Number(spec.pipSize) : null;
  })();

  // ── Replay ────────────────────────────────────────────────────────────────
  // One replay step = one round trip: the server moves the clock, settles
  // everything the move reveals, and returns either a small patch (nothing
  // traded) or the full state, plus the M1 bars it revealed for the
  // instruments on screen. Each chart folds those bars in locally — no
  // candle refetch, no full chart rebuild.
  const shownRef = useRef<string[]>([]);
  useEffect(() => {
    shownRef.current = shownSymbols;
  }, [shownSymbols]);
  const run = useCallback(
    async (command: Command): Promise<boolean> => {
      const t0 = performance.now();
      const res = await advanceSimClockAction({ accountId: state.id, command, commandId: crypto.randomUUID(), views: shownRef.current });
      const tResponse = performance.now();
      if (!res.success) {
        toast.error(res.error);
        setRefreshKey((k) => k + 1); // never assume what moved: reload the charts
        return false;
      }
      const { outcome } = res;
      lastMoveRef.current = { moved: outcome.moved, toMinute: outcome.toMinute };
      if (res.state) setState(res.state);
      else if (res.patch) setState((prev) => applyStepPatch(prev, res.patch!));
      if (outcome.moved) {
        const bySymbol = new Map(res.revealed.map((r) => [r.symbol, r]));
        for (const pane of paneRefs.current) pane?.reveal(bySymbol.get(pane.symbol()), outcome.fromMinute, outcome.toMinute);
      }
      // A halt is a trading change, so it always comes with the full state.
      const after = res.state;
      if (outcome.halted && after) {
        const msg = { PASSED: "Phase passed — the next stage is ready in the challenge history.", BREACHED: `Breached: ${after.statusReason ?? "a rule was broken"}`, FAILED: after.statusReason ?? "Phase failed." }[after.status as "PASSED" | "BREACHED" | "FAILED"];
        if (msg) (after.status === "PASSED" ? toast.success : toast.error)(msg, { duration: 8000 });
      }
      if (outcome.filledOrders > 0) toast.message(`${outcome.filledOrders} order${outcome.filledOrders === 1 ? "" : "s"} filled`);
      if (outcome.closedPositions > 0) toast.message(`${outcome.closedPositions} position${outcome.closedPositions === 1 ? "" : "s"} closed`);
      // Charts paint on the next frame: measure up to it.
      requestAnimationFrame(() => {
        const tPaint = performance.now();
        noteStep({
          command: command.kind === "CANDLE" ? `CANDLE ${command.timeframe}` : command.kind === "BARS" ? `BARS ${command.count}` : command.kind,
          responseMs: tResponse - t0,
          serverMs: res.serverMs,
          applyMs: tPaint - tResponse,
          totalMs: tPaint - t0,
          kind: res.state ? "full" : "patch",
          revealedBars: res.revealed.reduce((n, r) => n + (r.bars?.length ?? 0), 0),
        });
      });
      const status = res.state?.status ?? res.patch?.status;
      const atEnd = res.state?.clock?.atPeriodEnd ?? res.patch?.clock.atPeriodEnd ?? outcome.atPeriodEnd;
      return outcome.moved && status === "ACTIVE" && !atEnd;
    },
    [state.id],
  );

  const step = async (command: Command) => {
    if (busy || playingRef.current) return;
    setBusy(true);
    try {
      await run(command);
    } finally {
      setBusy(false); // never leave the controls disabled after an error
    }
  };

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  // ── Playback (bars of the playback timeframe, `speedMs` apart) ───────────
  // The schedule is a fixed timeline (domain/charting/playback-scheduler):
  // processing time doesn't drift it, a slow response is caught up by
  // requesting every bar that is due (the server settles each one in order),
  // and a speed change takes effect on the next bar without restarting.
  const play = useCallback(async () => {
    if (playingRef.current) return;
    if (reviewRef.current != null) setReview(null); // playing always continues from the live position
    playingRef.current = true;
    setPlaying(true);
    let clock = startPlayback(performance.now(), replayRef.current.speedMs);
    try {
      while (playingRef.current) {
        const { speedMs, playbackTf } = replayRef.current;
        if (speedMs !== clock.intervalMs) clock = changeSpeed(clock, performance.now(), speedMs);
        const plan = planPlayback(clock, performance.now());
        if (plan.kind === "wait") {
          await new Promise((r) => setTimeout(r, Math.min(plan.ms, 50))); // re-check pause / speed often
          continue;
        }
        clock = plan.clock;
        const more = await run({ kind: "CANDLE", timeframe: playbackTf, count: plan.count });
        if (!more) break;
      }
    } finally {
      playingRef.current = false;
      setPlaying(false);
    }
  }, [run]);

  /**
   * Session jump. Within what's revealed → review there. Later → move the
   * replay forward to the first bar inside the session; if the session has
   * no data, nothing moves and the trader is told (never a silent jump to an
   * unrelated time).
   */
  const jumpToSession = useCallback(
    async (j: SessionJump) => {
      const now = stateRef.current.clock?.minute;
      if (now == null) return;
      if (j.to <= now) {
        const res = await reviewTargetAction({ accountId: stateRef.current.id, from: reviewRef.current ?? now, move: { kind: "SEEK", to: j.to, align: j.align, until: j.until } });
        if (!res.success) return void toast.error(res.error);
        if (res.minute == null || (j.until != null && res.minute >= j.until)) return void toast.message(`No market data for ${j.label}.`);
        setReview(res.minute >= res.clock ? null : res.minute);
        return;
      }
      setReview(null);
      lastMoveRef.current = null;
      setBusy(true);
      try {
        await run({ kind: "SEEK", to: j.to, align: j.align, until: j.until });
      } finally {
        setBusy(false);
      }
      const last = lastMoveRef.current as { moved: boolean } | null;
      if (last && !last.moved) toast.message(`No market data for ${j.label} — the replay didn't move.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Review: step back over what's already revealed (never past the clock) ──
  const reviewMove = useCallback(
    async (move: { kind: "BACK" | "FORWARD"; timeframe: ReplayTimeframe } | { kind: "SEEK"; to: number }) => {
      const from = reviewRef.current ?? state.clock?.minute;
      if (from == null) return;
      setBusy(true);
      try {
        const res = await reviewTargetAction({ accountId: state.id, from, move });
        if (!res.success) return void toast.error(res.error);
        if (res.minute == null) return void toast.message(move.kind === "BACK" ? "That's the start of the revealed data." : "Nothing there.");
        setReview(res.minute >= res.clock ? null : res.minute);
      } finally {
        setBusy(false);
      }
    },
    [state.id, state.clock?.minute],
  );
  const nextBar = useCallback(() => {
    const tf = replayRef.current.playbackTf;
    if (reviewRef.current != null) void reviewMove({ kind: "FORWARD", timeframe: tf });
    else void step({ kind: "CANDLE", timeframe: tf });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMove]);
  const nextCandle = useCallback(() => {
    const tf = timeframeRef.current;
    if (reviewRef.current != null) void reviewMove({ kind: "FORWARD", timeframe: tf });
    else void step({ kind: "CANDLE", timeframe: tf });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMove]);
  const prevBar = useCallback(() => void reviewMove({ kind: "BACK", timeframe: replayRef.current.playbackTf }), [reviewMove]);
  const prevCandle = useCallback(() => void reviewMove({ kind: "BACK", timeframe: timeframeRef.current }), [reviewMove]);
  /** Timeline / jump: within what's revealed → review there; later → move the replay forward. */
  const goTo = useCallback(
    (minute: number) => {
      const now = state.clock?.minute;
      if (now == null) return;
      if (minute <= now) void reviewMove({ kind: "SEEK", to: minute });
      else {
        setReview(null);
        void step({ kind: "SEEK", to: minute });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.clock?.minute, reviewMove],
  );

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
      const ctl = activeCtl();
      const mod = e.metaKey || e.ctrlKey;
      if (ctl && mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) ctl.redo();
        else ctl.undo();
        return;
      }
      if (ctl && mod && e.code === "KeyD" && ctl.selected()) {
        e.preventDefault();
        ctl.duplicateSelected();
        return;
      }
      if (ctl && e.altKey && !mod) {
        const t = (Object.keys(TOOLS) as DrawingType[]).find((k) => TOOLS[k].shortcut && e.code === `Key${TOOLS[k].shortcut!.slice(-1)}`);
        if (t) {
          e.preventDefault();
          if (!drawingsReadOnly && !activePriceDriven) ctl.setTool(t);
          return;
        }
      }
      if (mod || e.altKey) return;
      if (e.key === "Escape" && ctl && (ctl.getTool() || ctl.selected())) {
        ctl.cancel();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && ctl?.selected()) {
        e.preventDefault();
        ctl.deleteSelected();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (playingRef.current) pause();
        else if (canMove || reviewRef.current != null) void play();
      } else if (e.key === "ArrowRight" && (canMove || reviewRef.current != null) && !playingRef.current) {
        e.preventDefault();
        if (e.shiftKey) nextCandle();
        else nextBar();
      } else if (e.key === "ArrowLeft" && started && !playingRef.current) {
        e.preventDefault();
        if (e.shiftKey) prevCandle();
        else prevBar();
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
          {review != null && (
            <span className="rounded-md bg-sky-500/15 px-2 py-1 text-xs text-sky-300" role="status">
              Reviewing {formatReplayTime(review)} — trading paused
            </span>
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
        {ws.panels.left.visible && !focus && (
          <DrawingToolbar
            tool={drawTool}
            onTool={(t) => activeCtl()?.setTool(t)}
            magnet={magnet}
            onMagnet={setMagnet}
            readOnly={drawingsReadOnly || !started || activePriceDriven}
            canUndo={drawList.length > 0 || drawCanUndo}
            onUndo={() => activeCtl()?.undo()}
            onRedo={() => activeCtl()?.redo()}
            managerOpen={managerOpen}
            onManager={() => setManagerOpen((o) => !o)}
            drawingCount={drawList.length}
          />
        )}
        <main ref={mainRef} className="relative min-w-0 flex-1" aria-label="Charts">
          <ChartGrid
            ws={ws}
            accountId={state.id}
            defaultSymbol={state.assets[0]}
            digitsFor={digitsFor}
            priceLinesFor={priceLinesFor}
            theme={resolvedTheme}
            refreshKey={refreshKey}
            asOf={review}
            sessionOverlay={sessionOverlay}
            started={started}
            scripts={scriptSources}
            onActivate={setActive}
            onStudiesChange={setStudies}
            onEditStudy={onEditStudy}
            paneRefs={paneRefs}
            drawingsBySymbol={drawingsBySymbol}
            drawingsReadOnly={drawingsReadOnly}
            onDrawingCommit={onDrawingCommit}
            onDrawingState={onDrawingState}
            overlay={(i) =>
              i !== activeIndex ? null : (
                <>
                  {activePriceDriven && started && (
                    <p className="pointer-events-none absolute bottom-3 right-16 z-20 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground">Drawings are anchored to time, so they&apos;re hidden on price-driven chart types.</p>
                  )}
                  {drawSelected && !drawSelected.hidden && !activePriceDriven && (
                    <SelectionToolbar
                      drawing={drawSelected}
                      priceScale={digitsFor(symbol)}
                      pipSize={pipSize}
                      readOnly={drawingsReadOnly}
                      onChange={(mutate) => activeCtl()?.update(drawSelected.id, mutate)}
                      onToggleLock={() => activeCtl()?.update(drawSelected.id, (d) => void (d.locked = !d.locked), { allowLocked: true })}
                      onHide={() => {
                        activeCtl()?.update(drawSelected.id, (d) => void (d.hidden = true), { allowLocked: true });
                        activeCtl()?.select(null);
                      }}
                      onDuplicate={() => activeCtl()?.duplicateSelected()}
                      onDelete={() => activeCtl()?.deleteSelected()}
                    />
                  )}
                  {drawTool && (
                    <div className="pointer-events-none absolute left-1/2 top-9 z-30 -translate-x-1/2 rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm" role="status">
                      {TOOLS[drawTool].label}: {TOOLS[drawTool].anchors === 1 ? "click to place" : TOOLS[drawTool].anchors === 3 ? "click three points" : "click twice, or drag"} · Esc to cancel
                    </div>
                  )}
                  {managerOpen && (
                    <DrawingManager
                      drawings={drawList}
                      selectedId={drawSelected?.id ?? null}
                      readOnly={drawingsReadOnly}
                      onSelect={(id) => activeCtl()?.select(id)}
                      onToggleHidden={(id) => activeCtl()?.update(id, (d) => void (d.hidden = !d.hidden), { allowLocked: true })}
                      onToggleLock={(id) => activeCtl()?.update(id, (d) => void (d.locked = !d.locked), { allowLocked: true })}
                      onDelete={(id) => activeCtl()?.remove(id)}
                      onClose={() => setManagerOpen(false)}
                      badgeFor={badgeFor}
                    />
                  )}
                </>
              )
            }
          />
          {started && (
            <ReplayBar
              areaRef={mainRef}
              settings={ws.replay}
              onSettings={(patch) => updateWs((w) => ({ ...w, replay: { ...w.replay, ...patch } }))}
              onBar={(patch) => updateWs((w) => ({ ...w, replay: { ...w.replay, bar: { ...w.replay.bar, ...patch } } }))}
              clockMinute={state.clock?.minute ?? null}
              periodFrom={periodFrom}
              periodTo={periodTo}
              reviewMinute={review}
              chartTf={timeframe}
              playing={playing}
              busy={busy}
              canMove={canMove}
              onPlay={() => void play()}
              onPause={pause}
              onNextBar={nextBar}
              onNextCandle={nextCandle}
              onPrevBar={prevBar}
              onPrevCandle={prevCandle}
              onGoTo={goTo}
              onLive={() => setReview(null)}
              onNextDay={() => {
                setReview(null);
                void step({ kind: "NEXT_DAY" });
              }}
              extra={
                <SessionNavigator
                  sessions={allSessions}
                  settings={ws.sessions}
                  onSettings={(patch) => updateWs((w) => ({ ...w, sessions: { ...w.sessions, ...patch } }))}
                  viewMinute={review ?? state.clock?.minute ?? periodFrom}
                  disabled={playing || busy}
                  onJump={(j) => void jumpToSession(j)}
                  onManage={() => setSessionEditor(true)}
                />
              }
            />
          )}
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
              {review != null && <p className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-300">Reviewing earlier bars. Return to live to trade.</p>}
              <OrderTicket
                state={state}
                quote={quote}
                disabled={!tradable || playing || review != null}
                link={ticketLink}
                economics={economics?.symbol === symbol ? economics.value : null}
                confirmAll={ws.trading.confirmOrders}
                onPlaced={(next, drawing) => {
                  setState(next);
                  if (drawing) void reloadDrawings(drawing.assetSymbol);
                }}
              />
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" className="size-3.5" checked={syncOn} onChange={(e) => updateWs((w) => ({ ...w, trading: { ...w.trading, syncPositionDrawing: e.target.checked } }))} />
                Sync position drawing with order entry
              </label>
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
          {/* Never squeeze the charts below ~240px, whatever height was saved. */}
          <div style={{ height: bottomHeight, maxHeight: "calc(100dvh - 22rem)" }} className="flex shrink-0 flex-col">
            <div role="tablist" aria-label="Bottom panel" className="flex shrink-0 items-center gap-0.5 border-b border-border bg-muted/30 px-1.5">
              {(["trading", "scripts"] as const).map((t) => (
                <button key={t} role="tab" type="button" aria-selected={bottomTab === t} onClick={() => setBottomTab(t)} className={cn("px-2.5 py-1 text-[11px] font-medium", bottomTab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {t === "trading" ? "Trading" : "Scripts & Strategy Tester"}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {bottomTab === "trading" ? (
                <TradeDock state={state} readOnly={!tradable} onState={setState} />
              ) : (
                <ScriptWorkbench
                  loadTestData={loadTestData}
                  onSaved={() => setScriptsVersion((v) => v + 1)}
                  onAddToChart={(script) => {
                    if (active.studies.length >= 12) return void toast.error("This chart has the maximum of 12 studies.");
                    setStudies(ws.activeChart, [...active.studies, { uid: newUid(), kind: "script", scriptId: script.id, inputs: {}, visible: true }]);
                    toast.success(`Added “${script.name}” to the ${symbol} ${timeframe} chart`);
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}

      <SessionEditor open={sessionEditor} onOpenChange={setSessionEditor} sessions={allSessions} onChanged={setCustomSessions} />
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
