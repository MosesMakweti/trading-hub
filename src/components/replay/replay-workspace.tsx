"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CandlestickChart, CircleCheck, Compass, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { formatDateKeyLong, formatDateKeyShort } from "@/lib/date";
import { completeReplayReviewSession, startReplayReviewSession, updateReplayReviewNotes } from "@/actions/replay.actions";
import { ReplayActualPeriodPanel } from "@/components/replay/replay-actual-period-panel";
import { ReplayMarketPanel } from "@/components/replay/replay-market-panel";
import type { HistoricalStrategyContextDTO, ReplayReviewSessionDTO, ReplayTradeDTO } from "@/types/replay";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  IN_PROGRESS: "bg-primary/15 text-primary",
  COMPLETED: "bg-success/15 text-success",
};

/**
 * Replay workspace shell (Stage 12 §9-10) — the durable architecture the
 * future candle/timeline replay engine will sit inside. The Main Replay Area
 * below is a clearly-labeled placeholder; nothing here simulates market time
 * yet. Framing throughout is deliberately "reconstruct your decisions as if
 * you were there again," never "find the best trades that happened" (§16).
 */
export function ReplayWorkspace({
  session,
  historicalStrategyContext,
  dailyPlanDateKeys,
  strategies,
  replayTrades,
  mt5ImportedSymbols,
}: {
  session: ReplayReviewSessionDTO;
  historicalStrategyContext: HistoricalStrategyContextDTO | null;
  dailyPlanDateKeys: string[];
  strategies: { id: string; name: string }[];
  replayTrades: ReplayTradeDTO[];
  mt5ImportedSymbols: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState("market-replay");
  const [pending, startTransition] = useTransition();
  const [notesSaved, setNotesSaved] = useState(true);

  // Today's Assets for Replay (§15): the session's own scope if narrowed,
  // else whichever assets were actually traded that period (from the frozen
  // baseline), else a small sensible default so the chart is never empty.
  const assetOptions =
    session.assetSymbols.length > 0
      ? session.assetSymbols
      : (session.actualBaselineSnapshot?.canonical.byAsset.map((a) => a.key) ?? []).length > 0
        ? session.actualBaselineSnapshot!.canonical.byAsset.map((a) => a.key)
        : ["XAUUSD", "EURUSD", "GBPUSD"];

  function start() {
    startTransition(async () => {
      const r = await startReplayReviewSession(session.id);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success("Review started — actual baseline computed.");
      router.refresh();
    });
  }

  function complete() {
    startTransition(async () => {
      const r = await completeReplayReviewSession(session.id);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success("Review completed.");
      router.refresh();
    });
  }

  async function saveNotes(content: unknown) {
    setNotesSaved(false);
    const r = await updateReplayReviewNotes(session.id, content);
    setNotesSaved(true);
    if (!r.success) toast.error(r.error);
    return r;
  }

  const periodLabel =
    session.reviewType === "WEEKLY"
      ? `Weekly Review · ${formatDateKeyLong(session.startDate)} – ${formatDateKeyLong(session.endDate)}`
      : `Monthly Review · ${formatDateKeyShort(session.startDate)} – ${formatDateKeyShort(session.endDate)}`;

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="glass space-y-2 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{periodLabel}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reconstruct your decisions using only what would have been known at that historical moment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("rounded-md px-2 py-1 text-xs font-medium", STATUS_BADGE[session.status])}>
              {session.status.replace("_", " ")}
            </span>
            {session.status === "DRAFT" && (
              <Button type="button" size="sm" className="gap-1.5" onClick={start} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Start Review
              </Button>
            )}
            {session.status === "IN_PROGRESS" && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={complete} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                <CircleCheck className="size-3.5" />
                Complete Review
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>Scope: {session.strategyName ?? "All Trading"}</span>
          {session.assetSymbols.length > 0 && (
            <span className="flex items-center gap-1">
              ·
              {session.assetSymbols.map((s) => {
                const style = TAG_STYLES[colorForName(s)];
                return (
                  <span key={s} className={cn("rounded border px-1.5 font-mono text-[11px]", style.chip)}>
                    {s}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="market-replay" className="gap-1.5">
              <CandlestickChart className="size-3.5" />
              Market Replay
            </TabsTrigger>
            <TabsTrigger value="actual" className="gap-1.5">
              <Compass className="size-3.5" />
              Actual Period
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="market-replay" className="mt-4">
          {/* Stage 21.1 §12 — Strategy, Market Plan, and Notes moved from
           *  separate outer tabs into the chart's own collapsible right
           *  panel (they compete with the chart less there, and Strategy/
           *  Market Plan are now correctly time-pinned to the Replay
           *  Clock's OWN current position rather than a fixed session-start
           *  snapshot). */}
          {/* Prompt 7 fix — `key={session.id}` forces React to fully
           *  UNMOUNT/REMOUNT this component when the trader navigates to a
           *  DIFFERENT review period client-side (Previous/Next period
           *  arrows, changing the WEEKLY/MONTHLY toggle or asset scope —
           *  all client-side `router.push()` calls, never a full page
           *  reload). Without this, React reuses the SAME component
           *  instance across the prop change, and every `useState`
           *  initializer here (clock position, revealed candles, playback
           *  state, ...) silently carries over from the OLD session —
           *  discovered live: switching periods left the Replay Clock and
           *  chart showing the PREVIOUS session's stale position/state
           *  under the new session's own period boundaries. */}
          <ReplayMarketPanel
            key={session.id}
            session={session}
            assetOptions={assetOptions}
            strategies={strategies}
            initialReplayTrades={replayTrades}
            historicalStrategyContext={historicalStrategyContext}
            notes={session.notes}
            notesSaved={notesSaved}
            onSaveNotes={saveNotes}
            mt5ImportedSymbols={mt5ImportedSymbols}
          />

          {/* A quick jump to any OTHER day's full Journal plan page for
           *  deeper reference — the Market Plan tab above covers the
           *  Clock's own current day inline. */}
          {dailyPlanDateKeys.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase">
                Jump to a day&apos;s full plan page
              </p>
              <div className="flex flex-wrap gap-1.5">
                {dailyPlanDateKeys.map((dk) => (
                  <Link
                    key={dk}
                    href={`/journal/${dk}`}
                    className="rounded-md border border-border bg-background/40 px-2 py-1 text-xs transition-colors hover:bg-accent/50"
                  >
                    {formatDateKeyShort(dk)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="actual" className="mt-4">
          <ReplayActualPeriodPanel baseline={session.actualBaselineSnapshot} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
