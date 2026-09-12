import Link from "next/link";
import {
  BookOpenCheck,
  ChevronLeft,
  ClipboardCheck,
  History,
  Lightbulb,
  Pencil,
  Zap,
} from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { TradeHeader } from "@/components/journal/workspace/trade-header";
import { TradeIdeaSection, type DailyMarketContextDTO } from "@/components/journal/workspace/trade-idea-section";
import { TradeExecutionSection } from "@/components/journal/workspace/trade-execution-section";
import { TradeReviewSection } from "@/components/journal/workspace/trade-review-section";
import { TradeTimeline } from "@/components/journal/workspace/trade-timeline";
import { TradeSummary } from "@/components/journal/workspace/trade-summary";
import { WorkspaceSection } from "@/components/journal/workspace/workspace-ui";
import { WorkspaceEditableProvider } from "@/components/journal/workspace/editable-context";
import { ReadOnlyDayBanner } from "@/components/journal/read-only-day-banner";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";

export function TradeWorkspace({
  trade,
  editable = true,
  carriedOpenOnArchivedDay = false,
  propFirmAccounts = [],
  executions = [],
  dailyMarketContext = null,
}: {
  trade: TradeWorkspaceDTO;
  editable?: boolean;
  /** Stage 9 §15 — true when this trade is editable ONLY because it's a
   *  carried-open (PARTIALLY_CLOSED/STILL_HOLDING) trade on an otherwise
   *  archived day; shows a narrower, non-actionable notice instead of the
   *  normal "reopen the whole day" banner. */
  carriedOpenOnArchivedDay?: boolean;
  propFirmAccounts?: AccountAllocationSelectorDTO[];
  executions?: ExecutionDTO[];
  /** Stage 11 §18 — the asset's live Daily Market Plan context, reused from
   *  DailyAssetAnalysis; null when there is none for that day/asset. */
  dailyMarketContext?: DailyMarketContextDTO | null;
}) {
  const dateKey = trade.dateKey;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to day"
            nativeButton={false}
            render={<Link href={`/journal/${dateKey}`} />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">Trade workspace</p>
            <p className="text-sm font-medium">{formatDateKeyLong(dateKey)}</p>
          </div>
        </div>
        {editable && (
          <Button
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/journal/${dateKey}/trades/${trade.id}/edit`} />}
          >
            <Pencil className="size-3.5" />
            Edit trade
          </Button>
        )}
      </div>

      {!editable && <ReadOnlyDayBanner dateKey={dateKey} />}
      {carriedOpenOnArchivedDay && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-medium">This trading day is archived, but this trade is still open</p>
          <p className="text-xs text-muted-foreground">
            Its execution and review fields stay editable until it&apos;s fully closed — the rest of
            this day&apos;s historical record stays locked.
          </p>
        </div>
      )}

      <TradeHeader trade={trade} />

      <WorkspaceEditableProvider editable={editable}>
      <div>
        <WorkspaceSection
          icon={Lightbulb}
          title="Trade Idea"
          description="What I planned — before the trade."
        >
          <TradeIdeaSection
            trade={trade}
            propFirmAccounts={propFirmAccounts}
            executions={executions}
            dailyMarketContext={dailyMarketContext}
          />
        </WorkspaceSection>

        <WorkspaceSection
          icon={Zap}
          title="Trade Execution"
          description="What I actually did."
        >
          <TradeExecutionSection trade={trade} />
        </WorkspaceSection>

        <WorkspaceSection
          icon={BookOpenCheck}
          title="Trade Review"
          description="What I learned."
        >
          <TradeReviewSection trade={trade} />
        </WorkspaceSection>

        <WorkspaceSection icon={History} title="Timeline">
          <TradeTimeline trade={trade} />
        </WorkspaceSection>

        <WorkspaceSection icon={ClipboardCheck} title="Trade Summary" isLast>
          <TradeSummary trade={trade} />
        </WorkspaceSection>
      </div>
      </WorkspaceEditableProvider>
    </div>
  );
}
