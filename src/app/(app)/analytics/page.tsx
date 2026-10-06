import { requireUser } from "@/server/guards";
import {
  getAnalyticsData,
  getAnalyticsFilterOptions,
  type AnalyticsFilters,
} from "@/server/services/analytics.service";
import {
  getCanonicalAnalyticsDataset,
  getCanonicalFilterOptions,
  summarizeCanonicalAnalytics,
  type CanonicalAnalyticsFilters,
} from "@/server/services/analytics-canonical.service";
import { getPropFirmAnalyticsSummary } from "@/server/services/prop-firms-analytics.service";
import { buildImprovementAnalytics } from "@/server/services/edge-review-commitment.service";
import { isValidDateKey } from "@/lib/date";
import { presetToRangeForKey, type DateRangePreset } from "@/lib/date-ranges";
import { getTraderTodayKey } from "@/server/services/trader-time.service";
import { AnalyticsModule } from "@/components/analytics/analytics-module";
import { FadeIn } from "@/components/shared/motion";

const VALID_PRESETS: DateRangePreset[] = ["week", "month", "3months", "ytd", "year", "all", "custom"];

type Params = {
  range?: string;
  from?: string;
  to?: string;
  strategy?: string;
  entryModel?: string;
  asset?: string;
  direction?: string;
  session?: string;
  account?: string;
  winLoss?: string;
  status?: string;
  // Stage 10 — canonical (R-primary) dataset filters.
  setupType?: string;
  validationState?: string;
  behaviourLabel?: string;
  moodTag?: string;
};

function parseFilters(p: Params): AnalyticsFilters {
  return {
    strategyId: p.strategy || undefined,
    entryModel: p.entryModel || undefined,
    asset: p.asset || undefined,
    direction: p.direction === "LONG" || p.direction === "SHORT" ? p.direction : undefined,
    session: p.session || undefined,
    accountId: p.account || undefined,
    status:
      p.status === "OPEN" || p.status === "CLOSED" || p.status === "REVIEWED" ? p.status : undefined,
    winLoss: p.winLoss === "win" || p.winLoss === "loss" ? p.winLoss : undefined,
  };
}

/** Shares the SAME strategy/asset/direction/session values as parseFilters
 *  above (Stage 10 §17: filters must drive the whole page consistently) plus
 *  the additive Setup Type / validation state / behaviour label / mood tag
 *  dimensions the canonical dataset alone supports. */
function parseCanonicalFilters(p: Params, from: string, to: string): CanonicalAnalyticsFilters {
  return {
    from,
    to,
    strategyId: p.strategy || undefined,
    setupTypeName: p.setupType || undefined,
    asset: p.asset || undefined,
    direction: p.direction === "LONG" || p.direction === "SHORT" ? p.direction : undefined,
    session: p.session || undefined,
    validationState:
      p.validationState === "VALIDATED" || p.validationState === "OVERRIDDEN" || p.validationState === "NOT_VALIDATED"
        ? p.validationState
        : undefined,
    behaviourLabel: p.behaviourLabel || undefined,
    moodTag: p.moodTag || undefined,
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const preset: DateRangePreset = VALID_PRESETS.includes(params.range as DateRangePreset)
    ? (params.range as DateRangePreset)
    : "month";

  const { from, to } =
    preset === "custom" && params.from && params.to && isValidDateKey(params.from) && isValidDateKey(params.to)
      ? { from: params.from, to: params.to }
      : presetToRangeForKey(preset === "custom" ? "month" : preset, await getTraderTodayKey(user.id));

  const filters = parseFilters(params);
  const canonicalFilters = parseCanonicalFilters(params, from, to);

  const [data, filterOptions, propFirmAnalytics, canonicalRows, canonicalFilterOptions, improvementWeekly, improvementMonthly] = await Promise.all([
    getAnalyticsData(user.id, from, to, filters),
    getAnalyticsFilterOptions(user.id),
    getPropFirmAnalyticsSummary(user.id, {
      from: isValidDateKey(from) ? new Date(from) : undefined,
      to: isValidDateKey(to) ? new Date(to) : undefined,
    }),
    getCanonicalAnalyticsDataset(user.id, canonicalFilters),
    getCanonicalFilterOptions(user.id),
    buildImprovementAnalytics(user.id, "WEEKLY"),
    buildImprovementAnalytics(user.id, "MONTHLY"),
  ]);
  const canonical = summarizeCanonicalAnalytics(canonicalRows);

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <AnalyticsModule
        preset={preset}
        from={from}
        to={to}
        trading={data.trading}
        psychology={data.psychology}
        filterOptions={filterOptions}
        propFirmAnalytics={propFirmAnalytics}
        canonical={canonical}
        canonicalFilterOptions={canonicalFilterOptions}
        improvement={{ weekly: improvementWeekly, monthly: improvementMonthly }}
      />
    </FadeIn>
  );
}
