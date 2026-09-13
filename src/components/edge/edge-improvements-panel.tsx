"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { EdgeCommitmentsPanel } from "@/components/edge/edge-commitments-panel";
import { updateWeeklyReview } from "@/actions/edge.actions";
import { finishEdgeReview } from "@/actions/edge-improvements.actions";
import type { ActualVsReplayComparison } from "@/domain/replay-comparison/types";
import type { ImprovementsSynthesis } from "@/domain/replay-improvements/types";
import type { EdgeReviewCommitmentDTO } from "@/types/edge-improvements";
import type { ReplayReviewSessionDTO } from "@/types/replay";

const rr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;

/**
 * Improvements & Carry-Forward (Stage 16) — the review's deliberate close:
 * factual findings (§3-4, §22), the existing durable reflection fields
 * (§1-2, unchanged), evidence-backed commitments (§6-14), and Finish Review
 * (§26-27). Nothing here is AI-generated (§30) — every number traces back
 * to `domain/replay-comparison`/`domain/replay-improvements`'s pure
 * builders.
 */
export function EdgeImprovementsPanel({
  session,
  reviewType,
  startDate,
  comparison,
  synthesis,
  commitments,
  weeklyReview,
}: {
  session: ReplayReviewSessionDTO | null;
  reviewType: "WEEKLY" | "MONTHLY";
  startDate: string;
  comparison: ActualVsReplayComparison;
  synthesis: ImprovementsSynthesis;
  commitments: EdgeReviewCommitmentDTO[];
  weeklyReview: { wentWell: unknown; toImprove: unknown; focusNextWeek: unknown };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const periodWord = reviewType === "WEEKLY" ? "week" : "month";

  function finish() {
    if (!session) return;
    startTransition(async () => {
      const result = await finishEdgeReview(session.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Review finished.");
      router.refresh();
    });
  }

  const reviewNeededMatches = comparison.matched.filter((p) => p.confidence === "MEDIUM" && p.source === "AUTO").length;
  const unconfirmedMissed = comparison.opportunity.unmatchedReplayTaken.filter((e) => e.missedOpportunityStatus === "UNCONFIRMED").length;
  const activeCommitmentCount = commitments.filter((c) => c.status === "ACTIVE").length;
  const hasReflectionContent = weeklyReview.wentWell != null || weeklyReview.toImprove != null || weeklyReview.focusNextWeek != null;

  return (
    <div className="space-y-4">
      {/* Top — Review Findings summary (§22) */}
      <div className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">This review identified:</h2>
        <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
          <SummaryLine label="Execution findings" value={synthesis.summary.executionFindingCount} />
          <SummaryLine label="Behavioral findings" value={synthesis.summary.behaviorFindingCount} />
          <SummaryLine label="Confirmed missed opportunities" value={synthesis.summary.confirmedMissedOpportunityCount} />
          <SummaryLine
            label="Defensible avoidable discrepancy"
            value={`${rr(synthesis.summary.avoidableDiscrepancyR)}`}
            tone={synthesis.summary.avoidableDiscrepancyR > 0 ? "danger" : undefined}
          />
          <SummaryLine label="Suggested commitments" value={synthesis.summary.suggestedCommitmentCount} />
          <SummaryLine label="Strategy variance (no change required)" value={synthesis.strategyVarianceFindings.reduce((s, f) => s + f.count, 0)} />
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Left/main */}
        <div className="space-y-4">
          <EvidenceSection title="What went well — evidence" findings={synthesis.positiveFindings} tone="success" />
          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium">What went well?</h3>
            <RichTextEditor
              initialContent={weeklyReview.wentWell}
              placeholder="Your best decisions, disciplines, and wins this week…"
              onSave={(content) => updateWeeklyReview(startDate, reviewType, { wentWell: content })}
            />
          </div>

          <EvidenceSection
            title="What needs improvement — evidence"
            findings={[...synthesis.findings]}
            tone="warning"
          />
          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium">What to improve?</h3>
            <RichTextEditor
              initialContent={weeklyReview.toImprove}
              placeholder="Mistakes, leaks, and patterns to fix…"
              onSave={(content) => updateWeeklyReview(startDate, reviewType, { toImprove: content })}
            />
          </div>

          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium">Focus for next {periodWord}</h3>
            <RichTextEditor
              initialContent={weeklyReview.focusNextWeek}
              placeholder={`The one or two things you'll do differently next ${periodWord}…`}
              onSave={(content) => updateWeeklyReview(startDate, reviewType, { focusNextWeek: content })}
            />
          </div>
        </div>

        {/* Right */}
        {session ? (
          <EdgeCommitmentsPanel sessionId={session.id} commitments={commitments} suggestions={synthesis.suggestions} />
        ) : (
          <div className="glass rounded-2xl p-4 text-xs text-muted-foreground">Start the review to create commitments.</div>
        )}
      </div>

      {/* Bottom — Finish Review (§26-27) */}
      {session && (
        <div className="glass space-y-3 rounded-2xl p-4">
          <h3 className="text-sm font-semibold">Finish Review</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              {hasReflectionContent ? <CheckCircle2 className="size-3.5 text-success" /> : <AlertTriangle className="size-3.5 text-warning" />}
              {hasReflectionContent ? "Reflection saved" : "No reflection saved yet"}
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-success" /> {activeCommitmentCount} active commitment{activeCommitmentCount === 1 ? "" : "s"}
            </li>
            {reviewNeededMatches > 0 && (
              <li className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-warning" /> {reviewNeededMatches} match{reviewNeededMatches === 1 ? "" : "es"} still marked &quot;review needed&quot; in Comparison
              </li>
            )}
            {unconfirmedMissed > 0 && (
              <li className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-warning" /> {unconfirmedMissed} potential missed opportunit{unconfirmedMissed === 1 ? "y" : "ies"} not yet confirmed/rejected
              </li>
            )}
          </ul>
          <p className="text-[11px] text-muted-foreground/60 italic">These are informational — finishing the review does not require resolving them.</p>

          {session.reviewFinalizedAt ? (
            <div className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="size-3.5" /> Review finished.
            </div>
          ) : session.status === "COMPLETED" ? (
            <Button type="button" className="gap-1.5" onClick={finish} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}
              Finish Review
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Complete the Replay review before finishing Improvements.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, tone }: { label: string; value: number | string; tone?: "danger" }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone === "danger" && "text-danger")}>{value}</span>
    </li>
  );
}

function EvidenceSection({
  title,
  findings,
  tone,
}: {
  title: string;
  findings: ImprovementsSynthesis["positiveFindings"];
  tone: "success" | "warning";
}) {
  if (findings.length === 0) return null;
  return (
    <div className={cn("space-y-1.5 rounded-xl border p-3 text-xs", tone === "success" ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
      <p className="font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {findings.map((f) => (
          <li key={f.key}>
            <span className={cn("font-medium", tone === "success" ? "text-success" : "text-warning")}>{f.statement}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
