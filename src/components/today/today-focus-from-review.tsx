"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, ShieldAlert, ThumbsUp, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setCommitmentDailyState } from "@/actions/edge-improvements.actions";
import type {
  AdherenceResultDTO,
  AdherenceTrend,
  EdgeReviewCommitmentDTO,
  EdgeReviewCommitmentDailyStatus,
  TodayCommitmentsDTO,
} from "@/types/edge-improvements";

const PRIORITY_CLASS: Record<string, string> = {
  HIGH: "bg-danger/15 text-danger",
  MEDIUM: "bg-warning/15 text-warning",
  LOW: "bg-secondary text-secondary-foreground",
};

/**
 * "Focus From Last Review" (Stage 16 §15-19, upgraded Stage 19 §12) — the
 * latest FINALIZED weekly/monthly review's still-ACTIVE commitments, shown
 * compactly BEFORE the trader starts working through Today. Stage 19 adds,
 * without turning this into an analytics page: this period's adherence %
 * (or "no data yet" — never a misleading 0%, §14), a restrained trend icon
 * (only once there's enough sample to say anything, §13), and an optional
 * one-line note when logging a breach (§19). Checking a daily state here
 * writes only to `EdgeReviewCommitmentDailyState` — it never mutates the
 * commitment record or the historical Edge Review itself (§17).
 */
export function TodayFocusFromReview({
  commitments,
  todayKey,
  initialDailyStates,
  adherence,
}: {
  commitments: TodayCommitmentsDTO;
  todayKey: string;
  initialDailyStates: Record<string, EdgeReviewCommitmentDailyStatus>;
  adherence: Record<string, { current: AdherenceResultDTO; trend: AdherenceTrend }>;
}) {
  const all = [...commitments.weekly, ...commitments.monthly];
  if (all.length === 0) return null;

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-1.5">
        <ClipboardList className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Focus From Last Review</h2>
      </div>
      {commitments.weekly.length > 0 && (
        <CommitmentGroup label="This Week" items={commitments.weekly} todayKey={todayKey} initialDailyStates={initialDailyStates} adherence={adherence} />
      )}
      {commitments.monthly.length > 0 && (
        <CommitmentGroup label="This Month" items={commitments.monthly} todayKey={todayKey} initialDailyStates={initialDailyStates} adherence={adherence} />
      )}
    </div>
  );
}

function CommitmentGroup({
  label,
  items,
  todayKey,
  initialDailyStates,
  adherence,
}: {
  label: string;
  items: EdgeReviewCommitmentDTO[];
  todayKey: string;
  initialDailyStates: Record<string, EdgeReviewCommitmentDailyStatus>;
  adherence: Record<string, { current: AdherenceResultDTO; trend: AdherenceTrend }>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <div className="space-y-1.5">
        {items.map((c) => (
          <CommitmentRow key={c.id} commitment={c} todayKey={todayKey} initialStatus={initialDailyStates[c.id] ?? null} adherence={adherence[c.id] ?? null} />
        ))}
      </div>
    </div>
  );
}

const TREND_ICON: Partial<Record<AdherenceTrend, { Icon: typeof TrendingUp; className: string }>> = {
  IMPROVING: { Icon: TrendingUp, className: "text-success" },
  DECLINING: { Icon: TrendingDown, className: "text-danger" },
};

function AdherenceBadge({ adherence }: { adherence: { current: AdherenceResultDTO; trend: AdherenceTrend } | null }) {
  if (!adherence || adherence.current.adherencePercent == null) {
    return <span className="text-[10px] text-muted-foreground/50 italic">no observations yet</span>;
  }
  const trend = TREND_ICON[adherence.trend];
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {adherence.current.adherencePercent}% this period
      {trend && <trend.Icon className={cn("size-3", trend.className)} />}
      <span className="text-muted-foreground/50">({adherence.current.applicableObservations} obs.)</span>
    </span>
  );
}

function CommitmentRow({
  commitment,
  todayKey,
  initialStatus,
  adherence,
}: {
  commitment: EdgeReviewCommitmentDTO;
  todayKey: string;
  initialStatus: EdgeReviewCommitmentDailyStatus | null;
  adherence: { current: AdherenceResultDTO; trend: AdherenceTrend } | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  function set(next: EdgeReviewCommitmentDailyStatus, breachNote?: string) {
    startTransition(async () => {
      const result = await setCommitmentDailyState(commitment.id, { dateKey: todayKey, status: next, note: breachNote ?? null });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setStatus(next);
      if (next === "BREACHED") setNoteOpen(false);
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", PRIORITY_CLASS[commitment.priority])}>{commitment.priority}</span>
          <span className="truncate font-medium">{commitment.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={status === "ACKNOWLEDGED" ? "default" : "ghost"}
            size="icon-sm"
            aria-label="Acknowledge"
            disabled={pending}
            onClick={() => set("ACKNOWLEDGED")}
          >
            <CheckCircle2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant={status === "FOLLOWED" ? "default" : "ghost"}
            size="icon-sm"
            aria-label="Followed today"
            disabled={pending}
            onClick={() => set("FOLLOWED")}
            className={status === "FOLLOWED" ? "bg-success text-white hover:bg-success/90" : undefined}
          >
            <ThumbsUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant={status === "BREACHED" ? "default" : "ghost"}
            size="icon-sm"
            aria-label="Breached today"
            disabled={pending}
            onClick={() => setNoteOpen((v) => !v)}
            className={status === "BREACHED" ? "bg-danger text-white hover:bg-danger/90" : undefined}
          >
            <ShieldAlert className="size-3.5" />
          </Button>
        </div>
      </div>

      <AdherenceBadge adherence={adherence} />

      {noteOpen && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — what happened? (short)"
            rows={1}
            className="min-h-0 py-1 text-xs"
          />
          <Button size="sm" className="h-7 shrink-0 bg-danger text-white hover:bg-danger/90" disabled={pending} onClick={() => set("BREACHED", note.trim() || undefined)}>
            Log breach
          </Button>
        </div>
      )}
    </div>
  );
}
