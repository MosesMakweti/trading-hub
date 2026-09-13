import { requireUser } from "@/server/guards";
import { getWeeklyReview } from "@/server/services/edge.service";
import { getAnalyticsFilterOptions } from "@/server/services/analytics.service";
import {
  buildActualBaseline,
  findReplayReviewSessionForPeriod,
  getHistoricalStrategyContext,
} from "@/server/services/replay-review.service";
import { listReplayTrades } from "@/server/services/replay-trade.service";
import { getReplayComparison } from "@/server/services/replay-comparison.service";
import { listStrategyVersions } from "@/server/services/strategies.service";
import { listTradingDayKeysInRange } from "@/server/services/trading-day.service";
import { computeReviewPeriod } from "@/domain/replay/review-period";
import { buildActualVsReplayComparison } from "@/domain/replay-comparison/comparison";
import { synthesizeImprovements } from "@/domain/replay-improvements/synthesis";
import { listCarryForwardCandidates, listCommitmentsForSession } from "@/server/services/edge-review-commitment.service";
import { isValidDateKey, localDateToKey } from "@/lib/date";
import { EdgeReviewWorkspace } from "@/components/edge/edge-review-workspace";
import { FadeIn } from "@/components/shared/motion";
import type { ReplayReviewType } from "@/types/replay";

type Params = {
  period?: string;
  type?: string;
  tab?: string;
  strategy?: string;
  assets?: string;
};

/**
 * Edge Review (Stage 12.5) — Overview / Replay / Comparison / Improvements,
 * one continuous review process over an explicit WEEKLY/MONTHLY period. The
 * period, type, and scope are all URL state (bookmarkable, shareable) so a
 * trader never has to separately "create a review" before seeing it — the
 * corresponding ReplayReviewSession (if any) is resolved automatically from
 * that exact period+scope (Stage 12.5 §7-8).
 */
export default async function EdgeReviewPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const reviewType: ReplayReviewType = params.type === "MONTHLY" ? "MONTHLY" : "WEEKLY";
  const anchor = params.period && isValidDateKey(params.period) ? params.period : localDateToKey(new Date());
  const { startDate, endDate } = computeReviewPeriod(reviewType, anchor);

  const strategyId = params.strategy || null;
  const assetSymbols = params.assets ? params.assets.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];

  const [filterOptions, weeklyReviewRow, session] = await Promise.all([
    getAnalyticsFilterOptions(user.id),
    getWeeklyReview(user.id, startDate, reviewType),
    findReplayReviewSessionForPeriod(user.id, { reviewType, startDate, endDate, strategyId, assetSymbols }),
  ]);

  const [baseline, historicalStrategyContext, dailyPlanDateKeys, replayTrades, comparisonFromService] = await Promise.all([
    session?.actualBaselineSnapshot
      ? Promise.resolve(session.actualBaselineSnapshot)
      : buildActualBaseline(user.id, { startDate, endDate, strategyId, assetSymbols }),
    strategyId
      ? listStrategyVersions(user.id, strategyId).then((versions) =>
          versions[0] ? getHistoricalStrategyContext(user.id, strategyId, versions[0].version) : null,
        )
      : Promise.resolve(null),
    listTradingDayKeysInRange(user.id, startDate, endDate),
    session ? listReplayTrades(user.id, session.id) : Promise.resolve([]),
    session ? getReplayComparison(user.id, session.id) : Promise.resolve(null),
  ]);

  const isLive = session?.actualBaselineSnapshot == null;
  // Comparison (Stage 15, upgraded Stage 15.1, completed Stage 15.2) —
  // `getReplayComparison` already wires the frozen baseline + ReplayTrade
  // list + manual links + missed-opportunity confirmations + session status
  // together; for a not-yet-started review (no session/baseline frozen yet)
  // fall back to the pure builder directly against the live preview
  // baseline, with no matches to speak of yet.
  const comparison = comparisonFromService ?? buildActualVsReplayComparison(baseline, replayTrades, [], [], new Map(), "DRAFT");
  // Improvements (Stage 16) — findings/suggestions are DERIVED, never
  // persisted (see synthesis.ts's own doc comment); commitments are the one
  // durable record, fetched per-session.
  const [improvementsSynthesis, commitments, carryForwardCandidates] = await Promise.all([
    Promise.resolve(synthesizeImprovements(comparison)),
    session ? listCommitmentsForSession(user.id, session.id) : Promise.resolve([]),
    listCarryForwardCandidates(user.id, reviewType, session?.id ?? null),
  ]);

  const validTab = ["overview", "replay", "comparison", "improvements", "analyst"] as const;
  const initialTab = validTab.includes(params.tab as (typeof validTab)[number])
    ? (params.tab as (typeof validTab)[number])
    : "overview";

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <EdgeReviewWorkspace
        reviewType={reviewType}
        period={anchor}
        startDate={startDate}
        endDate={endDate}
        session={session}
        baseline={baseline}
        isLive={isLive}
        historicalStrategyContext={historicalStrategyContext}
        dailyPlanDateKeys={dailyPlanDateKeys}
        replayTradeCount={replayTrades.length}
        replayTrades={replayTrades}
        comparison={comparison}
        improvementsSynthesis={improvementsSynthesis}
        commitments={commitments}
        carryForwardCandidates={carryForwardCandidates}
        weeklyReview={{
          wentWell: weeklyReviewRow?.wentWell ?? null,
          toImprove: weeklyReviewRow?.toImprove ?? null,
          focusNextWeek: weeklyReviewRow?.focusNextWeek ?? null,
        }}
        strategies={filterOptions.strategies}
        assets={filterOptions.assets}
        strategyId={strategyId}
        assetSymbols={assetSymbols}
        initialTab={initialTab}
      />
    </FadeIn>
  );
}
