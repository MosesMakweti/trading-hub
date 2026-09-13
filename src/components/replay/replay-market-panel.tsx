"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { dateKeyToUtcDate } from "@/lib/date";
import { advanceReplayTradeExecution, getReplayCandles, updateReplayProgress } from "@/actions/replay.actions";
import { ReplayCandlestickChart, type ReplayChartMarker, type ReplayPriceLine } from "@/components/replay/replay-candlestick-chart";
import { ReplayDecisionPanel } from "@/components/replay/replay-decision-panel";
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
import type { ReplayReviewSessionDTO, ReplayTradeDTO } from "@/types/replay";

const ACTIVE_LIFECYCLES = new Set(["PLANNED", "PENDING", "OPEN", "PARTIALLY_CLOSED"]);

const DAY_MS = 86_400_000;
/** Base tick interval at 1x — a candle every 800ms feels like "watching the
 *  market," not an instant jump-cut. Speed scales this down. */
const BASE_TICK_MS = 800;

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Market Replay tab content (Stage 13) — owns the Replay Clock, fetches the
 * scoped asset's base-timeframe candles for the whole review period ONCE per
 * asset (prefetching is allowed, §20), and renders ONLY what
 * `buildHigherTimeframeView` says is visible at the clock's current time.
 * No component here decides visibility on its own.
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
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseCandles = useMemo(() => baseCandlesByAsset[clock.asset] ?? [], [baseCandlesByAsset, clock.asset]);

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

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Chart stays visually dominant (§34) — the decision/position panel is a sibling, never a modal over it. */}
        <div className="glass space-y-3 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                  title="Stage 17B — where this chart's candles actually came from."
                >
                  Data: {sourceLabelByAsset[clock.asset]}
                </span>
              )}
              {clock.playback === "FINISHED" && (
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  End of period
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
            </div>
          </div>

          {loading ? (
            <div className="flex h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading historical data…
            </div>
          ) : (
            <ReplayCandlestickChart candles={view.closed} currentTime={clock.currentTime} priceLines={priceLines} markers={markers} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
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
        </div>

        {!loading && (
          <ReplayDecisionPanel
            sessionId={session.id}
            asset={clock.asset}
            currentTime={clock.currentTime}
            executionPrice={executionPrice}
            strategies={strategies}
            activeTrade={activeTrade}
            onTradeChanged={upsertReplayTrade}
          />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/60 italic">
        Closed-candle semantics: only fully-closed {clock.timeframe} candles are shown — nothing still forming at{" "}
        {currentTimeLabel} is revealed.
      </p>
    </div>
  );
}
