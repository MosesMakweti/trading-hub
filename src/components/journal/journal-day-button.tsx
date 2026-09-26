"use client";

import type { ComponentProps } from "react";
import type { DayButton } from "react-day-picker";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { localDateToKey } from "@/lib/date";
import { deriveDayResultState } from "@/domain/trades/day-result-state";
import { formatRR } from "@/components/journal/workspace/workspace-ui";

interface DailyPerformance {
  executedTradeCount: number;
  cancelledCount: number;
  totalRealizedR: number;
  missedCount?: number;
}

export function JournalDayButton({
  day,
  modifiers,
  className,
  noteDates,
  dailyPerformance,
  hrefBase = "/journal",
  isInRange,
  closedDates,
  showMissed = false,
  ...props
}: ComponentProps<typeof DayButton> & {
  noteDates: Set<string>;
  dailyPerformance: Map<string, DailyPerformance>;
  /** Backtesting Journal (Stage 5) — the run's journal base path. */
  hrefBase?: string;
  /** Backtesting Journal — dates outside the run (or its weekdays) are inert. */
  isInRange?: (dateKey: string) => boolean;
  /** Backtesting Journal — closed (completed) simulated days. */
  closedDates?: Set<string>;
  showMissed?: boolean;
}) {
  const router = useRouter();
  const dateKey = localDateToKey(day.date);
  const inRange = isInRange ? isInRange(dateKey) : true;
  const closed = closedDates?.has(dateKey) ?? false;
  const missed = showMissed ? (dailyPerformance.get(dateKey)?.missedCount ?? 0) : 0;
  const hasNote = noteDates.has(dateKey);
  const entry = dailyPerformance.get(dateKey);
  const state = entry ? deriveDayResultState(entry.executedTradeCount, entry.totalRealizedR) : "NONE";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative flex aspect-square size-auto w-full flex-col items-center justify-center gap-0.5 border border-foreground/10 font-normal transition-colors hover:border-foreground/25",
        modifiers.today && "ring-1 ring-inset ring-primary/50",
        modifiers.outside && "text-muted-foreground opacity-40",
        !inRange && "pointer-events-none border-transparent text-muted-foreground/40",
        state === "WIN" && "bg-success/10 hover:bg-success/15",
        state === "LOSS" && "bg-danger/10 hover:bg-danger/15",
        className,
      )}
      onClick={() => router.push(`${hrefBase}/${dateKey}`)}
      {...props}
      disabled={!inRange || props.disabled}
    >
      <span className="text-sm tabular-nums">{day.date.getDate()}</span>
      {entry && entry.executedTradeCount > 0 && (
        <>
          <span
            className={cn(
              "text-[10px] font-semibold leading-none tabular-nums",
              state === "WIN" && "text-success",
              state === "LOSS" && "text-danger",
              state === "BREAKEVEN" && "text-muted-foreground",
            )}
          >
            {formatRR(entry.totalRealizedR)}
          </span>
          <span className="text-[9px] leading-none text-muted-foreground">
            {entry.executedTradeCount} trade{entry.executedTradeCount === 1 ? "" : "s"}
          </span>
        </>
      )}
      {entry && entry.cancelledCount > 0 && (
        <span className="text-[8px] leading-none text-muted-foreground/60">
          {entry.cancelledCount} cancelled
        </span>
      )}
      {missed > 0 && (
        <span className="text-[8px] leading-none text-warning/80">{missed} missed</span>
      )}
      {hasNote && <span className="absolute top-1.5 right-1.5 size-1 rounded-full bg-primary" />}
      {closed && (
        <span className="absolute top-1 left-1 size-1.5 rounded-full bg-foreground/60" aria-label="Completed day" title="Completed day" />
      )}
    </Button>
  );
}
