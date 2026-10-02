import { History } from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import { TodayFocusFromReview } from "@/components/today/today-focus-from-review";
import type { CarryForwardDTO } from "@/server/services/trading-workspace.service";
import type {
  AdherenceResultDTO,
  AdherenceTrend,
  EdgeReviewCommitmentDailyStatus,
  TodayCommitmentsDTO,
} from "@/types/edge-improvements";

/**
 * Today V3 — two DISTINCT carry-forward sources, never merged:
 *  - FROM YOUR LAST SESSION: the previous live day's own reflection
 *    (TradingDay.dayCarryForward / dayMainLesson / dayToImprove), read-only.
 *  - FROM EDGE REVIEW: active weekly/monthly commitments, with their own
 *    Followed / Breached controls (the existing TodayFocusFromReview).
 * A daily lesson is never turned into a commitment automatically.
 */
export function CarryForwardStrip({
  lastSession,
  commitments,
  todayKey,
  commitmentDailyStates,
  commitmentAdherence,
}: {
  lastSession: CarryForwardDTO | null;
  commitments: TodayCommitmentsDTO;
  todayKey: string;
  commitmentDailyStates: Record<string, EdgeReviewCommitmentDailyStatus>;
  commitmentAdherence: Record<string, { current: AdherenceResultDTO; trend: AdherenceTrend }>;
}) {
  const hasCommitments = commitments.weekly.length + commitments.monthly.length > 0;
  if (!lastSession && !hasCommitments) return null;

  const rows = lastSession
    ? ([
        ["Focus", lastSession.carryForward],
        ["Lesson", lastSession.mainLesson],
        ["Improve", lastSession.toImprove],
      ] as const).filter(([, v]) => v)
    : [];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {lastSession && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4" aria-label="From your last session">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <History className="size-4 text-primary" />
              From your last session
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">{formatDateKeyLong(lastSession.fromDateKey)}</span>
          </div>
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {hasCommitments && (
        <div className={lastSession ? "" : "lg:col-span-2"}>
          <TodayFocusFromReview
            commitments={commitments}
            todayKey={todayKey}
            initialDailyStates={commitmentDailyStates}
            adherence={commitmentAdherence}
          />
        </div>
      )}
    </div>
  );
}
