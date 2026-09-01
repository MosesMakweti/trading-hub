"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import type { DayButton } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { localDateToKey } from "@/lib/date";
import { calendarColorForPercent } from "@/domain/performance/rr";

interface DailyPnl {
  dateKey: string;
  percent: number;
  tradeCount: number;
}

function MiniDayButton({
  day,
  modifiers,
  className,
  dailyPnl,
  ...props
}: ComponentProps<typeof DayButton> & { dailyPnl: Map<string, DailyPnl> }) {
  const router = useRouter();
  const dateKey = localDateToKey(day.date);
  const pnl = dailyPnl.get(dateKey);
  const color = pnl ? calendarColorForPercent(pnl.percent, pnl.tradeCount) : "gray";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "aspect-square size-auto w-full border border-foreground/10 text-xs font-normal tabular-nums transition-colors hover:border-foreground/25",
        modifiers.today && "ring-1 ring-inset ring-primary/50",
        modifiers.outside && "text-muted-foreground opacity-30",
        pnl && pnl.tradeCount > 0 && color === "green" && "bg-success/10 hover:bg-success/15",
        pnl && pnl.tradeCount > 0 && color === "red" && "bg-danger/10 hover:bg-danger/15",
        className,
      )}
      onClick={() => router.push(`/journal/${dateKey}`)}
      {...props}
    >
      {day.date.getDate()}
    </Button>
  );
}

/**
 * A glanceable month view for the Dashboard — same day-coloring convention as
 * the full Journal calendar (`journal-calendar.tsx`, `calendarColorForPercent`)
 * at a much smaller cell size, with the per-day %/trade-count/note-dot detail
 * dropped (that stays exclusive to the full page — this is a summary widget,
 * not a duplicate of the Journal module).
 */
export function MiniJournalCalendar({ dailyPnl }: { dailyPnl: DailyPnl[] }) {
  const router = useRouter();
  const [month, setMonth] = useState<Date>(new Date());
  const dailyPnlMap = useMemo(() => new Map(dailyPnl.map((d) => [d.dateKey, d])), [dailyPnl]);

  return (
    <div className="glass space-y-2 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Journal</h3>
        <Link href="/journal" className="text-xs font-medium text-primary hover:underline">
          Open journal →
        </Link>
      </div>
      <Calendar
        month={month}
        onMonthChange={setMonth}
        onDayClick={(date) => router.push(`/journal/${localDateToKey(date)}`)}
        className="w-full max-w-none p-0 [--cell-size:2rem]"
        classNames={{ months: "w-full", month: "w-full", month_grid: "w-full" }}
        components={{
          DayButton: (props) => <MiniDayButton {...props} dailyPnl={dailyPnlMap} />,
        }}
      />
    </div>
  );
}
