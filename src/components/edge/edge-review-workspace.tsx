"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, History, Loader2, Sparkles, TrendingUp, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { EmptyState } from "@/components/shared/empty-state";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { formatDateKeyLong, formatDateKeyShort } from "@/lib/date";
import { startReplayReviewForPeriod } from "@/actions/replay.actions";
import { ReplayWorkspace } from "@/components/replay/replay-workspace";
import { Mt5ImportWizard } from "@/components/replay/data-source/mt5-import-wizard";
import { EdgeOverviewPanel } from "@/components/edge/edge-overview-panel";
import { EdgeComparisonPanel } from "@/components/edge/edge-comparison-panel";
import { EdgeImprovementsPanel } from "@/components/edge/edge-improvements-panel";
import { EdgeAnalystPanel } from "@/components/edge/edge-analyst-panel";
import type {
  HistoricalStrategyContextDTO,
  ReplayActualBaseline,
  ReplayReviewSessionDTO,
  ReplayReviewType,
  ReplayTradeDTO,
} from "@/types/replay";
import type { ActualVsReplayComparison } from "@/domain/replay-comparison/types";
import type { ImprovementsSynthesis } from "@/domain/replay-improvements/types";
import type { EdgeReviewCommitmentDTO } from "@/types/edge-improvements";

const ALL = "__all__";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

/**
 * Edge Review workspace (Stage 12.5) — one continuous review process across
 * four stages: Overview, Replay, Comparison, Improvements. The Stage 12
 * ReplayReviewSession backs the whole thing (session status IS the review's
 * status — see this stage's completion report for why that's not a second
 * state machine); the frozen `actualBaselineSnapshot` is shared truth
 * between Overview and Replay (and, later, Comparison) rather than
 * recomputed per tab.
 */
