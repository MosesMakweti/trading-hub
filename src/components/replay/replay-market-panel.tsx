"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FlaskConical,
  Keyboard,
  Loader2,
  LocateFixed,
  Minus,
  MousePointer2,
  NotebookText,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
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
import { ReplayStrategyPanel } from "@/components/replay/replay-strategy-panel";
import { ReplayDailyMarketPlanPanel } from "@/components/replay/replay-daily-market-plan-panel";
import { utcDateToKey } from "@/lib/date";
import { aggregateCandles } from "@/domain/market-data/aggregation";
import { buildHigherTimeframeView, visibleCandles } from "@/domain/market-data/visible-candles";
import { resolveChartPriceFormat } from "@/domain/market-data/chart-price-precision";
import {
  computeNextBackgroundChunk,
  computeNextFetchWindow,
  mergeLoadedRange,
  type LoadedRange,
} from "@/domain/market-data/replay-prefetch-window";
import { mergeCandles } from "@/domain/market-data/candle";
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
import type { HistoricalStrategyContextDTO, ReplayAnnotationDTO, ReplayReviewSessionDTO, ReplayTradeDTO } from "@/types/replay";

const ACTIVE_LIFECYCLES = new Set(["PLANNED", "PENDING", "OPEN", "PARTIALLY_CLOSED"]);

const DAY_MS = 86_400_000;
/** Base tick interval at 1x — a candle every 800ms feels like "watching the
 *  market," not an instant jump-cut. Speed scales this down. */
const BASE_TICK_MS = 800;

const SPEED_KEY_MAP: Record<string, PlaybackSpeed> = { "1": 1, "2": 2, "5": 5, "0": 10 };

