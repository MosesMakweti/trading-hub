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

export interface JournalCalendarRunContext {
  /** The run's journal base path, e.g. /backtesting/<id>/journal. */
  hrefBase: string;
  startDateKey: string;
  endDateKey: string;
  tradingWeekdays: number[];
  closedDates: string[];
  /** Month the calendar opens on (the run's current position). */
  initialDateKey: string;
}

function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The Journal calendar (Month + Year). Live Journal: no `run`. Backtesting
 * Journal (Stage 5): `run` scopes navigation/links to one Backtest Run, dims
 * days outside its period or trading weekdays, marks closed days, shows missed
 * setups, and hides money (backtests are R-first).
 */
export function JournalCalendar({
  noteDates,
  dailyPerformance,
  run,
  onVisibleMonthChange,
}: {
  noteDates: string[];
  dailyPerformance: DailyPerformanceSummaryDTO[];
  run?: JournalCalendarRunContext;
  /** Reports the visible month (first day, local) — for a period summary. */
  onVisibleMonthChange?: (month: Date) => void;
}) {
  const router = useRouter();
  const hrefBase = run?.hrefBase ?? "/journal";
  const closedDateSet = useMemo(() => new Set(run?.closedDates ?? []), [run?.closedDates]);
  const isInRange = useMemo(
    () =>
      run
        ? (key: string) =>
            key >= run.startDateKey && key <= run.endDateKey && run.tradingWeekdays.includes(keyToLocalDate(key).getDay())
        : undefined,
    [run],
  );
  const noteDateSet = useMemo(() => new Set(noteDates), [noteDates]);
  const dailyPerformanceMap = useMemo(
    () => new Map(dailyPerformance.map((d) => [d.dateKey, d])),
    [dailyPerformance],
  );
  const [view, setView] = useState<"month" | "year">("month");
  const [month, setMonthState] = useState<Date>(run ? keyToLocalDate(run.initialDateKey) : new Date());
  function setMonth(next: Date) {
    setMonthState(next);
    onVisibleMonthChange?.(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  function goToDay(date: Date) {
    const key = localDateToKey(date);
    if (isInRange && !isInRange(key)) return;
    router.push(`${hrefBase}/${key}`);
  }

  function goToDayKey(dateKey: string) {
    if (isInRange && !isInRange(dateKey)) return;
    router.push(`${hrefBase}/${dateKey}`);
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
        {run ? (
          <Button variant="outline" size="sm" onClick={() => setMonth(keyToLocalDate(run.initialDateKey))}>
            Current position
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>
            Today
          </Button>
        )}
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
              <JournalDayButton
                {...props}
                noteDates={noteDateSet}
                dailyPerformance={dailyPerformanceMap}
                hrefBase={hrefBase}
                isInRange={isInRange}
                closedDates={run ? closedDateSet : undefined}
                showMissed={!!run}
              />
            ),
            Weekdays: JournalWeekdaysRow,
            Week: (props) => <JournalWeekRow {...props} dailyPerformance={dailyPerformanceMap} showPnl={!run} />,
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
          isDayAvailable={isInRange}
          unavailableLabel={run ? "Outside run" : undefined}
          showPnl={!run}
        />
      )}
    </div>
  );
}
