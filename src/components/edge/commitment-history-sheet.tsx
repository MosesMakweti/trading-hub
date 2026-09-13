"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CommitmentTrendChart } from "@/components/edge/commitment-trend-chart";
import { getCommitmentLineage } from "@/actions/edge-improvements.actions";
import { formatDateKeyLong, formatDateKeyShort } from "@/lib/date";
import type { CommitmentLineageDTO, CommitmentLineageSegmentDTO, CommitmentObservationDTO } from "@/types/edge-improvements";

const TREND_LABEL: Record<CommitmentLineageDTO["trend"], string> = {
  IMPROVING: "Improving",
  DECLINING: "Declining",
  STABLE: "Stable",
  INSUFFICIENT_DATA: "Not enough data yet",
};

/**
 * Commitment history/detail (Stage 19.1 §8-11) — built entirely from the
 * existing `getCommitmentLineage` read model (no new persistence). Answers
 * "when was this first identified, how has it changed, how did I do each
 * period, and why did the system classify what it classified" — a focused
 * Sheet, not a new top-level module (§9).
 */
export function CommitmentHistorySheet({ commitmentId, title }: { commitmentId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [lineage, setLineage] = useState<CommitmentLineageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || lineage) return;
    void getCommitmentLineage(commitmentId).then((result) => {
      if (result.success) setLineage(result.lineage);
      else setError(result.error);
    });
  }, [open, lineage, commitmentId]);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(true)}>
        <History className="mr-1 size-3" /> View history
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-xl">
          <SheetHeader className="p-0">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>

          {error && <p className="mt-4 text-xs text-danger">{error}</p>}
          {!error && !lineage && (
            <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading history…
            </div>
          )}
          {lineage && <HistoryContent lineage={lineage} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function HistoryContent({ lineage }: { lineage: CommitmentLineageDTO }) {
  const first = lineage.segments[0];
  const firstIdentified = first ? formatDateKeyLong(first.periodStart) : null;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <SummaryStat label="Lifetime adherence" value={lineage.lifetime.adherencePercent == null ? "no data" : `${lineage.lifetime.adherencePercent}%`} />
        <SummaryStat label="Observations" value={String(lineage.lifetime.applicableObservations)} />
        <SummaryStat label="Trend" value={TREND_LABEL[lineage.trend]} />
      </div>

      {firstIdentified && (
        <p className="text-[11px] text-muted-foreground/70">
          First identified {firstIdentified} · {lineage.segments.length} period{lineage.segments.length === 1 ? "" : "s"} tracked
          {lineage.resolutionEligible && " · adherence suggests this may be ready to resolve"}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Adherence by period</p>
        <CommitmentTrendChart segments={lineage.segments} />
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Timeline</p>
        {lineage.segments.map((segment) => (
          <SegmentRow key={segment.commitmentId} segment={segment} />
        ))}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

const RETIREMENT_LABEL: Record<NonNullable<CommitmentLineageSegmentDTO["retirementReason"]>, string> = {
  SUPERSEDED: "Carried forward (continued/refined)",
  DISMISSED: "Dismissed",
};

function SegmentRow({ segment }: { segment: CommitmentLineageSegmentDTO }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
            {segment.reviewType === "WEEKLY" ? "Weekly" : "Monthly"}
          </span>
          <span className="font-medium">{formatDateKeyShort(segment.periodStart)}</span>
          <span className="text-[10px] text-muted-foreground">{segment.status}</span>
          {segment.retirementReason && <span className="text-[10px] text-muted-foreground/70">· {RETIREMENT_LABEL[segment.retirementReason]}</span>}
        </div>
        <AdherenceBadge segment={segment} />
      </div>

      <p className="mt-1.5 font-medium">{segment.title}</p>
      {segment.description && <p className="text-muted-foreground">{segment.description}</p>}

      {segment.observations.length > 0 && (
        <button
          type="button"
          className="mt-1.5 flex items-center gap-1 text-[11px] text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {segment.observations.length} observation{segment.observations.length === 1 ? "" : "s"}
        </button>
      )}

      {expanded && (
        <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
          {segment.observations.map((o) => (
            <ObservationRow key={o.dateKey} observation={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdherenceBadge({ segment }: { segment: CommitmentLineageSegmentDTO }) {
  if (segment.adherence.adherencePercent == null) {
    return <span className="text-[10px] text-muted-foreground/50 italic">no observations</span>;
  }
  return (
    <span className="text-[10px] text-muted-foreground">
      {segment.adherence.adherencePercent}% ({segment.adherence.followed}/{segment.adherence.applicableObservations})
    </span>
  );
}

const STATUS_CLASS: Record<CommitmentObservationDTO["status"], string> = {
  FOLLOWED: "text-success",
  BREACHED: "text-danger",
  ACKNOWLEDGED: "text-muted-foreground",
};

function ObservationRow({ observation }: { observation: CommitmentObservationDTO }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border/40 bg-background/60 px-2 py-1 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{formatDateKeyShort(observation.dateKey)}</span>
        <div className="flex items-center gap-1.5">
          <span className={cn("font-semibold", STATUS_CLASS[observation.status])}>{observation.status}</span>
          <span className="rounded bg-secondary px-1 text-[9px] text-secondary-foreground">{observation.source}</span>
        </div>
      </div>
      {observation.evidenceDescription && <p className="text-muted-foreground/80">{observation.evidenceDescription}</p>}
      {observation.note && <p className="text-muted-foreground/80 italic">&ldquo;{observation.note}&rdquo;</p>}
      {observation.relatedTradeId && (
        <Link href={`/journal/${observation.dateKey}`} className="text-primary hover:underline">
          View trade day →
        </Link>
      )}
    </div>
  );
}
