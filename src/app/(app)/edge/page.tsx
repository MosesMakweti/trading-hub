import { requireUser } from "@/server/guards";
import { getAnalyticsFilterOptions } from "@/server/services/analytics.service";
import { getDefaultAuditWeekStart, loadAuditWorkspace } from "@/server/services/trade-audit.service";
import { auditWeekFor, normalizeAssets } from "@/domain/trade-audit/week";
import { isValidDateKey } from "@/lib/date";
import { WeeklyAuditWorkspace } from "@/components/edge/audit/weekly-audit-workspace";
import { FadeIn } from "@/components/shared/motion";

type Params = {
  week?: string;
  strategy?: string;
  assets?: string;
};

/**
 * Edge Review — the Weekly Trade Audit (docs/WEEKLY_TRADE_AUDIT.md).
 *
 * The week and scope live in the URL (bookmarkable). With no `week`, the page
 * opens the most recently COMPLETED trading week, because this is a weekend
 * review. Any date in a week resolves to that week's Monday. Nothing is
 * created just by opening a week: the audit row appears on the first save.
 */
export default async function EdgeReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;

  const [{ weekStart: defaultWeek, todayKey }, filterOptions] = await Promise.all([
    getDefaultAuditWeekStart(user.id),
    getAnalyticsFilterOptions(user.id),
  ]);
  const weekStart = params.week && isValidDateKey(params.week) ? auditWeekFor(params.week).weekStart : defaultWeek;

  // Only strategies the user owns are honoured; anything else falls back to "All".
  const strategyId = params.strategy && filterOptions.strategies.some((s) => s.id === params.strategy) ? params.strategy : null;
  const assetSymbols = normalizeAssets(params.assets ? params.assets.split(",").slice(0, 30) : []);

  const workspace = await loadAuditWorkspace(user.id, { weekStart, strategyId, assetSymbols });

  return (
    <FadeIn className="mx-auto max-w-7xl">
      <WeeklyAuditWorkspace
        workspace={workspace}
        defaultWeekStart={defaultWeek}
        todayKey={todayKey}
        strategies={filterOptions.strategies}
        assets={filterOptions.assets}
      />
    </FadeIn>
  );
}
