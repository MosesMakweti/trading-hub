"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  Magnet,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Redo2,
  SkipForward,
  StepForward,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { advanceReplayAction, getReplayCandlesAction, initializeReplayAction } from "@/actions/native-replay.actions";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { applyRevealed, diffCandles, fromWire, wireToBars } from "@/domain/native-replay/chart-model";
import { formatCrosshairTime, formatPrice, formatReplayTime, toChartTime } from "@/domain/native-replay/chart-time";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { formatWallClock, parseWallClock } from "@/domain/native-replay/wall-clock";
import type { ReplayCommand, ReplayStateDTO } from "@/server/services/native-replay/backtest-replay.service";
import { countCommit, ReplayChart, type CrosshairInfo, type ReplayChartHandle } from "./chart/replay-chart";

/**
 * Native Replay — the full-screen replay workspace.
 *
 * Two kinds of state, kept strictly apart:
 * - REPLAY state (server truth): the run's world time for this date. Only
 *   server replies change it; nothing here is optimistic.
 * - VIEW state (this browser): asset, timeframe, panel/volume toggles (saved in
 *   localStorage), zoom/pan position, crosshair. Changing any of it never
 *   moves the clock.
 *
 * Chart data: loaded from the server on open, asset/timeframe switch, older-
 * history paging and reconciliation; between those, each replay step folds its
 * returned M1 bars into the displayed candles with the shared engine functions
 * (chart-model.ts) and updates only the changed candles. Pause, tab restore and
 * failed/duplicate steps reconcile with the server — server wins.
 */

const QUICK_TIMEFRAMES: ReplayTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const MORE_TIMEFRAMES = REPLAY_TIMEFRAMES.filter((t) => !QUICK_TIMEFRAMES.includes(t));
const SPEEDS = [1, 2, 5, 10, 20] as const;
type Speed = (typeof SPEEDS)[number];

/** 1x = one M1 step per second. Ticks never faster than 200ms; faster speeds reveal several minutes per tick. */
export function playbackPlan(speed: number): { intervalMs: number; barsPerTick: number } {
  const intervalMs = Math.max(200, 1000 / speed);
  return { intervalMs, barsPerTick: Math.max(1, Math.round((speed * intervalMs) / 1000)) };
}

interface ViewPrefs {
  asset: string;
  timeframe: ReplayTimeframe;
  sessionOpen: boolean;
  volume: boolean;
}

const newCommandId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[data-session-panel]"));

export interface ReplayWorkspaceProps {
  run: { id: string; name: string; status: string; assets: string[] };
  dateKey: string;
  previousDateKey: string | null;
  nextDateKey: string | null;
  dayIndex: number;
  totalTradingDays: number;
  initialState: ReplayStateDTO;
  /** The existing Backtesting Session workflow for this date (server-rendered). */
  sessionPanel: React.ReactNode;
}

