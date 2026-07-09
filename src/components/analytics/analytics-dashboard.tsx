"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangeFilter } from "@/components/analytics/date-range-filter";
import { TradingAnalytics } from "@/components/analytics/trading-analytics";
import { PsychologyAnalytics } from "@/components/analytics/psychology-analytics";
import type { getAnalyticsData } from "@/server/services/analytics.service";
import type { DateRangePreset } from "@/lib/date-ranges";

export function AnalyticsDashboard({
  preset,
  from,
  to,
  data,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  data: Awaited<ReturnType<typeof getAnalyticsData>>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <DateRangeFilter preset={preset} from={from} to={to} />
      </div>
      <Tabs defaultValue="trading">
        <TabsList>
          <TabsTrigger value="trading">Trading</TabsTrigger>
          <TabsTrigger value="psychology">Psychology</TabsTrigger>
        </TabsList>
        <TabsContent value="trading" className="mt-4">
          <TradingAnalytics data={data.trading} />
        </TabsContent>
        <TabsContent value="psychology" className="mt-4">
          <PsychologyAnalytics data={data.psychology} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