type DrawingTool = "HORIZONTAL_LINE" | "TREND_LINE" | "RECTANGLE" | "TEXT" | null;
type RightPanelTab = "trade" | "strategy" | "market-plan" | "notes";

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
 * Market Replay tab content — the Superchart workspace (Stage 21.1). Owns
 * the Replay Clock, fetches the scoped asset's base-timeframe candles for
 * the whole review period (chunked/prefetched, §20 of Stage 17B), and
 * renders ONLY what `buildHigherTimeframeView` says is visible at the
 * clock's current time. No component here decides visibility on its own.
 *
 * Stage 21.1 restructures the visual hierarchy around the chart (§4): a
 * slim top toolbar, a left vertical drawing rail (§10, replacing Stage 18's
 * horizontal tool strip), the chart itself full-height and visually
 * dominant, a collapsible tabbed right panel (§12 — Trade/Strategy/Market
 * Plan/Notes, replacing three separate outer tabs + a bottom strip), and a
 * bottom Replay controller (§14) with auto-follow (§17) and a 0.5x speed
 * (§15). The chart component itself now applies incremental updates
 * instead of a full redraw+viewport-reset on every tick (§16 — see
 * `replay-candlestick-chart.tsx`'s own doc comment for the bug this fixes).
 */
export function ReplayMarketPanel({
  session,
  assetOptions,
  strategies,
  initialReplayTrades,
  historicalStrategyContext,
  notes,
  notesSaved,
  onSaveNotes,
}: {
  session: ReplayReviewSessionDTO;
  assetOptions: string[];
  strategies: { id: string; name: string }[];
  initialReplayTrades: ReplayTradeDTO[];
  historicalStrategyContext: HistoricalStrategyContextDTO | null;
  notes: unknown;
  notesSaved: boolean;
  onSaveNotes: (content: unknown) => Promise<{ success: boolean; error?: string }>;
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
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("trade");
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [unrealizedR, setUnrealizedR] = useState<number | null>(null);
  // Stage 21.1 §17 — ON by default: the newest candle stays near the right
  // edge until the trader manually pans/zooms away (the chart reports that
  // via `onAutoFollowChange`, never flips this itself).
  const [autoFollow, setAutoFollow] = useState(true);

  // Stage 18 §12 — chart-assisted price selection, owned here since this
  // component also owns the chart's click handler.
  const [priceSelection, setPriceSelection] = useState<ChartPriceSelection>({ armedField: null, point: null, nonce: 0 });

  // Stage 18 §15-18 — annotations for the CURRENT asset only (isolated per
  // session+asset both client-side and server-side). Stage 21.1 §11 adds a
  // selected-drawing id (never persisted — purely a client interaction
  // state, cleared on asset/tool change).
  const [annotationsByAsset, setAnnotationsByAsset] = useState<Record<string, ReplayAnnotationDTO[]>>({});
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null);
  const [pendingDrawingPoint, setPendingDrawingPoint] = useState<AnnotationPoint | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseCandles = useMemo(() => baseCandlesByAsset[clock.asset] ?? [], [baseCandlesByAsset, clock.asset]);
  const annotations = useMemo(() => annotationsByAsset[clock.asset] ?? [], [annotationsByAsset, clock.asset]);
  const priceFormat = useMemo(() => resolveChartPriceFormat(clock.asset), [clock.asset]);

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
      setBaseCandlesByAsset((prev) => ({ ...prev, [asset]: mergeCandles(prev[asset] ?? [], result.candles) }));
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
      if (price != null) lines.push({ id: a.id, price, color: a.id === selectedAnnotationId ? "#3b82f6" : "#a78bfa", title: a.text ?? "", lineStyle: 2 });
    }
    return lines;
  }, [annotations, selectedAnnotationId]);

  const annotationShapes = useMemo<ReplayAnnotationShape[]>(() => {
    const out: ReplayAnnotationShape[] = [];
    for (const a of annotations) {
      if (a.type === "TREND_LINE" || a.type === "RECTANGLE") {
        const points = readTwoPoint(a.geometry);
        if (points) out.push({ id: a.id, type: a.type, p1: points.p1, p2: points.p2, selected: a.id === selectedAnnotationId });
      } else if (a.type === "TEXT") {
        const point = readPoint(a.geometry);
        if (point) out.push({ id: a.id, type: "TEXT", p1: point, text: a.text, selected: a.id === selectedAnnotationId });
      }
    }
    // The in-progress first point of a two-point drawing, shown as a small
    // preview so the trader can see where the shape will start.
    if (pendingDrawingPoint && (drawingTool === "TREND_LINE" || drawingTool === "RECTANGLE")) {
      out.push({ id: "__pending__", type: drawingTool, p1: pendingDrawingPoint, p2: pendingDrawingPoint, selected: true });
    }
    return out;
  }, [annotations, pendingDrawingPoint, drawingTool, selectedAnnotationId]);

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
    setSelectedAnnotationId(null);
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
    setSelectedAnnotationId((prev) => (prev === id ? null : prev));
  }

  async function clearAllAnnotations() {
    const result = await clearReplayAnnotations({ sessionId: session.id, assetSymbol: clock.asset });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setAnnotationsByAsset((prev) => ({ ...prev, [clock.asset]: [] }));
    setSelectedAnnotationId(null);
  }

  function selectDrawingTool(tool: Exclude<DrawingTool, null>) {
    setSelectedAnnotationId(null);
    setDrawingTool((t) => (t === tool ? null : tool));
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

  // Stage 18 §26, formalized/extended Stage 21.1 §24 — keyboard shortcuts.
  // Ignored while typing in any input/textarea/contentEditable (repo-wide
  // convention, see command-center.tsx's isTypingTarget), and while the
  // session is completed (no mutating shortcuts should fire on a read-only
  // review).
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnotationId && !isCompleted) {
        void removeAnnotation(selectedAnnotationId);
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
        return;
      }
      if (e.key === "h" || e.key === "H") {
        selectDrawingTool("HORIZONTAL_LINE");
        return;
      }
      if (e.key === "l" || e.key === "L") {
        selectDrawingTool("TREND_LINE");
        return;
      }
      if (e.key === "r" || e.key === "R") {
        selectDrawingTool("RECTANGLE");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, availableTimestamps, activeTrade, isCompleted, selectedAnnotationId]);

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
      {/* Stage 21.1 §5 — slim top toolbar: symbol, timeframe, source, tools. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/60 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {assetOptions.length > 1 ? (
            <Select items={assetOptions.map((a) => ({ value: a, label: a }))} value={clock.asset} onValueChange={(v) => v && onAssetChange(v)}>
              <SelectTrigger className="h-7 w-24 text-xs">
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
          ) : (
            <span className={cn("rounded-md border px-2 py-0.5 font-mono text-xs", TAG_STYLES[colorForName(clock.asset)].chip)}>{clock.asset}</span>
          )}

          {/* §6 — frequently-used timeframes as one quick segmented row instead of a dropdown. */}
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/40 p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                  clock.timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {tf}
              </button>
            ))}
          </div>

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
                // Stage 17C.2 §33 — a concise, non-alarming OTC disclosure
                // for Twelve Data-sourced assets specifically; every other
                // source keeps the original generic tooltip. Never implies
                // broker-exact execution for an OTC feed.
                sourceLabelByAsset[clock.asset]?.startsWith("Twelve Data")
                  ? "Historical OTC market data may differ slightly from your broker's chart. Replay uses this feed for market reconstruction and review, not broker-exact execution."
                  : "Stage 17B — where this chart's candles actually came from."
              }
            >
              Data: {sourceLabelByAsset[clock.asset]}
            </span>
          )}
          {clock.playback === "FINISHED" && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">End of period</span>
          )}
          {isCompleted && (
            <span className="rounded-md border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Read-only — review completed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!autoFollow && (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setAutoFollow(true)}>
              <LocateFixed className="size-3.5" />
              Jump to current
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShowShortcutHelp((v) => !v)}>
            <Keyboard className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={rightPanelCollapsed ? "Expand panel" : "Collapse panel"}
            title={rightPanelCollapsed ? "Expand panel" : "Collapse panel"}
            onClick={() => setRightPanelCollapsed((v) => !v)}
            className="hidden lg:inline-flex"
          >
            {rightPanelCollapsed ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
          </Button>
        </div>
      </div>

      {showShortcutHelp && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border/60 bg-background/50 p-2 text-[11px] text-muted-foreground sm:grid-cols-4">
          <span><kbd className="rounded border px-1">Space</kbd> Play/Pause</span>
          <span><kbd className="rounded border px-1">←</kbd> Prev candle</span>
          <span><kbd className="rounded border px-1">→</kbd> Next candle</span>
          <span><kbd className="rounded border px-1">Shift+←/→</kbd> Prev/next day</span>
          <span><kbd className="rounded border px-1">1 2 5 0</kbd> Speed</span>
          <span><kbd className="rounded border px-1">E</kbd> Set entry (chart)</span>
          <span><kbd className="rounded border px-1">S</kbd> Set stop (chart)</span>
          <span><kbd className="rounded border px-1">T</kbd> Set target (chart)</span>
          <span><kbd className="rounded border px-1">H</kbd> Horizontal line</span>
          <span><kbd className="rounded border px-1">L</kbd> Trend line</span>
          <span><kbd className="rounded border px-1">R</kbd> Rectangle</span>
          <span><kbd className="rounded border px-1">Del</kbd> Delete selected drawing</span>
          <span><kbd className="rounded border px-1">Esc</kbd> Cancel tool / deselect</span>
        </div>
      )}

      <div className="flex gap-2">
        {/* Stage 21.1 §10 — left vertical drawing rail (was a horizontal strip). */}
        {!isCompleted && (
          <div className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-background/60 p-1">
            <RailToolButton icon={MousePointer2} label="Select (Esc)" active={!drawingTool && !priceSelection.armedField} onClick={cancelChartTool} />
            <div className="my-0.5 h-px w-5 bg-border/60" />
            <RailToolButton icon={Minus} label="Horizontal line (H)" active={drawingTool === "HORIZONTAL_LINE"} onClick={() => selectDrawingTool("HORIZONTAL_LINE")} />
            <RailToolButton icon={Slash} label="Trend line (L)" active={drawingTool === "TREND_LINE"} onClick={() => selectDrawingTool("TREND_LINE")} />
            <RailToolButton icon={RectangleHorizontal} label="Rectangle / zone (R)" active={drawingTool === "RECTANGLE"} onClick={() => selectDrawingTool("RECTANGLE")} />
            <RailToolButton icon={Type} label="Text note" active={drawingTool === "TEXT"} onClick={() => selectDrawingTool("TEXT")} />
            <div className="my-0.5 h-px w-5 bg-border/60" />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Drawings (${annotations.length})`} title={`Drawings (${annotations.length})`} />}>
                <span className="text-[10px] font-semibold">{annotations.length}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right">
                <DropdownMenuLabel>Drawings on {clock.asset}</DropdownMenuLabel>
                {annotations.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">None yet</div>}
                {annotations.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    className={cn("flex items-center justify-between gap-2", a.id === selectedAnnotationId && "bg-primary/10")}
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => setSelectedAnnotationId((prev) => (prev === a.id ? null : a.id))}
                  >
                    <span className="truncate text-xs">{a.type === "TEXT" ? a.text || "Note" : a.type.replace("_", " ").toLowerCase()}</span>
                    <button type="button" aria-label="Delete drawing" onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id); }}>
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
          </div>
        )}

        {/* Chart stays visually dominant (§4) — the tabbed panel is a collapsible sibling, never a modal over it. */}
        <div className={cn("grid min-w-0 flex-1 gap-2", !rightPanelCollapsed && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-background/30">
            {activeToolLabel && (
              <div className="flex items-center gap-1.5 border-b border-border/50 bg-primary/5 px-2 py-1 text-[11px] text-primary">
                {activeToolLabel}
                <button type="button" aria-label="Cancel tool" onClick={cancelChartTool}>
                  <X className="size-3" />
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex h-[520px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading historical data…
              </div>
            ) : (
              <ReplayCandlestickChart
                candles={view.closed}
                priceFormat={priceFormat}
                priceLines={priceLines}
                drawingLines={drawingLines}
                markers={markers}
                annotationShapes={annotationShapes}
                autoFollow={autoFollow}
                onAutoFollowChange={setAutoFollow}
                height={520}
                onChartClick={handleChartClick}
              />
            )}
          </div>

          {rightPanelCollapsed ? (
            <CollapsedPanelSummary asset={clock.asset} trade={assetTrade} onExpand={() => setRightPanelCollapsed(false)} />
          ) : (
            <div className="min-w-0 rounded-xl border border-border/50 bg-background/40 p-2">
              <Tabs value={rightPanelTab} onValueChange={(v) => setRightPanelTab(v as RightPanelTab)}>
                <TabsList className="w-full">
                  <TabsTrigger value="trade" className="gap-1 text-xs" title="Trade">
                    <ClipboardList className="size-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="strategy" className="gap-1 text-xs" title="Strategy">
                    <FlaskConical className="size-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="market-plan" className="gap-1 text-xs" title="Market Plan">
                    <CalendarDays className="size-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="gap-1 text-xs" title="Notes">
                    <NotebookText className="size-3.5" />
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="trade" className="mt-2">
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
                </TabsContent>
                <TabsContent value="strategy" className="mt-2">
                  <ReplayStrategyPanel initialContext={historicalStrategyContext} strategyId={session.strategyId} atTime={clock.currentTime} />
                </TabsContent>
                <TabsContent value="market-plan" className="mt-2">
                  <ReplayDailyMarketPlanPanel dateKey={utcDateToKey(currentDate)} assetSymbol={clock.asset} />
                </TabsContent>
                <TabsContent value="notes" className="mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Observations, recurring mistakes, questions to investigate.</p>
                    <span className="text-[10px] text-muted-foreground/60">{notesSaved ? "Saved" : "Saving…"}</span>
                  </div>
                  <RichTextEditor initialContent={notes} placeholder="What did you notice reviewing this period?" onSave={onSaveNotes} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      {/* Stage 21.1 §14 — bottom Replay controller, full width. */}
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

      <p className="text-[11px] text-muted-foreground/60 italic">
        Closed-candle semantics: only fully-closed {clock.timeframe} candles are shown — nothing still forming at{" "}
        {currentTimeLabel} is revealed.
      </p>
    </div>
  );
}

function RailToolButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant={active ? "default" : "ghost"} size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      <Icon className="size-3.5" />
    </Button>
  );
}

/** A compact summary badge preserving chart space when the right panel is collapsed. */
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
      className="hidden w-10 flex-col items-center justify-start gap-2 rounded-xl border border-border/50 bg-background/40 p-2 text-center lg:flex"
      title={`Expand panel — ${label}`}
    >
      <ChevronLeft className="size-4 text-muted-foreground" />
      <span className="rotate-180 text-[10px] font-medium whitespace-nowrap text-muted-foreground [writing-mode:vertical-rl]">
        {asset} · {label}
      </span>
    </button>
  );
}
