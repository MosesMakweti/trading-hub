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
  Database,
  FlaskConical,
  Keyboard,
  Loader2,
  LocateFixed,
  Lock,
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
  advanceReplayClockAction,
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
import { DataSourceSheet } from "@/components/replay/data-source/data-source-sheet";
import { utcDateToKey } from "@/lib/date";
import { aggregateCandles } from "@/domain/market-data/aggregation";
import { buildHigherTimeframeView, visibleCandles } from "@/domain/market-data/visible-candles";
import { resolveChartPriceFormat } from "@/domain/market-data/chart-price-precision";
import {
  computeNextHistoryChunk,
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
  mt5ImportedSymbols,
}: {
  session: ReplayReviewSessionDTO;
  assetOptions: string[];
  strategies: { id: string; name: string }[];
  initialReplayTrades: ReplayTradeDTO[];
  historicalStrategyContext: HistoricalStrategyContextDTO | null;
  notes: unknown;
  notesSaved: boolean;
  onSaveNotes: (content: unknown) => Promise<{ success: boolean; error?: string }>;
  /** The canonical symbols the trader has AT LEAST ONE MT5 import for
   *  (server-resolved, zero extra round trips) — narrows the §9 first-fetch
   *  gate to only the asset(s) where an MT5 choice is actually plausible,
   *  rather than every asset merely because the trader has imported
   *  something, somewhere, for an unrelated symbol. */
  mt5ImportedSymbols: string[];
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
  // Edge Review Replay Data Source §14 — "a session can deliberately choose
  // MT5 before its first candle fetch." An asset whose provenance was
  // already frozen in an EARLIER visit to this session needs no decision
  // (the auto-fetch just resumes that pinned source, exactly as before this
  // feature existed — §9 "existing frozen session" case). A brand-new asset
  // only pauses the auto-fetch when the trader has an MT5 import for THAT
  // exact symbol (`mt5ImportedSymbols`) — zero behavior change for every
  // trader who has never touched MT5 import, and no friction for an asset
  // an MT5 import couldn't plausibly serve anyway.
  const [sourceDecidedByAsset, setSourceDecidedByAsset] = useState<Record<string, boolean>>(() => {
    const decided: Record<string, boolean> = {};
    for (const asset of assetOptions) {
      decided[asset] = !mt5ImportedSymbols.includes(asset) || session.marketDataProvenance?.[asset] != null;
    }
    return decided;
  });
  const [dataSourceSheetOpen, setDataSourceSheetOpen] = useState(false);
  const [pinnedMt5DatasetByAsset, setPinnedMt5DatasetByAsset] = useState<Record<string, string | null>>(() => {
    const pinned: Record<string, string | null> = {};
    for (const asset of assetOptions) {
      const entry = session.marketDataProvenance?.[asset];
      pinned[asset] = entry?.providerId === "mt5-imported" ? (entry.datasetId ?? null) : null;
    }
    return pinned;
  });
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

  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Strict no-future-candle delivery (Prompt 5 §11) — the Play loop below
  // needs the LATEST clock state between its own async steps (a `setTimeout`
  // chain, not a plain interval — see that effect's own doc comment), so it
  // reads this ref rather than the possibly-stale closure value.
  const clockRef = useRef(clock);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);
  // Prompt 6 hardening (§19 reload/persistence) — the LAST position this
  // client successfully checkpointed to the server (by EITHER mechanism —
  // see `persistProgress`'s own doc comment), seeded from the persisted
  // resume point at mount. Deliberately tracked independently of
  // `revealForward`'s own reveals: those advance the AUTHORITATIVE
  // visibility boundary, which is a different, faster-moving thing than
  // "what was last actually checkpointed" — conflating the two let a
  // checkpoint silently regress when Play advanced entirely through
  // already-revealed data without needing a fresh reveal in between.
  const lastCheckpointedTimeRef = useRef(resume?.currentTime ?? periodStart);
  // Prompt 6 hardening (§7/§8) — guards against CONCURRENT advancement: a
  // rapid double-click on "Next" (or a manual Step landing mid-Play-tick)
  // can otherwise start a SECOND `revealForward` before the first one's
  // `apply()` has updated `clock`/`baseCandlesByAsset`, so both race from
  // the same stale snapshot — at best a redundant fetch, at worst two
  // overlapping `apply()` calls stepping from the same base and one of
  // them spuriously concluding "nothing new" and marking FINISHED even
  // though most of the review period is still ahead. Shared across
  // `next()`, `shiftDay()`, and the Play loop: whoever gets there first
  // runs; a concurrent caller is simply ignored (exactly like a disabled
  // button while a request is in flight) rather than racing.
  const advancingRef = useRef(false);

  const baseCandles = useMemo(() => baseCandlesByAsset[clock.asset] ?? [], [baseCandlesByAsset, clock.asset]);
  const annotations = useMemo(() => annotationsByAsset[clock.asset] ?? [], [annotationsByAsset, clock.asset]);
  const priceFormat = useMemo(() => resolveChartPriceFormat(clock.asset), [clock.asset]);

  // §16, corrected Prompt 6 §20 — "Locked for this replay" once candles
  // have ACTUALLY been served for this asset: either from an EARLIER visit
  // (the server-seeded provenance's own segments) or from this mount's own
  // reveal (tracked by `baseCandlesByAsset`, which only ever gains entries
  // from REAL candle results — see `mergeCandles`). Deliberately NOT
  // `loadedRangesByAsset`: that tracks what range was ASKED about (the
  // read-only history sweep runs unconditionally on mount and would
  // otherwise falsely "lock" every fresh session before a single candle
  // was ever shown). The server-side provenance check was fixed the same
  // way (`recordMarketDataProvenance` is now skipped for an empty result).
  const dataSourceLocked =
    (session.marketDataProvenance?.[clock.asset]?.segments.length ?? 0) > 0 || (baseCandlesByAsset[clock.asset]?.length ?? 0) > 0;

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

  /**
   * Strict no-future-candle delivery (Prompt 5 §5/§6/§9/§10) — the ONLY
   * function that reveals data the client didn't already have, and the
   * ONLY caller of `advanceReplayClockAction` (the sole path that can
   * extend a session's authoritative boundary forward — see that
   * function's own doc comment). Used by Step/Play when local data runs
   * out, and by seek-forward operations (jumpStart/shiftDay). Requests a
   * SMALL lookahead past `minTargetTime` first (enough for one more base
   * candle in the common, dense-data case), growing geometrically only if
   * that comes back empty (a real market gap — weekend/holiday) — so a
   * single Step typically reveals ~1 candle, while a gap is crossed in a
   * handful of round trips instead of dozens of empty single-minute ones.
   * Returns true once something new was actually revealed.
   */
  async function revealForward(asset: string, minTargetTime: number, timeframe: Timeframe): Promise<boolean> {
    const loadedSoFar = loadedRangesByAssetRef.current[asset] ?? [];
    const coveredThrough = loadedSoFar.length > 0 ? Math.max(...loadedSoFar.map((r) => r.to)) : periodStart - 1;
    let lookahead = timeframeToMs("1m");
    while (true) {
      const target = Math.min(Math.max(minTargetTime, coveredThrough + 1) + lookahead, periodEnd);
      const result = await advanceReplayClockAction({ sessionId: session.id, canonicalSymbol: asset, requestedTime: target, timeframe });
      if (!result.success) {
        toast.error(result.error.message);
        return false;
      }
      if (result.candles.length > 0) {
        setBaseCandlesByAsset((prev) => ({ ...prev, [asset]: mergeCandles(prev[asset] ?? [], result.candles) }));
        setLoadedRangesByAsset((prev) => ({
          ...prev,
          [asset]: mergeLoadedRange(prev[asset] ?? [], { from: coveredThrough + 1, to: result.currentTime }),
        }));
        if (result.sourceLabel) setSourceLabelByAsset((prev) => ({ ...prev, [asset]: result.sourceLabel! }));
        return true;
      }
      // Nothing revealed at this lookahead — either a real gap (try
      // further) or genuinely nothing left in the review period.
      if (target >= periodEnd) return false;
      lookahead = Math.min(lookahead * 8, 7 * DAY_MS);
    }
  }

  // Read-only historical re-fill (Stage 13 §8, reworked Stage 17B §23-24,
  // corrected Prompt 5 §8) — pulls ALREADY-AUTHORIZED candles for the
  // current asset up through the clock's own position, chunked to keep any
  // single request small. This can NEVER reveal anything new (the server
  // clips every response to the session's authoritative boundary
  // regardless of what's requested here, see `fetchReplayCandlesWithProvenance`'s
  // own doc comment) — it exists purely to rebuild client state (e.g.
  // after a page reload, §23) without an extra "how far have I gotten"
  // round trip. A brand-new session with nothing authorized yet falls
  // through to `revealForward`, which is the only thing that can make the
  // FIRST candle appear.
  useEffect(() => {
    if (!sourceDecidedByAsset[clock.asset]) {
      // §14 — waiting on the trader's explicit Data Source choice for this
      // asset before ever fetching a candle; see `sourceDecidedByAsset`'s
      // own doc comment above. Deferred a tick so this effect never calls
      // setState synchronously within its own body.
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;
    const asset = clock.asset;
    const startingRanges = loadedRangesByAssetRef.current[asset] ?? [];
    const isFreshAsset = startingRanges.length === 0;

    async function loadHistory(loaded: LoadedRange[]): Promise<void> {
      if (cancelled) return;
      const chunk = computeNextHistoryChunk(loaded, clock.currentTime, periodStart, periodEnd);
      if (!chunk) return;

      const result = await getReplayCandles({ sessionId: session.id, canonicalSymbol: asset, from: chunk.from, to: chunk.to });
      if (cancelled) return;
      if (!result.success) {
        setError(result.error.message);
        return;
      }

      const nextLoaded = mergeLoadedRange(loaded, chunk);
      setLoadedRangesByAsset((prev) => ({ ...prev, [asset]: nextLoaded }));
      setBaseCandlesByAsset((prev) => ({ ...prev, [asset]: mergeCandles(prev[asset] ?? [], result.candles) }));
      if (result.sourceLabel) setSourceLabelByAsset((prev) => ({ ...prev, [asset]: result.sourceLabel! }));
      await loadHistory(nextLoaded);
    }

    void (async () => {
      if (isFreshAsset) setLoading(true);
      setError(null);
      await loadHistory(startingRanges);
      if (cancelled) return;
      if ((baseCandlesByAssetRef.current[asset]?.length ?? 0) === 0) {
        // §21 — nothing has ever been authorized for this asset (a
        // brand-new session/asset, `replayCurrentTime` still null
        // server-side) — reveal the first real candle(s) explicitly, never
        // more than that until the trader actually steps forward.
        await revealForward(asset, periodStart, clock.timeframe);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.asset, sourceDecidedByAsset[clock.asset]]);

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
    // Prompt 6 hardening (§19 reload/persistence) — a Play/Step sequence
    // often advances entirely through data ALREADY revealed by an earlier
    // `revealForward` call, purely client-side (no server round trip per
    // tick — see the Play loop's own doc comment). That means the
    // server's OWN authoritative `replayCurrentTime` can lag behind the
    // client's true position. `updateReplayProgress` deliberately refuses
    // to move the checkpoint PAST the server's last-known boundary
    // (Prompt 5 §18 — it must never become a bypass for the strict
    // visibility boundary), so checkpointing a genuinely-forward position
    // through it would silently clamp the resume point backward on
    // pause/reload. Route a forward checkpoint through
    // `advanceReplayClockAction` instead — safe (bounded to period end,
    // and a cheap no-op fetch when the boundary is already there) and it
    // updates the SAME resume fields. Direction is judged against
    // `lastCheckpointedTimeRef` — this client's own record of what it last
    // successfully persisted — never against `revealForward`'s own
    // (separately-paced) reveals, which can legitimately race ahead of or
    // lag behind a checkpoint moment without meaning anything about
    // which persistence mechanism is safe to use here.
    const isForward = next.currentTime > lastCheckpointedTimeRef.current;
    const request = isForward
      ? advanceReplayClockAction({ sessionId: session.id, canonicalSymbol: next.asset, requestedTime: next.currentTime, timeframe: next.timeframe }).then(
          (r) => (r.success ? { success: true as const, checkpointedAt: r.currentTime } : { success: false as const, error: r.error.message }),
        )
      : updateReplayProgress(session.id, point).then((r) =>
          r.success ? { success: true as const, checkpointedAt: next.currentTime } : { success: false as const, error: r.error },
        );
    void request.then((r) => {
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      lastCheckpointedTimeRef.current = r.checkpointedAt;
    });
  }

  function apply(next: ReplayClockState, checkpoint = false) {
    setClock(next);
    advanceExecutionIfNeeded(next.currentTime);
    if (checkpoint) persistProgress(next);
  }

  /** The available timestamps for `asset`, recomputed FRESH from whatever
   *  `baseCandlesByAssetRef` currently holds — used right after
   *  `revealForward` merges new data in, since the memoized
   *  `availableTimestamps` above won't reflect that until the next render. */
  function freshTimestampsFor(asset: string, timeframe: Timeframe): number[] {
    return aggregateCandles(baseCandlesByAssetRef.current[asset] ?? [], timeframe).map((c) => c.timestamp + timeframeToMs(timeframe));
  }

  /**
   * Step forward (Prompt 5 §9/§10) — tries the LOCAL pure-clock transition
   * first (data the client already legitimately holds, zero round trip).
   * Only when that has nothing left (`advanceToNextCandle` left
   * `currentTime` unchanged) does it ask the server to reveal more via
   * `revealForward`, then retries locally against the freshly-merged data.
   * There is never a moment where the client holds a candle it hasn't
   * already applied — `revealForward` itself is what makes the new data
   * exist at all.
   */
  async function next() {
    const advanced = advanceToNextCandle(clock, availableTimestamps);
    if (advanced.currentTime !== clock.currentTime) {
      apply(advanced);
      return;
    }
    if (advancingRef.current) return; // an advance is already in flight — ignore this extra click
    advancingRef.current = true;
    try {
      const revealed = await revealForward(clock.asset, clock.currentTime + 1, clock.timeframe);
      if (!revealed) {
        apply({ ...clock, playback: "FINISHED" });
        return;
      }
      apply(advanceToNextCandle(clock, freshTimestampsFor(clock.asset, clock.timeframe)));
    } finally {
      advancingRef.current = false;
    }
  }
  function prev() {
    apply(retreatToPreviousCandle(clock, availableTimestamps));
  }
  function togglePlay() {
    apply(clock.playback === "PLAYING" ? pauseClock(clock) : playClock(clock), true);
  }
  /**
   * Discards client-held candles beyond `keepThrough` for `asset` (Prompt 6
   * §17 — a full Reset must not leave future-relative-to-the-reset-point
   * data sitting in React state even though the chart itself already
   * wouldn't render it). Deliberately used ONLY by a full reset
   * (`jumpStart`), never by ordinary single-step retreat (`prev`) or
   * backward day-nav — those revisit data the trader already legitimately
   * saw moving forward, so discarding and immediately re-fetching the same
   * already-authorized candles would serve no isolation purpose and would
   * only hurt the common step-back-then-forward case.
   */
  function discardFutureRelativeData(asset: string, keepThrough: number) {
    setBaseCandlesByAsset((prev) => ({ ...prev, [asset]: (prev[asset] ?? []).filter((c) => c.timestamp <= keepThrough) }));
    setLoadedRangesByAsset((prev) => ({
      ...prev,
      [asset]: (prev[asset] ?? []).filter((r) => r.from <= keepThrough).map((r) => ({ from: r.from, to: Math.min(r.to, keepThrough) })),
    }));
  }
  function jumpStart() {
    const next = jumpToStart(clock, availableTimestamps);
    discardFutureRelativeData(clock.asset, next.currentTime);
    apply(next, true);
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
  /** Day navigation (§12 — an explicit, deliberate seek). Backward stays
   *  purely local (every day the trader has already passed through is
   *  already safely held). Forward may need to reveal a day that hasn't
   *  been authorized yet — `revealForward` handles that exactly like Step
   *  does, just requesting further ahead in one go since the trader
   *  explicitly asked to skip to the next trading day, not one candle. */
  async function shiftDay(delta: 1 | -1) {
    let timestamps = availableTimestamps;
    if (delta === 1) {
      const targetDayStart = utcDayStart(clock.currentTime) + DAY_MS;
      const alreadyCovers = timestamps.some((t) => utcDayStart(t) === targetDayStart);
      if (!alreadyCovers) {
        if (advancingRef.current) return; // an advance is already in flight
        advancingRef.current = true;
        let revealed: boolean;
        try {
          revealed = await revealForward(clock.asset, Math.min(targetDayStart + DAY_MS - 1, periodEnd), clock.timeframe);
        } finally {
          advancingRef.current = false;
        }
        if (!revealed) return;
        timestamps = freshTimestampsFor(clock.asset, clock.timeframe);
      }
    }
    const days = [...new Set(timestamps.map(utcDayStart))].sort((a, b) => a - b);
    const currentDay = utcDayStart(clock.currentTime);
    const idx = days.indexOf(currentDay);
    const targetIdx = idx === -1 ? (delta === 1 ? 0 : days.length - 1) : idx + delta;
    const targetDay = days[targetIdx];
    if (targetDay == null) return;
    const dayTimestamps = timestamps.filter((t) => utcDayStart(t) === targetDay);
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

  // Playback timer (Prompt 5 §9/§11) — a recursive `setTimeout` chain, NOT a
  // plain `setInterval`: each tick may need to AWAIT a server round trip
  // (`revealForward`, exactly like Step) when local data runs out, and the
  // next tick must never be scheduled until that resolves — a plain
  // interval would fire the next tick regardless, racing ahead of
  // server-validated data. Speed still governs the delay BETWEEN ticks;
  // it never lets the client reveal more than one legitimate step's worth
  // per tick, even at 10x (§11 — "the client may receive only candles that
  // the server has legitimately advanced through").
  useEffect(() => {
    if (clock.playback !== "PLAYING") return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const current = clockRef.current;
      if (current.playback !== "PLAYING") return;

      let timestamps = freshTimestampsFor(current.asset, current.timeframe);
      let advanced = advanceToNextCandle(current, timestamps);
      if (advanced.currentTime === current.currentTime) {
        if (advancingRef.current) {
          // A manual Step/day-shift is already in flight — retry this
          // tick shortly rather than racing it (§7/§8 concurrency guard).
          if (!cancelled) playTimerRef.current = setTimeout(() => void tick(), 100);
          return;
        }
        advancingRef.current = true;
        let revealed: boolean;
        try {
          revealed = await revealForward(current.asset, current.currentTime + 1, current.timeframe);
        } finally {
          advancingRef.current = false;
        }
        if (cancelled || clockRef.current.playback !== "PLAYING") return; // paused/unmounted while waiting
        if (!revealed) {
          const finished = { ...current, playback: "FINISHED" as const };
          apply(finished);
          persistProgress(finished);
          return;
        }
        timestamps = freshTimestampsFor(current.asset, current.timeframe);
        advanced = advanceToNextCandle(current, timestamps);
      }

      // A timeframe switch mid-await doesn't pause (only asset-switch does,
      // via `changeAsset`'s own PAUSED transition — see that function's
      // doc comment), so it never cancels this tick. `advanced` was
      // computed against `current.timeframe`, captured BEFORE the await —
      // reapply whatever timeframe is CURRENT now so a switch that
      // happened while this tick was waiting on `revealForward` is never
      // silently reverted. `currentTime` itself stays a valid raw instant
      // under any timeframe (see `ReplayClockState`'s own doc comment), so
      // this is always safe, never a data-visibility change.
      apply({ ...advanced, timeframe: clockRef.current.timeframe });
      if (advanced.playback === "FINISHED") {
        persistProgress(advanced);
        return;
      }
      if (cancelled) return;
      playTimerRef.current = setTimeout(() => void tick(), BASE_TICK_MS / clockRef.current.speed);
    }

    playTimerRef.current = setTimeout(() => void tick(), BASE_TICK_MS / clock.speed);
    return () => {
      cancelled = true;
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.playback, clock.speed]);

  // Persist a checkpoint on unmount (leaving the tab/page) — a final
  // catch-all. Reads `clockRef.current`, NEVER the closed-over `clock`
  // (Prompt 7 fix — `useEffect(fn, [])`'s cleanup closure is fixed at
  // MOUNT time and never updates since this effect never re-runs; using
  // `clock` directly here silently checkpointed the trader's position from
  // when the page first loaded, not wherever they actually were when they
  // left — the exact opposite of what a "final catch-all" is for).
  useEffect(() => {
    return () => persistProgress(clockRef.current);
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
          {!sourceDecidedByAsset[clock.asset] ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-primary/40 px-2 text-[11px] text-primary"
              onClick={() => setDataSourceSheetOpen(true)}
            >
              <Database className="size-3.5" />
              Choose Data Source
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => setDataSourceSheetOpen(true)}
              title={dataSourceLocked ? "Locked for this replay" : "Change this asset's data source"}
            >
              {dataSourceLocked ? <Lock className="size-3.5" /> : <Database className="size-3.5" />}
              {dataSourceLocked ? "Locked" : "Data Source"}
            </Button>
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
            {!sourceDecidedByAsset[clock.asset] ? (
              <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <Database className="size-6" />
                <p>
                  You have MT5 data imported — choose a data source for {clock.asset} before Replay loads candles.
                </p>
                <Button type="button" size="sm" className="gap-1.5" onClick={() => setDataSourceSheetOpen(true)}>
                  <Database className="size-3.5" />
                  Choose Data Source
                </Button>
              </div>
            ) : loading ? (
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

      <DataSourceSheet
        open={dataSourceSheetOpen}
        onOpenChange={setDataSourceSheetOpen}
        sessionId={session.id}
        canonicalSymbol={clock.asset}
        nativeTimeframe={clock.timeframe}
        locked={dataSourceLocked}
        currentSourceLabel={sourceLabelByAsset[clock.asset] ?? null}
        currentDatasetId={pinnedMt5DatasetByAsset[clock.asset] ?? null}
        onSourceDecided={(importId) => {
          setPinnedMt5DatasetByAsset((prev) => ({ ...prev, [clock.asset]: importId }));
          setSourceDecidedByAsset((prev) => ({ ...prev, [clock.asset]: true }));
        }}
      />
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