export function EdgeReviewWorkspace({
  reviewType,
  period,
  startDate,
  endDate,
  session,
  baseline,
  isLive,
  historicalStrategyContext,
  dailyPlanDateKeys,
  replayTradeCount,
  replayTrades,
  comparison,
  improvementsSynthesis,
  commitments,
  carryForwardCandidates,
  weeklyReview,
  strategies,
  assets,
  strategyId,
  assetSymbols,
  initialTab,
  mt5ImportedSymbols,
}: {
  reviewType: ReplayReviewType;
  period: string;
  startDate: string;
  endDate: string;
  session: ReplayReviewSessionDTO | null;
  baseline: ReplayActualBaseline;
  isLive: boolean;
  historicalStrategyContext: HistoricalStrategyContextDTO | null;
  dailyPlanDateKeys: string[];
  replayTradeCount: number;
  replayTrades: ReplayTradeDTO[];
  comparison: ActualVsReplayComparison;
  improvementsSynthesis: ImprovementsSynthesis;
  commitments: EdgeReviewCommitmentDTO[];
  carryForwardCandidates: EdgeReviewCommitmentDTO[];
  weeklyReview: { wentWell: unknown; toImprove: unknown; focusNextWeek: unknown };
  strategies: { id: string; name: string }[];
  assets: string[];
  strategyId: string | null;
  assetSymbols: string[];
  initialTab: "overview" | "replay" | "comparison" | "improvements" | "analyst";
  mt5ImportedSymbols: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [starting, startTransition] = useTransition();
  // A trader who has never imported MT5 data for a given symbol before has
  // no way to reach the import wizard from inside a Replay session: that
  // session's own "Choose Data Source" pause only triggers when an MT5
  // import for the asset ALREADY exists (see ReplayMarketPanel's
  // `sourceDecidedByAsset`), so the very first-ever import for a symbol
  // must happen somewhere session-independent. `Mt5ImportWizard` itself has
  // no session dependency (just user-scoped actions), so it's reused here
  // as-is, standalone, ahead of ever opening Replay for that symbol.
  const [mt5SheetOpen, setMt5SheetOpen] = useState(false);

  function navigate(next: { period?: string; type?: ReplayReviewType; strategy?: string | null; assets?: string[] }) {
    const params = new URLSearchParams();
    params.set("period", next.period ?? period);
    params.set("type", next.type ?? reviewType);
    const nextStrategy = next.strategy !== undefined ? next.strategy : strategyId;
    if (nextStrategy) params.set("strategy", nextStrategy);
    const nextAssets = next.assets ?? assetSymbols;
    if (nextAssets.length > 0) params.set("assets", nextAssets.join(","));
    router.push(`/edge?${params.toString()}`);
  }

  function shiftPeriod(delta: number) {
    if (reviewType === "WEEKLY") {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + delta * 7);
      navigate({ period: d.toISOString().slice(0, 10) });
    } else {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + delta);
      navigate({ period: d.toISOString().slice(0, 10) });
    }
  }

  function startReview() {
    startTransition(async () => {
      const result = await startReplayReviewForPeriod({
        reviewType,
        startDate,
        endDate,
        strategyId,
        assetSymbols,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Review started — actual baseline computed.");
      router.refresh();
    });
  }

  const periodLabel =
    reviewType === "WEEKLY"
      ? `${formatDateKeyShort(startDate)} – ${formatDateKeyShort(endDate)}`
      : formatDateKeyLong(startDate).split(",").slice(1).join(",").trim() || formatDateKeyShort(startDate);

  return (
    <div className="space-y-5">
      <div className="glass space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="bg-brand-gradient inline-flex size-8 items-center justify-center rounded-lg text-white shadow-glow">
              <TrendingUp className="size-4" />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Edge — {reviewType === "WEEKLY" ? "Weekly" : "Monthly"} Review
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">{periodLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous period" onClick={() => shiftPeriod(-1)}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Next period" onClick={() => shiftPeriod(1)}>
              <ChevronRight />
            </Button>
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
              {session ? STATUS_LABEL[session.status] : "Not started"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["WEEKLY", "MONTHLY"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => t !== reviewType && navigate({ type: t })}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  t === reviewType ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {t === "WEEKLY" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>

          <Select
            items={[{ value: ALL, label: "All Trading" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
            value={strategyId ?? ALL}
            onValueChange={(v) => navigate({ strategy: v === ALL || v == null ? null : v })}
          >
            <SelectTrigger className={cn("h-8 text-xs", strategyId && "border-primary/50")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Trading</SelectItem>
              {strategies.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-40">
            <AssetTagInput
              value={assetSymbols}
              onChange={(next) => navigate({ assets: next })}
              placeholder={assets.length > 0 ? `Asset scope — e.g. ${assets[0]}` : "Asset scope (optional)"}
            />
          </div>

          {assetSymbols.length > 0 && (
            <div className="flex gap-1">
              {assetSymbols.map((s) => {
                const style = TAG_STYLES[colorForName(s)];
                return (
                  <span key={s} className={cn("rounded border px-1.5 text-[11px] font-mono", style.chip)}>
                    {s}
                  </span>
                );
              })}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            onClick={() => setMt5SheetOpen(true)}
          >
            <Upload className="size-3.5" />
            Import MT5 Data
          </Button>
        </div>
      </div>

      <Sheet open={mt5SheetOpen} onOpenChange={setMt5SheetOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg">
          <SheetHeader className="px-0">
            <SheetTitle>Import MT5 Data</SheetTitle>
            <SheetDescription>
              Import a candle export from MT5 so it&apos;s available to pick as a Replay data source for any session.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <Mt5ImportWizard
              canonicalSymbolHint=""
              onImported={() => {
                toast.success("MT5 data imported — available in “Choose Data Source” for a new Replay session.");
                setMt5SheetOpen(false);
                router.refresh();
              }}
              onCancel={() => setMt5SheetOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="replay" className="gap-1.5">
            <History className="size-3.5" />
            Replay
          </TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
          <TabsTrigger value="improvements">Improvements</TabsTrigger>
          <TabsTrigger value="analyst" className="gap-1.5">
            <Sparkles className="size-3.5" />
            Analyst
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <EdgeOverviewPanel baseline={baseline} isLive={isLive} />
        </TabsContent>

        <TabsContent value="replay" className="mt-4">
          {session ? (
            <ReplayWorkspace
              session={session}
              historicalStrategyContext={historicalStrategyContext}
              dailyPlanDateKeys={dailyPlanDateKeys}
              strategies={strategies}
              replayTrades={replayTrades}
              mt5ImportedSymbols={mt5ImportedSymbols}
            />
          ) : (
            <EmptyState
              icon={History}
              title="No Replay review started for this period yet"
              description="Reconstruct your decisions as if you were there again — freeze the actual baseline and open the Replay workspace."
              action={
                <Button type="button" className="gap-1.5" onClick={startReview} disabled={starting}>
                  {starting && <Loader2 className="size-3.5 animate-spin" />}
                  Start Replay Review
                </Button>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="comparison" className="mt-4">
          <EdgeComparisonPanel sessionId={session?.id ?? null} replayTradeCount={replayTradeCount} comparison={comparison} />
        </TabsContent>

        <TabsContent value="improvements" className="mt-4">
          <EdgeImprovementsPanel
            session={session}
            reviewType={reviewType}
            startDate={startDate}
            comparison={comparison}
            synthesis={improvementsSynthesis}
            commitments={commitments}
            carryForwardCandidates={carryForwardCandidates}
            weeklyReview={weeklyReview}
          />
        </TabsContent>

        <TabsContent value="analyst" className="mt-4">
          <EdgeAnalystPanel sessionId={session?.id ?? null} finalized={session?.reviewFinalizedAt != null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
