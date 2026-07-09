"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JournalDayButton } from "@/components/journal/journal-day-button";
import { YearView } from "@/components/journal/year-view";
import { localDateToKey } from "@/lib/date";

interface DailyPnl {
  dateKey: string;
  percent: number;
  tradeCount: number;
}

export function JournalCalendar({
  noteDates,
  dailyPnl,
}: {
  noteDates: string[];
  dailyPnl: DailyPnl[];
}) {
  const router = useRouter();
  const noteDateSet = useMemo(() => new Set(noteDates), [noteDates]);
  const dailyPnlMap = useMemo(() => new Map(dailyPnl.map((d) => [d.dateKey, d])), [dailyPnl]);
  const [view, setView] = useState<"month" | "year">("month");
  const [month, setMonth] = useState<Date>(new Date());

  const noteCountsByMonth = useMemo(() => {
    const counts = new Array(12).fill(0);
    for (const key of noteDates) {
      const [y, m] = key.split("-").map(Number);
      if (y === month.getFullYear()) counts[m - 1]++;
    }
    return counts;
  }, [noteDates, month]);

  const percentByMonth = useMemo(() => {
    const totals = new Array(12).fill(0);
    for (const d of dailyPnl) {
      const [y, m] = d.dateKey.split("-").map(Number);
      if (y === month.getFullYear()) totals[m - 1] += d.percent;
    }
    return totals;
  }, [dailyPnl, month]);

  function goToDay(date: Date) {
    router.push(`/journal/${localDateToKey(date)}`);
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
              <JournalDayButton {...props} noteDates={noteDateSet} dailyPnl={dailyPnlMap} />
            ),
          }}
        />
      ) : (
        <YearView
          year={month.getFullYear()}
          noteCountsByMonth={noteCountsByMonth}
          percentByMonth={percentByMonth}
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
