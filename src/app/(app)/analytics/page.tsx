import { requireUser } from "@/server/guards";
import { getAnalyticsData } from "@/server/services/analytics.service";
import { isValidDateKey } from "@/lib/date";
import { presetToRange, type DateRangePreset } from "@/lib/date-ranges";
import { AnalyticsModule } from "@/components/analytics/analytics-module";
import { FadeIn } from "@/components/shared/motion";

const VALID_PRESETS: DateRangePreset[] = ["week", "month", "3months", "year", "custom"];

export default async function AnalyticsPage({
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

  const data = await getAnalyticsData(user.id, from, to);

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <AnalyticsModule
        preset={preset}
        from={from}
        to={to}
        trading={data.trading}
        psychology={data.psychology}
      />
    </FadeIn>
  );
}
