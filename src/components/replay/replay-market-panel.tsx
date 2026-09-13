"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Keyboard,
  Loader2,
  Minus,
  Pause,
  Play,
  RectangleHorizontal,
  SkipBack,
  SkipForward,
  Slash,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { dateKeyToUtcDate } from "@/lib/date";
import {
  advanceReplayTradeExecution,
  clearReplayAnnotations,
  createReplayAnnotation,
  deleteReplayAnnotation,
  getReplayCandles,
  getReplayTradeUnrealizedR,
  listReplayAnnotations,
  updateReplayProgress,
} from "@/actions/replay.actions";
import {
  ReplayCandlestickChart,
  type AnnotationPoint,
  type ReplayAnnotationShape,
  type ReplayChartMarker,
  type ReplayPriceLine,
} from "@/components/replay/replay-candlestick-chart";
import { ReplayDecisionPanel, type ChartPriceSelection } from "@/components/replay/replay-decision-panel";
import { ReplayDailyMarketPlanPanel } from "@/components/replay/replay-daily-market-plan-panel";
import { utcDateToKey } from "@/lib/date";
import { aggregateCandles } from "@/domain/market-data/aggregation";
import { buildHigherTimeframeView, visibleCandles } from "@/domain/market-data/visible-candles";
import {
  computeNextBackgroundChunk,
  computeNextFetchWindow,
  mergeLoadedRange,
  type LoadedRange,
} from "@/domain/market-data/replay-prefetch-window";
import { compareCandles } from "@/domain/market-data/candle";
import {
  PLAYBACK_SPEEDS,
  advanceToNextCandle,
  changeAsset,
  changeTimeframe,
  jumpToStart,
  pause as pauseClock,
  play as playClock,
  retreatToPreviousCandle,
  setSpeed,
  toResumePoint,
  type PlaybackSpeed,
  type ReplayClockState,
} from "@/domain/market-data/replay-clock";
import { TIMEFRAMES, timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";
import type { Candle } from "@/domain/market-data/candle";
import type { ReplayAnnotationDTO, ReplayReviewSessionDTO, ReplayTradeDTO } from "@/types/replay";

const ACTIVE_LIFECYCLES = new Set(["PLANNED", "PENDING", "OPEN", "PARTIALLY_CLOSED"]);

const DAY_MS = 86_400_000;
/** Base tick interval at 1x — a candle every 800ms feels like "watching the
 *  market," not an instant jump-cut. Speed scales this down. */
const BASE_TICK_MS = 800;

const SPEED_KEY_MAP: Record<string, PlaybackSpeed> = { "1": 1, "2": 2, "5": 5, "0": 10 };

type DrawingTool = "HORIZONTAL_LINE" | "TREND_LINE" | "RECTANGLE" | "TEXT" | null;

function isTypingTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Stage 18 §18 — narrow, shape-specific reads of an annotation's `geometry`
 *  JSON. The Zod boundary already guaranteed this shape at write time; this
 *  is defensive parsing on the read side only (never trusted as `any`). */
function readPoint(geometry: unknown): AnnotationPoint | null {
  if (typeof geometry !== "object" || geometry == null) return null;
  const g = geometry as Record<string, unknown>;
  return typeof g.time === "number" && typeof g.price === "number" ? { time: g.time, price: g.price } : null;
}
function readTwoPoint(geometry: unknown): { p1: AnnotationPoint; p2: AnnotationPoint } | null {
  if (typeof geometry !== "object" || geometry == null) return null;
  const g = geometry as Record<string, unknown>;
  const p1 = readPoint(g.p1);
  const p2 = readPoint(g.p2);
  return p1 && p2 ? { p1, p2 } : null;
}
function readPrice(geometry: unknown): number | null {
  if (typeof geometry !== "object" || geometry == null) return null;
  const g = geometry as Record<string, unknown>;
  return typeof g.price === "number" ? g.price : null;
}

/**
 * Market Replay tab content (Stage 13) — owns the Replay Clock, fetches the
 * scoped asset's base-timeframe candles for the whole review period ONCE per
 * asset (prefetching is allowed, §20), and renders ONLY what
 * `buildHigherTimeframeView` says is visible at the clock's current time.
 * No component here decides visibility on its own.
 *
 * Stage 18 extends this with: a bottom-dominant clock bar (chart stays
 * visually dominant, §3), a collapsible decision/position panel (§5),
 * keyboard shortcuts (§26), chart-assisted price selection (§12), and a
 * minimal drawing/annotation layer (§15) scoped per (session, asset).
 */
export function ReplayMarketPanel({
  session,
  assetOptions,
  strategies,
  initialReplayTrades,
}: {
  session: ReplayReviewSessionDTO;
  assetOptions: string[];
  strategies: { id: string; name: string }[];
  initialReplayTrades: ReplayTradeDTO[];
}) {
  const periodStart = dateKeyToUtcDate(session.startDate).getTime();
  const periodEnd = dateKeyToUtcDate(session.endDate).getTime() + DAY_MS - 1;
  const resume = session.replayResumePoint;
  const isCompleted = session.status === "COMPLETED";

  const initialAsset = resume?.asset ?? assetOptions[0] ?? session.assetSymbols[0] ?? "XAUUSD";
  const initialTimeframe: Timeframe = (resume?.timeframe as Timeframe) ?? "15m";

  const [clock, setClock] = useState<ReplayClockState>(() => ({
    periodStart,
    periodEnd,
    currentTime: resume?.currentTime ?? periodStart,
    asset: initialAsset,
    timeframe: initialTimeframe,
    playback: "PAUSED",
    speed: 1,
  }));
  const [baseCandlesByAsset, setBaseCandlesByAsset] = useState<Record<string, Candle[]>>({});
  const [loadedRangesByAsset, setLoadedRangesByAsset] = useState<Record<string, LoadedRange[]>>({});
  const [sourceLabelByAsset, setSourceLabelByAsset] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayTrades, setReplayTrades] = useState<ReplayTradeDTO[]>(initialReplayTrades);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [unrealizedR, setUnrealizedR] = useState<number | null>(null);

  // Stage 18 §12 — chart-assisted price selection, owned here since this
  // component also owns the chart's click handler.
  const [priceSelection, setPriceSelection] = useState<ChartPriceSelection>({ armedField: null, point: null, nonce: 0 });

  // Stage 18 §15-18 — annotations for the CURRENT asset only (isolated per
  // session+asset both client-side and server-side).
  const [annotationsByAsset, setAnnotationsByAsset] = useState<Record<string, ReplayAnnotationDTO[]>>({});
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null);
  const [pendingDrawingPoint, setPendingDrawingPoint] = useState<AnnotationPoint | null>(null);

  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseCandles = useMemo(() => baseCandlesByAsset[clock.asset] ?? [], [baseCandlesByAsset, clock.asset]);
  const annotations = useMemo(() => annotationsByAsset[clock.asset] ?? [], [annotationsByAsset, clock.asset]);

  // Refs so the execution-advance side effect (called from imperative event
  // handlers and the play-timer's setInterval closure) always sees the
  // latest values without re-subscribing on every render.
  const replayTradesRef = useRef(replayTrades);
  useEffect(() => {
    replayTradesRef.current = replayTrades;
  }, [replayTrades]);
  const baseCandlesByAssetRef = useRef(baseCandlesByAsset);
  useEffect(() => {
    baseCandlesByAssetRef.current = baseCandlesByAsset;
  }, [baseCandlesByAsset]);
  const loadedRangesByAssetRef = useRef(loadedRangesByAsset);
  useEffect(() => {
    loadedRangesByAssetRef.current = loadedRangesByAsset;
  }, [loadedRangesByAsset]);
  const assetRef = useRef(clock.asset);
  useEffect(() => {
    assetRef.current = clock.asset;
  }, [clock.asset]);

  function upsertReplayTrade(trade: ReplayTradeDTO) {
    setReplayTrades((prev) => {
      const idx = prev.findIndex((t) => t.id === trade.id);
      if (idx === -1) return [...prev, trade];
      const next = [...prev];
      next[idx] = trade;
      return next;
    });
  }

  /**
   * Runs the deterministic execution processor (Stage 14 §25) against
   * whatever NEWLY revealed 1m base candles exist for the active trade on
   * the currently-selected asset — never the trader's display timeframe
   * (§13), and never anything beyond `newTime` (§0) even though the whole
   * period's base candles are already prefetched client-side.
   */
  function advanceExecutionIfNeeded(newTime: number) {
    const asset = assetRef.current;
    const trade = replayTradesRef.current.find(
      (t) => t.assetSymbol === asset && t.decisionType === "TAKEN" && t.lifecycle !== "CLOSED" && t.lifecycle !== "CANCELLED",
    );
    if (!trade) return;
    const watermark = new Date(trade.lastProcessedTime ?? trade.historicalTimestamp).getTime();
    const base = baseCandlesByAssetRef.current[asset] ?? [];
    const candles = visibleCandles(base, newTime, "1m").filter((c) => c.timestamp > watermark);
    if (candles.length === 0) return;
    void advanceReplayTradeExecution(trade.id, { candles }).then((result) => {
      if (result.success) upsertReplayTrade(result.trade);
    });
  }

  // Chunked/prefetched candle loading (Stage 13 §8, reworked Stage 17B
  // §23-24) — replaces the old "fetch the whole review period in one
  // response" pattern. On asset switch, first loads a small ROLLING WINDOW
  // around the clock's current position (fast initial paint, bounded
  // request size against a real vendor), then keeps sweeping the REST of
  // the review period in small background chunks so whole-period features
  // (day navigation, jump-to-start) end up working exactly as before —
  // assembled from many small requests instead of one giant one. Replay
  // navigation still never triggers a NEW fetch itself; it only ever reads
  // from `baseCandlesByAsset`, which this effect alone appends to.
  useEffect(() => {
    let cancelled = false;
    const asset = clock.asset;
    const startingRanges = loadedRangesByAssetRef.current[asset] ?? [];
    const isFreshAsset = startingRanges.length === 0;

    async function loadNext(loaded: LoadedRange[], priorityPhase: boolean): Promise<void> {
      if (cancelled) return;
      const window = priorityPhase
        ? (computeNextFetchWindow(loaded, clock.currentTime, periodStart, periodEnd) ?? computeNextBackgroundChunk(loaded, periodStart, periodEnd))
        : computeNextBackgroundChunk(loaded, periodStart, periodEnd);
      if (!window) {
        if (priorityPhase && isFreshAsset) setLoading(false);
        return;
      }

      const result = await getReplayCandles({ sessionId: session.id, canonicalSymbol: asset, from: window.from, to: window.to });
      if (cancelled) return;
      if (!result.success) {
        setError(result.error.message);
        setLoading(false);
        return;
      }

      const nextLoaded = mergeLoadedRange(loaded, window);
      setLoadedRangesByAsset((prev) => ({ ...prev, [asset]: nextLoaded }));
      setBaseCandlesByAsset((prev) => {
        const merged = [...(prev[asset] ?? []), ...result.candles].sort(compareCandles);
        const deduped: Candle[] = [];
        for (const c of merged) {
          if (deduped.length > 0 && deduped[deduped.length - 1].timestamp === c.timestamp) continue;
          deduped.push(c);
        }
        return { ...prev, [asset]: deduped };
      });
      if (result.sourceLabel) setSourceLabelByAsset((prev) => ({ ...prev, [asset]: result.sourceLabel! }));
      if (priorityPhase && isFreshAsset && computeNextFetchWindow(nextLoaded, clock.currentTime, periodStart, periodEnd) == null) {
        setLoading(false);
      }
      // Keep going — the rolling window first, then the background sweep —
      // until the whole period is covered.
      void loadNext(nextLoaded, priorityPhase && computeNextFetchWindow(nextLoaded, clock.currentTime, periodStart, periodEnd) != null);
    }

    void (async () => {
      if (isFreshAsset) setLoading(true);
      setError(null);
      await loadNext(startingRanges, true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.asset]);

  // Stage 18 §29 — annotations load per (session, asset), same isolation
  // discipline as candles; switching assets never mixes drawings between them.
  useEffect(() => {
    let cancelled = false;
    void listReplayAnnotations(session.id, clock.asset).then((rows) => {
      if (!cancelled) setAnnotationsByAsset((prev) => ({ ...prev, [clock.asset]: rows }));
    });
    return () => {
      cancelled = true;
    };
  }, [session.id, clock.asset]);

  // Position at the first available candle once data for the initial asset
  // has loaded and there's no resume point to honor (§24). Guarded by
  // `positionedAssetsRef` so it fires exactly ONCE per asset — with §23-24's
  // incremental/chunked loading, `baseCandles.length` now changes many
  // times as background chunks keep arriving, and re-running `jumpToStart`
  // on every one of those would keep yanking the trader back to the start
  // mid-playback.
  const positionedAssetsRef = useRef(new Set<string>());
  useEffect(() => {
    if (resume || baseCandles.length === 0 || positionedAssetsRef.current.has(clock.asset)) return;
    positionedAssetsRef.current.add(clock.asset);
    const timestamps = aggregateCandles(baseCandles, clock.timeframe).map((c) => c.timestamp + timeframeToMs(clock.timeframe));
    setClock((prev) => jumpToStart(prev, timestamps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCandles.length, clock.asset]);

  const availableTimestamps = useMemo(
    () => aggregateCandles(baseCandles, clock.timeframe).map((c) => c.timestamp + timeframeToMs(clock.timeframe)),
    [baseCandles, clock.timeframe],
  );

  const view = useMemo(
    () => buildHigherTimeframeView(baseCandles, clock.currentTime, "1m", clock.timeframe),
    [baseCandles, clock.currentTime, clock.timeframe],
  );

  // The current execution price (§11/§13) — the last fully-closed 1m base
  // candle's close at or before the clock's current time. This, never a
  // display-timeframe close, is what a MARKET order fills at.
  const executionPrice = useMemo(() => {
    const visible = visibleCandles(baseCandles, clock.currentTime, "1m");
    return visible.length > 0 ? visible[visible.length - 1].close : null;
  }, [baseCandles, clock.currentTime]);

  const assetTrade = useMemo(
    () => replayTrades.find((t) => t.assetSymbol === clock.asset && t.decisionType === "TAKEN" && t.lifecycle !== "CANCELLED") ?? null,
    [replayTrades, clock.asset],
  );
  const activeTrade = useMemo(
    () => (assetTrade && ACTIVE_LIFECYCLES.has(assetTrade.lifecycle) ? assetTrade : null),
    [assetTrade],
  );

  // Stage 18 §21-22 — unrealized R, strictly from the current (visible-only)
  // execution price, via the server's own `rMultipleAt` domain function
  // (§41 — never computed here). `canShowUnrealized` is a pure derived
  // condition (no setState) — the effect below only ever fetches and sets a
  // real value when it's true; when it's false, the raw `unrealizedR` state
  // may be stale from a previous position, so the render below gates on
  // `canShowUnrealized` rather than relying on the effect to reset it.
  const canShowUnrealized = activeTrade != null && (activeTrade.lifecycle === "OPEN" || activeTrade.lifecycle === "PARTIALLY_CLOSED") && executionPrice != null;
  useEffect(() => {
    if (!canShowUnrealized) return;
    let cancelled = false;
    void getReplayTradeUnrealizedR(activeTrade!.id, executionPrice!).then((result) => {
      if (!cancelled && result.success) setUnrealizedR(result.r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShowUnrealized, activeTrade?.id, activeTrade?.currentStopLoss, executionPrice]);

  const priceLines = useMemo<ReplayPriceLine[]>(() => {
    if (!assetTrade) return [];
    const lines: ReplayPriceLine[] = [];
    if (assetTrade.plannedEntry != null) {
      lines.push({
        id: "entry",
        price: assetTrade.plannedEntry,
        color: "#0ea5e9",
        title: assetTrade.simulatedEntry != null ? "Entry (filled)" : "Entry (planned)",
      });
    }
    if (assetTrade.currentStopLoss != null) {
      lines.push({ id: "sl", price: assetTrade.currentStopLoss, color: "#ef4444", title: "Stop Loss" });
    }
    assetTrade.targets.forEach((t, i) => {
      lines.push({ id: `tp-${t.id}`, price: t.price, color: t.filledAt ? "#15803d" : "#22c55e", title: `TP${i + 1}${t.filledAt ? " ✓" : ""}` });
    });
    return lines;
  }, [assetTrade]);

  // Stage 18 §15 — HORIZONTAL_LINE drawings render through the exact same
  // IPriceLine mechanism as plan lines, kept in a SEPARATE prop/color so
  // they're visually and semantically distinct from plan/position levels.
  const drawingLines = useMemo<ReplayPriceLine[]>(() => {
    const lines: ReplayPriceLine[] = [];
    for (const a of annotations) {
      if (a.type !== "HORIZONTAL_LINE") continue;
      const price = readPrice(a.geometry);
      if (price != null) lines.push({ id: a.id, price, color: "#a78bfa", title: a.text ?? "", lineStyle: 2 });
    }
    return lines;
  }, [annotations]);

  const annotationShapes = useMemo<ReplayAnnotationShape[]>(() => {
    const out: ReplayAnnotationShape[] = [];
    for (const a of annotations) {
      if (a.type === "TREND_LINE" || a.type === "RECTANGLE") {
        const points = readTwoPoint(a.geometry);
        if (points) out.push({ id: a.id, type: a.type, p1: points.p1, p2: points.p2 });
      } else if (a.type === "TEXT") {
        const point = readPoint(a.geometry);
        if (point) out.push({ id: a.id, type: "TEXT", p1: point, text: a.text });
      }
    }
    // The in-progress first point of a two-point drawing, shown as a small
    // preview so the trader can see where the shape will start.
    if (pendingDrawingPoint && (drawingTool === "TREND_LINE" || drawingTool === "RECTANGLE")) {
      out.push({ id: "__pending__", type: drawingTool, p1: pendingDrawingPoint, p2: pendingDrawingPoint, selected: true });
    }
    return out;
  }, [annotations, pendingDrawingPoint, drawingTool]);

  const markers = useMemo<ReplayChartMarker[]>(() => {
    if (!assetTrade) return [];
    const out: ReplayChartMarker[] = [];
    if (assetTrade.filledAt) {
      out.push({
        time: new Date(assetTrade.filledAt).getTime(),
        color: "#0ea5e9",
        shape: assetTrade.direction === "SHORT" ? "arrowDown" : "arrowUp",
        text: "Fill",
        position: assetTrade.direction === "SHORT" ? "aboveBar" : "belowBar",
      });
    }
    for (const p of assetTrade.partialExits) {
      if (p.executedAt) out.push({ time: new Date(p.executedAt).getTime(), color: "#16a34a", shape: "circle", text: p.percentClosed != null ? `${p.percentClosed}%` : undefined });
    }
    if (assetTrade.closedAt) {
      out.push({
        time: new Date(assetTrade.closedAt).getTime(),
        color: assetTrade.realizedReplayR >= 0 ? "#16a34a" : "#ef4444",
        shape: "square",
        text: "Close",
      });
    }
    return out;
  }, [assetTrade]);

  function persistProgress(next: ReplayClockState) {
    const point = toResumePoint(next);
    void updateReplayProgress(session.id, point).then((r) => {
      if (!r.success) toast.error(r.error);
    });
  }

  function apply(next: ReplayClockState, checkpoint = false) {
    setClock(next);
    advanceExecutionIfNeeded(next.currentTime);
    if (checkpoint) persistProgress(next);
  }

  function next() {
    apply(advanceToNextCandle(clock, availableTimestamps));
  }
  function prev() {
    apply(retreatToPreviousCandle(clock, availableTimestamps));
  }
  function togglePlay() {
    apply(clock.playback === "PLAYING" ? pauseClock(clock) : playClock(clock), true);
  }
  function jumpStart() {
    apply(jumpToStart(clock, availableTimestamps), true);
  }
  function onSpeedChange(speed: PlaybackSpeed) {
    apply(setSpeed(clock, speed));
  }
  function onAssetChange(asset: string) {
    const assetBase = baseCandlesByAsset[asset] ?? [];
    const assetTimestamps = aggregateCandles(assetBase, clock.timeframe).map((c) => c.timestamp + timeframeToMs(clock.timeframe));
    apply(changeAsset(clock, asset, assetTimestamps), true);
    cancelChartTool();
  }
  function onTimeframeChange(timeframe: Timeframe) {
    apply(changeTimeframe(clock, timeframe), true);
  }
  function shiftDay(delta: 1 | -1) {
    const days = [...new Set(availableTimestamps.map(utcDayStart))].sort((a, b) => a - b);
    const currentDay = utcDayStart(clock.currentTime);
    const idx = days.indexOf(currentDay);
    const targetIdx = idx === -1 ? (delta === 1 ? 0 : days.length - 1) : idx + delta;
    const targetDay = days[targetIdx];
    if (targetDay == null) return;
    const dayTimestamps = availableTimestamps.filter((t) => utcDayStart(t) === targetDay);
    if (dayTimestamps.length === 0) return;
    apply({ ...clock, currentTime: delta === 1 ? dayTimestamps[0] : dayTimestamps[dayTimestamps.length - 1], playback: "PAUSED" }, true);
  }

  function cancelChartTool() {
    setDrawingTool(null);
    setPendingDrawingPoint(null);
    setPriceSelection((prev) => (prev.armedField ? { ...prev, armedField: null } : prev));
  }

  // Stage 18 §12/§15 — the single chart-click entry point. Price-selection
  // (armed by the decision form) takes priority; otherwise an active
  // drawing tool consumes the click; otherwise it's a no-op (ordinary chart
  // interaction, unaffected).
  function handleChartClick(point: AnnotationPoint) {
    if (isCompleted) return; // §35/§36 — no new mutations on a completed session
    if (priceSelection.armedField) {
      setPriceSelection((prev) => ({ ...prev, point, nonce: prev.nonce + 1 }));
      return;
    }
    if (!drawingTool) return;

    if (drawingTool === "HORIZONTAL_LINE") {
      void saveAnnotation({ type: "HORIZONTAL_LINE", geometry: { price: point.price } });
      return;
    }
    if (drawingTool === "TEXT") {
      const text = window.prompt("Note text:");
      if (text && text.trim()) void saveAnnotation({ type: "TEXT", geometry: point, text: text.trim() });
      setDrawingTool(null);
      return;
    }
    // TREND_LINE / RECTANGLE — two clicks.
    if (!pendingDrawingPoint) {
      setPendingDrawingPoint(point);
      return;
    }
    void saveAnnotation({ type: drawingTool, geometry: { p1: pendingDrawingPoint, p2: point } });
    setPendingDrawingPoint(null);
    setDrawingTool(null);
  }

  async function saveAnnotation(input: { type: "HORIZONTAL_LINE" | "TREND_LINE" | "RECTANGLE" | "TEXT"; geometry: unknown; text?: string }) {
    const result = await createReplayAnnotation({ sessionId: session.id, assetSymbol: clock.asset, ...input });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setAnnotationsByAsset((prev) => ({ ...prev, [clock.asset]: [...(prev[clock.asset] ?? []), result.annotation] }));
  }

  async function removeAnnotation(id: string) {
    const result = await deleteReplayAnnotation({ id });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setAnnotationsByAsset((prev) => ({ ...prev, [clock.asset]: (prev[clock.asset] ?? []).filter((a) => a.id !== id) }));
  }

  async function clearAllAnnotations() {
    const result = await clearReplayAnnotations({ sessionId: session.id, assetSymbol: clock.asset });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setAnnotationsByAsset((prev) => ({ ...prev, [clock.asset]: [] }));
  }

  // Playback timer — ticks at BASE_TICK_MS / speed, advancing one candle per
  // tick. Persists a checkpoint only when playback naturally stops (FINISHED
  // or an explicit pause), never on every tick.
  useEffect(() => {
    if (clock.playback !== "PLAYING") {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    playTimerRef.current = setInterval(() => {
      setClock((prev) => {
        const advanced = advanceToNextCandle(prev, availableTimestamps);
        advanceExecutionIfNeeded(advanced.currentTime);
        if (advanced.playback === "FINISHED") persistProgress(advanced);
        return advanced;
      });
    }, BASE_TICK_MS / clock.speed);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.playback, clock.speed, availableTimestamps]);

  // Persist a checkpoint on unmount (leaving the tab/page) — a final catch-all.
  useEffect(() => {
    return () => persistProgress(clock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage 18 §26 — keyboard shortcuts. Ignored while typing in any
  // input/textarea/contentEditable (repo-wide convention, see
  // command-center.tsx's isTypingTarget), and while the session is
  // completed (no mutating shortcuts should fire on a read-only review).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        cancelChartTool();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "ArrowLeft" && e.shiftKey) {
        shiftDay(-1);
        return;
      }
      if (e.key === "ArrowRight" && e.shiftKey) {
        shiftDay(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        prev();
        return;
      }
      if (e.key === "ArrowRight") {
        next();
        return;
      }
      if (e.key in SPEED_KEY_MAP) {
        onSpeedChange(SPEED_KEY_MAP[e.key]);
        return;
      }
      if (isCompleted) return; // remaining shortcuts arm mutating chart tools — never on a completed session
      if ((e.key === "e" || e.key === "E") && !activeTrade) {
        setPriceSelection((prevSel) => ({ ...prevSel, armedField: prevSel.armedField === "entry" ? null : "entry" }));
        return;
      }
      if ((e.key === "s" || e.key === "S") && !activeTrade) {
        setPriceSelection((prevSel) => ({ ...prevSel, armedField: prevSel.armedField === "stop" ? null : "stop" }));
        return;
      }
      if ((e.key === "t" || e.key === "T") && !activeTrade) {
        setPriceSelection((prevSel) => ({ ...prevSel, armedField: prevSel.armedField === "target-0" ? null : "target-0" }));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, availableTimestamps, activeTrade, isCompleted]);

  if (error) {
    return (
      <EmptyState
        icon={ChevronsLeft}
        title="Market data unavailable"
        description={error}
      />
    );
  }

  const currentDate = new Date(clock.currentTime);
  const currentTimeLabel = currentDate.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const activeToolLabel = priceSelection.armedField
    ? `Click chart to set ${priceSelection.armedField.startsWith("target") ? "target" : priceSelection.armedField}`
    : drawingTool === "TREND_LINE" || drawingTool === "RECTANGLE"
      ? pendingDrawingPoint
        ? "Click chart for the second point"
        : "Click chart for the first point"
      : drawingTool
        ? "Click chart to place"
        : null;

  return (
    <div className="space-y-2">
      <div className={cn("grid gap-2", !rightPanelCollapsed && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
        {/* Chart stays visually dominant (§3/§34) — the decision/position panel is a collapsible sibling, never a modal over it. */}
        <div className="glass space-y-2 rounded-2xl p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("rounded-md border px-2 py-0.5 font-mono text-xs", TAG_STYLES[colorForName(clock.asset)].chip)}>
                {clock.asset}
              </span>
              <span className="text-sm font-medium tabular-nums">{currentTimeLabel}</span>
              {sourceLabelByAsset[clock.asset] && (
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                    sourceLabelByAsset[clock.asset] === "Synthetic Fixture"
                      ? "border-dashed border-muted-foreground/30 text-muted-foreground"
                      : "border-primary/30 bg-primary/10 text-primary",
                  )}
                  title={
                    // Stage 17C.2 §33 — a concise, non-alarming OTC
                    // disclosure for Twelve Data-sourced assets specifically;
                    // every other source keeps the original generic tooltip.
                    // Never implies broker-exact execution for an OTC feed.
                    sourceLabelByAsset[clock.asset]?.startsWith("Twelve Data")
                      ? "Historical OTC market data may differ slightly from your broker's chart. Replay uses this feed for market reconstruction and review, not broker-exact execution."
                      : "Stage 17B — where this chart's candles actually came from."
                  }
                >
                  Data: {sourceLabelByAsset[clock.asset]}
                </span>
              )}
              {clock.playback === "FINISHED" && (
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  End of period
                </span>
              )}
              {isCompleted && (
                <span className="rounded-md border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Read-only — review completed
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {assetOptions.length > 1 && (
                <Select items={assetOptions.map((a) => ({ value: a, label: a }))} value={clock.asset} onValueChange={(v) => v && onAssetChange(v)}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assetOptions.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select items={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))} value={clock.timeframe} onValueChange={(v) => v && onTimeframeChange(v as Timeframe)}>
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf} value={tf}>
                      {tf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShowShortcutHelp((v) => !v)}>
                <Keyboard className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={rightPanelCollapsed ? "Expand decision panel" : "Collapse decision panel"}
                title={rightPanelCollapsed ? "Expand decision panel" : "Collapse decision panel"}
                onClick={() => setRightPanelCollapsed((v) => !v)}
                className="hidden lg:inline-flex"
              >
                {rightPanelCollapsed ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
              </Button>
            </div>
          </div>

          {showShortcutHelp && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border/60 bg-background/50 p-2 text-[11px] text-muted-foreground sm:grid-cols-3">
              <span><kbd className="rounded border px-1">Space</kbd> Play/Pause</span>
              <span><kbd className="rounded border px-1">←</kbd> Prev candle</span>
              <span><kbd className="rounded border px-1">→</kbd> Next candle</span>
              <span><kbd className="rounded border px-1">Shift+←</kbd> Prev day</span>
              <span><kbd className="rounded border px-1">Shift+→</kbd> Next day</span>
              <span><kbd className="rounded border px-1">1 2 5 0</kbd> Speed</span>
              <span><kbd className="rounded border px-1">E</kbd> Set entry (chart)</span>
              <span><kbd className="rounded border px-1">S</kbd> Set stop (chart)</span>
              <span><kbd className="rounded border px-1">T</kbd> Set target (chart)</span>
              <span><kbd className="rounded border px-1">Esc</kbd> Cancel tool</span>
            </div>
          )}

          {/* Stage 18 §15 — minimal annotation toolbar. */}
          {!isCompleted && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2">
              <ToolButton icon={Minus} label="Horizontal line" active={drawingTool === "HORIZONTAL_LINE"} onClick={() => setDrawingTool((t) => (t === "HORIZONTAL_LINE" ? null : "HORIZONTAL_LINE"))} />
              <ToolButton icon={Slash} label="Trend line" active={drawingTool === "TREND_LINE"} onClick={() => setDrawingTool((t) => (t === "TREND_LINE" ? null : "TREND_LINE"))} />
              <ToolButton icon={RectangleHorizontal} label="Rectangle / zone" active={drawingTool === "RECTANGLE"} onClick={() => setDrawingTool((t) => (t === "RECTANGLE" ? null : "RECTANGLE"))} />
              <ToolButton icon={Type} label="Text note" active={drawingTool === "TEXT"} onClick={() => setDrawingTool((t) => (t === "TEXT" ? null : "TEXT"))} />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" />}>
                  Drawings ({annotations.length})
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Drawings on {clock.asset}</DropdownMenuLabel>
                  {annotations.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">None yet</div>}
                  {annotations.map((a) => (
                    <DropdownMenuItem key={a.id} className="flex items-center justify-between gap-2" onSelect={(e) => e.preventDefault()}>
                      <span className="truncate text-xs">
                        {a.type === "TEXT" ? a.text || "Note" : a.type.replace("_", " ").toLowerCase()}
                      </span>
                      <button type="button" aria-label="Delete drawing" onClick={() => void removeAnnotation(a.id)}>
                        <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                  {annotations.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-danger" onClick={() => void clearAllAnnotations()}>
                        Clear all drawings on {clock.asset}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {activeToolLabel && (
                <span className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                  {activeToolLabel}
                  <button type="button" aria-label="Cancel tool" onClick={cancelChartTool}>
                    <X className="size-3" />
                  </button>
                </span>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading historical data…
            </div>
          ) : (
            <ReplayCandlestickChart
              candles={view.closed}
              currentTime={clock.currentTime}
              priceLines={priceLines}
              drawingLines={drawingLines}
              markers={markers}
              annotationShapes={annotationShapes}
              onChartClick={handleChartClick}
            />
          )}
        </div>

        {rightPanelCollapsed ? (
          <CollapsedPanelSummary asset={clock.asset} trade={assetTrade} onExpand={() => setRightPanelCollapsed(false)} />
        ) : (
          <ReplayDecisionPanel
            sessionId={session.id}
            asset={clock.asset}
            currentTime={clock.currentTime}
            executionPrice={executionPrice}
            unrealizedR={canShowUnrealized ? unrealizedR : null}
            strategies={strategies}
            activeTrade={activeTrade}
            onTradeChanged={upsertReplayTrade}
            priceSelection={priceSelection}
            onArmField={(field) => setPriceSelection((prevSel) => ({ ...prevSel, armedField: field }))}
          />
        )}
      </div>

      {/* Stage 18 §4/§25 — bottom-dominant clock/timeline bar, full width. */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-2.5">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Jump to start" onClick={jumpStart}>
            <ChevronsLeft className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous trading day" onClick={() => shiftDay(-1)}>
            <SkipBack className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Previous candle" onClick={prev}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" size="icon-sm" aria-label={clock.playback === "PLAYING" ? "Pause" : "Play"} onClick={togglePlay}>
            {clock.playback === "PLAYING" ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Next candle" onClick={next}>
            <ChevronRight className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Next trading day" onClick={() => shiftDay(1)}>
            <SkipForward className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Speed</span>
          {PLAYBACK_SPEEDS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={clock.speed === s ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => onSpeedChange(s)}
            >
              {s}×
            </Button>
          ))}
        </div>
      </div>

      <ReplayDailyMarketPlanPanel dateKey={utcDateToKey(currentDate)} assetSymbol={clock.asset} />

      <p className="text-[11px] text-muted-foreground/60 italic">
        Closed-candle semantics: only fully-closed {clock.timeframe} candles are shown — nothing still forming at{" "}
        {currentTimeLabel} is revealed.
      </p>
    </div>
  );
}

function ToolButton({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      <Icon className="size-3.5" />
    </Button>
  );
}

/** Stage 18 §5 — a compact summary badge preserving chart space when the
 *  decision/position panel is collapsed. */
function CollapsedPanelSummary({ asset, trade, onExpand }: { asset: string; trade: ReplayTradeDTO | null; onExpand: () => void }) {
  const label = !trade
    ? "No position"
    : trade.lifecycle === "PLANNED" || trade.lifecycle === "PENDING"
      ? trade.lifecycle
      : `${trade.direction === "SHORT" ? "Short" : "Long"} · ${trade.realizedReplayR >= 0 ? "+" : ""}${trade.realizedReplayR.toFixed(2)}R`;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="glass hidden w-10 flex-col items-center justify-start gap-2 rounded-2xl p-2 text-center lg:flex"
      title={`Expand decision panel — ${label}`}
    >
      <ChevronLeft className="size-4 text-muted-foreground" />
      <span className="rotate-180 text-[10px] font-medium whitespace-nowrap text-muted-foreground [writing-mode:vertical-rl]">
        {asset} · {label}
      </span>
    </button>
  );
}
