"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JournalDayButton } from "@/components/journal/journal-day-button";
import { JournalWeekdaysRow, JournalWeekRow } from "@/components/journal/journal-week-column";
import { YearView } from "@/components/journal/year-view";
import { localDateToKey } from "@/lib/date";
import type { DailyPerformanceSummaryDTO } from "@/server/services/close-day.service";

export function JournalCalendar({
  noteDates,
  dailyPerformance,
}: {
  noteDates: string[];
  dailyPerformance: DailyPerformanceSummaryDTO[];
}) {
  const router = useRouter();
  const noteDateSet = useMemo(() => new Set(noteDates), [noteDates]);
  const dailyPerformanceMap = useMemo(
    () => new Map(dailyPerformance.map((d) => [d.dateKey, d])),
    [dailyPerformance],
  );
  const [view, setView] = useState<"month" | "year">("month");
  const [month, setMonth] = useState<Date>(new Date());

  function goToDay(date: Date) {
    router.push(`/journal/${localDateToKey(date)}`);
  }

  function goToDayKey(dateKey: string) {
    router.push(`/journal/${dateKey}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as "month" | "year")}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>
          Today
        </Button>
      </div>

      {view === "month" ? (
        <Calendar
          month={month}
          onMonthChange={setMonth}
          onDayClick={goToDay}
          className="glass w-full max-w-none rounded-2xl p-2 [--cell-size:2.75rem] sm:p-4 sm:[--cell-size:3.5rem] lg:[--cell-size:4.5rem]"
          classNames={{ months: "w-full", month: "w-full", month_grid: "w-full" }}
          components={{
            DayButton: (props) => (
              <JournalDayButton {...props} noteDates={noteDateSet} dailyPerformance={dailyPerformanceMap} />
            ),
            Weekdays: JournalWeekdaysRow,
            Week: (props) => <JournalWeekRow {...props} dailyPerformance={dailyPerformanceMap} />,
          }}
        />
      ) : (
        <YearView
          year={month.getFullYear()}
          dailyPerformance={dailyPerformanceMap}
          onSelectDay={goToDayKey}
          onSelectMonth={(i) => {
            setMonth(new Date(month.getFullYear(), i, 1));
            setView("month");
          }}
          onChangeYear={(y) => setMonth(new Date(y, month.getMonth(), 1))}
        />
      )}
    </div>
  );
}
