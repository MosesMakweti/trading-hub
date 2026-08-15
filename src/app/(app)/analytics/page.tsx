import { requireUser } from "@/server/guards";
import {
  getAnalyticsData,
  getAnalyticsFilterOptions,
  type AnalyticsFilters,
} from "@/server/services/analytics.service";
import { getPropFirmAnalyticsSummary } from "@/server/services/prop-firms-analytics.service";
import { isValidDateKey } from "@/lib/date";
import { presetToRange, type DateRangePreset } from "@/lib/date-ranges";
import { AnalyticsModule } from "@/components/analytics/analytics-module";
import { FadeIn } from "@/components/shared/motion";

const VALID_PRESETS: DateRangePreset[] = ["week", "month", "3months", "year", "custom"];

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
      : presetToRange(preset === "custom" ? "month" : preset);

  const filters = parseFilters(params);

  const [data, filterOptions, propFirmAnalytics] = await Promise.all([
    getAnalyticsData(user.id, from, to, filters),
    getAnalyticsFilterOptions(user.id),
    getPropFirmAnalyticsSummary(user.id, {
      from: isValidDateKey(from) ? new Date(from) : undefined,
      to: isValidDateKey(to) ? new Date(to) : undefined,
    }),
  ]);

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
      />
    </FadeIn>
  );
}