export function ReplayWorkspace({ run, dateKey, previousDateKey, nextDateKey, dayIndex, totalTradingDays, initialState, sessionPanel }: ReplayWorkspaceProps) {
  const { resolvedTheme } = useTheme();
  const prefsKey = `native-replay:view:${run.id}`;

  // ── Replay state (server truth) ──────────────────────────────────────────
  const [world, setWorld] = useState(initialState);
  const position = world.position;
  const atDayEnd = position?.atDayEnd ?? false;
  const readOnly = world.readOnly;

  // ── View state (this browser only) ───────────────────────────────────────
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [asset, setAsset] = useState(run.assets[0] ?? "");
  const [timeframe, setTimeframe] = useState<ReplayTimeframe>("M30");
  const [sessionOpen, setSessionOpen] = useState(false);
  const [volume, setVolume] = useState(false);
  const [magnet, setMagnet] = useState(false);
  const [following, setFollowing] = useState(true);
  const [hover, setHover] = useState<{ candle: EngineCandle; previousClose: number | null } | null>(null);
  const [latest, setLatest] = useState<EngineCandle | null>(null);
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [priceScale, setPriceScale] = useState(world.assets.find((a) => a.assetSymbol === asset)?.dataset?.priceScale ?? 5);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [jumpTo, setJumpTo] = useState("");

  const chartRef = useRef<ReplayChartHandle>(null);
  const candlesRef = useRef<EngineCandle[]>([]);
  const hasMoreBeforeRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const viewRef = useRef({ asset, timeframe });
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);
  const loadSeq = useRef(0);

  const assetInfo = world.assets.find((a) => a.assetSymbol === asset) ?? null;
  useEffect(() => countCommit("workspaceCommits"));
  const canMove = world.status === "ACTIVE" && !readOnly && !atDayEnd;

  // Load saved view prefs once (after mount — localStorage isn't available during SSR).
  useEffect(() => {
    let saved: Partial<ViewPrefs> = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(prefsKey) ?? "{}");
    } catch {
      saved = {};
    }
    const initialAsset = saved.asset && run.assets.includes(saved.asset) ? saved.asset : run.assets[0] ?? "";
    const initialTf = saved.timeframe && (REPLAY_TIMEFRAMES as readonly string[]).includes(saved.timeframe) ? saved.timeframe : "M30";
    viewRef.current = { asset: initialAsset, timeframe: initialTf };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setAsset(initialAsset);
    setTimeframe(initialTf);
    setSessionOpen(saved.sessionOpen ?? false);
    setVolume(saved.volume ?? false);
    setPrefsLoaded(true);
  }, [prefsKey, run.assets]);

  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      window.localStorage.setItem(prefsKey, JSON.stringify({ asset, timeframe, sessionOpen, volume } satisfies ViewPrefs));
    } catch {
      /* storage unavailable — prefs are a convenience only */
    }
  }, [prefsLoaded, prefsKey, asset, timeframe, sessionOpen, volume]);

  const publishLatest = useCallback(() => {
    const list = candlesRef.current;
    setLatest(list[list.length - 1] ?? null);
    setPreviousClose(list.length > 1 ? list[list.length - 2].close : null);
  }, []);

  /** Authoritative candles from the server for the current view (replaces the chart's data). */
  const loadCandles = useCallback(
    async (mode: "switch" | "reconcile") => {
      const { asset: a, timeframe: tf } = viewRef.current;
      const info = world.assets.find((x) => x.assetSymbol === a);
      if (world.status !== "ACTIVE" || !info?.dataset) {
        candlesRef.current = [];
        chartRef.current?.setCandles([]);
        publishLatest();
        return;
      }
      const seq = ++loadSeq.current;
      if (mode === "switch") setLoading(true);
      const res = await getReplayCandlesAction({ runId: run.id, dateKey, assetSymbol: a, timeframe: tf, limit: mode === "reconcile" ? Math.min(Math.max(candlesRef.current.length, 50), 1500) : 500 });
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      setLoading(false);
      if (!res.success) {
        setHistoryError(res.error); // the current chart stays as it is
        return;
      }
      setHistoryError(null);
      const scale = res.candles.priceScale;
      const server = res.candles.candles.map((c) => fromWire(c, scale));
      if (mode === "reconcile") {
        const tail = candlesRef.current.slice(-server.length);
        const mismatches = diffCandles(tail, server);
        if (mismatches === 0) return;
        if (process.env.NODE_ENV !== "production") console.warn(`[native-replay] reconciled ${mismatches} candle(s) with the server`);
        // Server wins: keep older client history, replace everything the server returned.
        candlesRef.current = [...candlesRef.current.filter((c) => c.time < (server[0]?.time ?? Infinity)), ...server];
        chartRef.current?.setCandles(candlesRef.current);
      } else {
        candlesRef.current = server;
        hasMoreBeforeRef.current = res.candles.hasMoreBefore;
        setPriceScale(scale);
        chartRef.current?.setCandles(server, { fit: true });
      }
      publishLatest();
    },
    [world.assets, world.status, run.id, dateKey, publishLatest],
  );

  // Initial load, and whenever the view (asset/timeframe) or the replay status changes.
  const worldStatus = world.status;
  useEffect(() => {
    if (!prefsLoaded) return;
    viewRef.current = { asset, timeframe };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server fetch; state is set when it resolves
    void loadCandles("switch");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on view/status change only
  }, [prefsLoaded, asset, timeframe, worldStatus]);

  // Reconcile when the tab comes back (the clock may have moved in another tab).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !playingRef.current) void loadCandles("reconcile");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadCandles]);

  /** Chart navigation only — loads OLDER revealed candles; never touches the clock. */
  const loadOlder = useCallback(async () => {
    if (!hasMoreBeforeRef.current || loadingOlderRef.current || candlesRef.current.length === 0) return;
    loadingOlderRef.current = true;
    const { asset: a, timeframe: tf } = viewRef.current;
    const oldest = candlesRef.current[0].time;
    const res = await getReplayCandlesAction({ runId: run.id, dateKey, assetSymbol: a, timeframe: tf, limit: 500, to: formatWallClock(oldest - 1) });
    loadingOlderRef.current = false;
    if (!res.success) {
      setHistoryError(res.error);
      return;
    }
    if (viewRef.current.asset !== a || viewRef.current.timeframe !== tf) return;
    const older = res.candles.candles.map((c) => fromWire(c, res.candles.priceScale)).filter((c) => c.time < oldest);
    hasMoreBeforeRef.current = res.candles.hasMoreBefore && older.length > 0;
    if (older.length === 0) return;
    candlesRef.current = [...older, ...candlesRef.current];
    chartRef.current?.setCandles(candlesRef.current, { prepended: older.length });
  }, [run.id, dateKey]);

  // ── Replay commands ──────────────────────────────────────────────────────
  const send = useCallback(
    async (command: ReplayCommand | { kind: "SEEK"; to: string }): Promise<boolean> => {
      const { asset: a, timeframe: tf } = viewRef.current;
      const res = await advanceReplayAction({ runId: run.id, dateKey, command, commandId: newCommandId(), viewAsset: a || undefined });
      if (!res.success) {
        toast.error(res.error);
        void loadCandles("reconcile"); // never assume the clock moved
        return false;
      }
      const r = res.result;
      setWorld(r.state);
      if (!r.applied) {
        void loadCandles("reconcile");
        return r.moved;
      }
      if (r.moved && viewRef.current.asset === a && viewRef.current.timeframe === tf && candlesRef.current.length) {
        const scale = r.state.assets.find((x) => x.assetSymbol === a)?.dataset?.priceScale ?? priceScale;
        const { changed } = applyRevealed(candlesRef.current, wireToBars(r.revealed, scale), tf, r.toMinute);
        if (changed.length) chartRef.current?.updateCandles(changed);
        publishLatest();
      }
      return r.moved;
    },
    [run.id, dateKey, loadCandles, priceScale, publishLatest],
  );

  const run1 = useCallback(
    async (command: Parameters<typeof send>[0]) => {
      if (playingRef.current) return;
      setBusy(true);
      try {
        await send(command);
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  const play = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    try {
      while (playingRef.current) {
        const { intervalMs, barsPerTick } = playbackPlan(speedRef.current);
        const started = performance.now();
        const moved = await send({ kind: "BARS", count: barsPerTick });
        if (!moved) break; // end of the day's data, or an error
        const wait = intervalMs - (performance.now() - started);
        if (wait > 0) await sleep(wait);
      }
    } finally {
      playingRef.current = false;
      setPlaying(false);
      void loadCandles("reconcile");
    }
  }, [send, loadCandles]);

  const pause = useCallback(() => {
    // Nothing further is sent. A step already in flight completes; its
    // (authoritative) result is shown, then the chart reconciles.
    playingRef.current = false;
    setPlaying(false);
  }, []);

  async function start() {
    setBusy(true);
    const res = await initializeReplayAction({ runId: run.id, dateKey });
    setBusy(false);
    if (!res.success) toast.error(res.error);
    else setWorld(res.state);
  }

  // ── Keyboard: Space play/pause · → +1m · Shift+→ +1 candle · R return to replay ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        if (playingRef.current) pause();
        else if (canMove) void play();
      } else if (e.key === "ArrowRight" && canMove && !playingRef.current) {
        e.preventDefault();
        void run1(e.shiftKey ? { kind: "CANDLE", timeframe: viewRef.current.timeframe } : { kind: "BARS", count: 1 });
      } else if (e.key === "r" || e.key === "R") {
        chartRef.current?.scrollToReplay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canMove, pause, play, run1]);

  useEffect(() => () => {
    playingRef.current = false;
  }, []);

  // Stable chart callbacks (the chart never re-renders because of the parent).
  const onCrosshair = useCallback((info: CrosshairInfo) => {
    if (!info.candle) return setHover(null);
    const list = candlesRef.current;
    const i = list.findIndex((c) => c.time === info.candle!.time);
    setHover({ candle: info.candle, previousClose: i > 0 ? list[i - 1].close : null });
  }, []);
  const onNearLeftEdge = useCallback(() => void loadOlder(), [loadOlder]);
  const onFollowChange = useCallback((f: boolean) => setFollowing(f), []);

  const chooseAsset = (a: string) => {
    viewRef.current = { ...viewRef.current, asset: a };
    setAsset(a);
    setHover(null);
  };
  const chooseTimeframe = (tf: ReplayTimeframe) => {
    viewRef.current = { ...viewRef.current, timeframe: tf };
    setTimeframe(tf);
    setHover(null);
  };
  const chooseSpeed = (s: Speed) => {
    speedRef.current = s; // a running playback picks it up on its next tick
    setSpeed(s);
  };

  useEffect(() => {
    chartRef.current?.chart()?.applyOptions({ crosshair: { mode: magnet ? 1 : 0 } });
  }, [magnet]);

  const shown = hover?.candle ?? latest;
  const shownPrev = hover ? hover.previousClose : previousClose;
  const scale = 10 ** priceScale;
  const fmt = (v: number) => formatPrice(v / scale, priceScale);
  const change = shown && shownPrev != null ? shown.close - shownPrev : null;
  const sessionHref = `/backtesting/${run.id}/session?date=${dateKey}`;
  const replayHref = (d: string) => `/backtesting/${run.id}/replay?date=${d}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top toolbar ─────────────────────────────────────────────────── */}
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {/* Left: context (asset, timeframe, date) — the only part that scrolls on narrow screens. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        <Link href={sessionHref} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to the Backtesting Session">
          <ArrowLeft className="size-4" />
        </Link>
        <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground xl:inline" title={run.name}>{run.name}</span>
        <Divider />
        <label className="sr-only" htmlFor="nr-asset">Asset</label>
        <select id="nr-asset" value={asset} onChange={(e) => chooseAsset(e.target.value)} className="h-7 shrink-0 rounded-md border border-border bg-background px-1.5 text-sm font-semibold">
          {run.assets.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <div role="group" aria-label="Timeframe" className="flex shrink-0 items-center">
          {QUICK_TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" aria-pressed={timeframe === tf} onClick={() => chooseTimeframe(tf)} className={cn("h-7 rounded-md px-1.5 text-xs tabular-nums", timeframe === tf ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {tf}
            </button>
          ))}
          <label className="sr-only" htmlFor="nr-tf-more">More timeframes</label>
          <select id="nr-tf-more" value={MORE_TIMEFRAMES.includes(timeframe) ? timeframe : ""} onChange={(e) => e.target.value && chooseTimeframe(e.target.value as ReplayTimeframe)} className={cn("h-7 rounded-md bg-transparent px-1 text-xs", MORE_TIMEFRAMES.includes(timeframe) ? "font-semibold" : "text-muted-foreground")}>
            <option value="">More</option>
            {MORE_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>
        <Divider />
        <nav aria-label="Simulation date" className="flex shrink-0 items-center gap-0.5">
          <DayLink href={previousDateKey ? replayHref(previousDateKey) : null} label="Previous trading day"><ChevronLeft className="size-4" /></DayLink>
          <span className="px-1 text-xs tabular-nums" title={`Trading day ${dayIndex} of ${totalTradingDays}`}>{formatReplayTime(position?.minute ?? toMinute(dateKey)).slice(0, -6)}</span>
          <DayLink href={nextDateKey ? replayHref(nextDateKey) : null} label="Next trading day"><ChevronRight className="size-4" /></DayLink>
        </nav>
        <Divider />
        <p className="shrink-0 font-mono text-sm font-semibold tabular-nums" aria-hidden>
          {position ? position.time.slice(11) : "--:--"}
        </p>
        </div>
        {/* Right: replay controls — always visible. */}
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => run1({ kind: "BARS", count: 1 })} aria-label="Advance one minute (→)" title="+1m (→)">
            <StepForward /> <span className="max-xl:sr-only">1m</span>
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => run1({ kind: "BARS", count: 5 })} aria-label="Advance five minutes" title="+5m">
            5m
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => run1({ kind: "CANDLE", timeframe })} aria-label={`Advance one ${timeframe} candle (Shift+→)`} title={`+1 ${timeframe} candle (Shift+→)`}>
            <SkipForward /> <span className="max-xl:sr-only">{timeframe}</span>
          </Button>
          {playing ? (
            <Button type="button" size="sm" onClick={pause} aria-label="Pause (Space)" title="Pause (Space)"><Pause /> Pause</Button>
          ) : (
            <Button type="button" size="sm" disabled={!canMove || busy} onClick={() => void play()} aria-label="Play (Space)" title="Play (Space)"><Play /> Play</Button>
          )}
          <label className="sr-only" htmlFor="nr-speed">Replay speed</label>
          <select id="nr-speed" value={speed} onChange={(e) => chooseSpeed(Number(e.target.value) as Speed)} className="h-7 rounded-md border border-border bg-background px-1 text-xs tabular-nums 2xl:hidden">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
          <div role="group" aria-label="Replay speed" className="hidden items-center rounded-md border border-border 2xl:flex">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => chooseSpeed(s)} className={cn("h-6 px-1.5 text-[11px] tabular-nums first:rounded-l-md last:rounded-r-md", speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {s}x
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{2}:\d{2}$/.test(jumpTo)) void run1({ kind: "SEEK", to: `${dateKey}T${jumpTo}` });
            }}
          >
            <input type="time" aria-label="Jump to time (server time)" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} className="h-7 w-[6.75rem] rounded-md border border-border bg-background px-1.5 text-xs tabular-nums" />
            <Button type="submit" size="sm" variant="outline" disabled={!canMove || busy || playing || !jumpTo}>Jump</Button>
          </form>
          <Divider />
          <Button type="button" size="icon-sm" variant="ghost" aria-pressed={volume} onClick={() => setVolume((v) => !v)} aria-label="Toggle volume pane" title="Volume">
            <BarChart3 />
          </Button>
          <Button type="button" size="sm" variant={sessionOpen ? "secondary" : "ghost"} aria-pressed={sessionOpen} onClick={() => setSessionOpen((o) => !o)} aria-label={sessionOpen ? "Hide the Backtesting Session panel" : "Show the Backtesting Session panel"}>
            {sessionOpen ? <PanelRightClose /> : <PanelRightOpen />} <span className="max-lg:sr-only">Session</span>
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── Left tool rail (drawing tools arrive with the chart tools stage) ── */}
        <nav aria-label="Chart tools" className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          <button type="button" aria-pressed={!magnet} onClick={() => setMagnet(false)} title="Crosshair" aria-label="Crosshair" className={cn("inline-flex size-8 items-center justify-center rounded-md", !magnet ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Crosshair className="size-4" />
          </button>
          <button type="button" aria-pressed={magnet} onClick={() => setMagnet(true)} title="Magnet crosshair (snaps to OHLC)" aria-label="Magnet crosshair" className={cn("inline-flex size-8 items-center justify-center rounded-md", magnet ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Magnet className="size-4" />
          </button>
        </nav>

        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <main className="relative min-w-0 flex-1" aria-label="Replay chart">
          {world.status === "ACTIVE" && assetInfo?.dataset && (
            <div data-testid="nr-legend" className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] tabular-nums">
              <span className="font-sans text-xs font-semibold">{asset} · {timeframe}</span>
              {shown ? (
                <>
                  <span className="text-muted-foreground">{formatCrosshairTime(toChartTime(shown.time))}</span>
                  <span>O <span className="text-foreground">{fmt(shown.open)}</span></span>
                  <span>H <span className="text-foreground">{fmt(shown.high)}</span></span>
                  <span>L <span className="text-foreground">{fmt(shown.low)}</span></span>
                  <span>C <span className="text-foreground">{fmt(shown.close)}</span></span>
                  {change != null && shownPrev ? (
                    <span className={change >= 0 ? "text-emerald-500/80" : "text-red-400/80"}>
                      {change >= 0 ? "+" : ""}{fmt(change)} ({((change / shownPrev) * 100).toFixed(2)}%)
                    </span>
                  ) : null}
                  {shown.tickVolume != null && <span className="text-muted-foreground">Vol {shown.tickVolume}</span>}
                  {shown.state === "FORMING" && <span className="font-sans text-muted-foreground">forming</span>}
                </>
              ) : null}
            </div>
          )}

          <ReplayChart ref={chartRef} theme={resolvedTheme} priceScale={priceScale} showVolume={volume} onCrosshair={onCrosshair} onNearLeftEdge={onNearLeftEdge} onFollowChange={onFollowChange} />

          {loading && (
            <div className="absolute right-3 top-2 z-10 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" /> Loading candles…
            </div>
          )}
          {historyError && (
            <div className="absolute left-1/2 top-10 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-sm" role="alert">
              {historyError}
              <button type="button" className="underline underline-offset-2" onClick={() => void loadCandles("switch")}>Retry</button>
            </div>
          )}
          {!following && world.status === "ACTIVE" && (
            <Button type="button" size="sm" variant="secondary" className="absolute bottom-4 right-16 z-20 shadow" onClick={() => chartRef.current?.scrollToReplay()} title="Return to the replay position (R)">
              <Redo2 /> Return to replay
            </Button>
          )}
          {atDayEnd && world.status === "ACTIVE" && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-sm" role="status">
              End of available market data for {formatReplayTime(position!.minute).slice(0, -6)}
              {nextDateKey ? <> · <Link className="underline underline-offset-2" href={replayHref(nextDateKey)}>Next trading day</Link></> : null}
            </div>
          )}
          <EmptyState world={world} asset={asset} assetInfo={assetInfo} readOnly={readOnly} busy={busy} onStart={start} dateLabel={formatReplayTime(toMinute(dateKey)).slice(0, -6)} />
        </main>

        {/* ── Backtesting Session panel (the existing workflow, not a copy) ── */}
        <aside
          data-session-panel
          aria-label="Backtesting Session"
          inert={!sessionOpen}
          className={cn(
            "shrink-0 overflow-y-auto border-l border-border bg-background transition-[width] duration-200 motion-reduce:transition-none",
            "max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl",
            sessionOpen ? "w-full sm:w-[min(100%,26rem)] lg:w-[clamp(22rem,28vw,36rem)]" : "w-0 border-l-0",
          )}
        >
          <div className="min-w-[20rem] p-3">{sessionPanel}</div>
        </aside>
      </div>

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
        <p role="status" aria-live="polite" className="tabular-nums">
          {position
            ? `Replay ${formatReplayTime(position.minute)} (broker/server time) · ${position.revealedMinutes}/${world.day?.minutes ?? 0} minutes revealed${playing ? ` · playing ${speed}x` : ""}${readOnly ? " · read-only run" : ""}`
            : world.status === "NOT_STARTED"
              ? "Replay not started"
              : "No replay"}
        </p>
        {assetInfo?.latestBar && assetInfo.latestBar !== position?.time ? <span>· {asset} latest bar {assetInfo.latestBar.slice(11)}</span> : null}
        <span className="ml-auto hidden md:inline">Space play/pause · → +1m · Shift+→ +1 candle · R return to replay</span>
      </footer>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function DayLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return <span aria-disabled="true" aria-label={label} className="inline-flex size-7 items-center justify-center text-muted-foreground/40">{children}</span>;
  }
  return (
    <Link href={href} aria-label={label} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </Link>
  );
}

function EmptyState({
  world,
  asset,
  assetInfo,
  readOnly,
  busy,
  onStart,
  dateLabel,
}: {
  world: ReplayStateDTO;
  asset: string;
  assetInfo: ReplayStateDTO["assets"][number] | null;
  readOnly: boolean;
  busy: boolean;
  onStart: () => void;
  dateLabel: string;
}) {
  let body: React.ReactNode = null;
  if (world.status === "NO_DATASETS" || !assetInfo?.dataset) {
    body = (
      <>
        <p className="font-medium">No historical dataset attached to {asset}.</p>
        <Link href="/backtesting/data" className="text-sm underline underline-offset-2">Attach MT5 M1 data</Link>
      </>
    );
  } else if (world.status === "NO_BARS_FOR_DATE") {
    body = <p className="font-medium">No market data is available for {dateLabel}.</p>;
  } else if (world.status === "NOT_STARTED") {
    body = (
      <>
        <p className="font-medium">Replay not started for {dateLabel}</p>
        <p className="text-sm text-muted-foreground">Starts at the day&apos;s first bar ({world.day?.firstBar.slice(11)}, server time). Nothing later is revealed.</p>
        {!readOnly && (
          <Button type="button" onClick={onStart} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Start Replay
          </Button>
        )}
      </>
    );
  } else if (!assetInfo.day) {
    body = <p className="font-medium">No {asset} market data is available for {dateLabel}.</p>;
  }
  if (!body) return null;
  return <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 text-center">{body}</div>;
}

function toMinute(dateKey: string): number {
  return parseWallClock(`${dateKey}T00:00`) ?? 0;
}
