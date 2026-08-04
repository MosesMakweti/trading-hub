"use client";

import type { ComponentProps } from "react";
import type { DayButton } from "react-day-picker";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { localDateToKey } from "@/lib/date";
import { calendarColorForPercent } from "@/domain/performance/rr";

interface DailyPnl {
  percent: number;
  tradeCount: number;
}

function formatPercent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function JournalDayButton({
  day,
  modifiers,
  className,
  noteDates,
  dailyPnl,
  ...props
}: ComponentProps<typeof DayButton> & {
  noteDates: Set<string>;
  dailyPnl: Map<string, DailyPnl>;
}) {
  const router = useRouter();
  const dateKey = localDateToKey(day.date);
  const hasNote = noteDates.has(dateKey);
  const pnl = dailyPnl.get(dateKey);
  const color = pnl ? calendarColorForPercent(pnl.percent, pnl.tradeCount) : "gray";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative flex aspect-square size-auto w-full flex-col items-center justify-center gap-0.5 border-0 font-normal",
        modifiers.today && "ring-1 ring-inset ring-primary/50",
        modifiers.outside && "text-muted-foreground opacity-40",
        color === "green" && "bg-success/10 hover:bg-success/15",
        color === "red" && "bg-danger/10 hover:bg-danger/15",
        className,
      )}
      onClick={() => router.push(`/journal/${dateKey}`)}
      {...props}
    >
      <span className="text-sm tabular-nums">{day.date.getDate()}</span>
      {pnl && pnl.tradeCount > 0 && (
        <>
          <span
            className={cn(
              "text-[10px] font-semibold leading-none tabular-nums",
              color === "green" && "text-success",
              color === "red" && "text-danger",
              color === "gray" && "text-muted-foreground",
            )}
          >
            {formatPercent(pnl.percent)}
          </span>
          <span className="text-[9px] leading-none text-muted-foreground">
            {pnl.tradeCount} trade{pnl.tradeCount === 1 ? "" : "s"}
          </span>
        </>
      )}
      {hasNote && <span className="absolute top-1.5 right-1.5 size-1 rounded-full bg-primary" />}
    </Button>
  );
}
