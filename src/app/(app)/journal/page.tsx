import { requireUser } from "@/server/guards";
import { listNoteDateKeys } from "@/server/services/journal.service";
import { listDailyPnl } from "@/server/services/trades.service";
import { getAnalyticsData } from "@/server/services/analytics.service";
import { isValidDateKey } from "@/lib/date";
import { presetToRange, type DateRangePreset } from "@/lib/date-ranges";
import { JournalCalendar } from "@/components/journal/journal-calendar";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { FadeIn } from "@/components/shared/motion";

const VALID_PRESETS: DateRangePreset[] = ["week", "month", "3months", "year", "custom"];

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
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

  const [noteDates, dailyPnl, analyticsData] = await Promise.all([
    listNoteDateKeys(user.id),
    listDailyPnl(user.id),
    getAnalyticsData(user.id, from, to),
  ]);

  return (
    <FadeIn className="mx-auto max-w-5xl space-y-10">
      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Journal</h1>
        <JournalCalendar noteDates={noteDates} dailyPnl={dailyPnl} />
      </div>

      <AnalyticsDashboard preset={preset} from={from} to={to} data={analyticsData} />
    </FadeIn>
  );
}
