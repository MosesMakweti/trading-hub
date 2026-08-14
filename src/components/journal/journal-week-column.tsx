"use client";

import type { CSSProperties } from "react";
import type { WeekProps, WeekdaysProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { localDateToKey } from "@/lib/date";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";

interface DailyPnl {
  pnl: number;
  percent: number;
  tradeCount: number;
}

// A week's background tint scales with how big the week was (in % return, so
// it's comparable across weeks/accounts without needing the account balance):
// ±GRADIENT_CAP_PERCENT or beyond reaches full intensity, smaller weeks fade
// toward transparent — a gradient, not a flat win/loss color.
const GRADIENT_CAP_PERCENT = 3;
const MIN_ALPHA = 8;
const MAX_ALPHA = 60;

// Trailing "Week" column, matching the width reserved by `JournalWeekdaysRow`
// below — a `<td>` appended to each calendar row (react-day-picker's `Week`
// wraps a `<tr>`; `children` are the day `<td>`s already rendered by the
// library, so this only adds the trailing cell without touching day layout).
const WEEK_COL = "w-16 shrink-0 sm:w-20 lg:w-24";

export function JournalWeekdaysRow({ children, className, ...props }: WeekdaysProps) {
  return (
    <thead aria-hidden>
      <tr className={className} {...props}>
        {children}
        <th className={cn(WEEK_COL, "text-[0.7rem] font-normal text-muted-foreground")}>Week</th>
      </tr>
    </thead>
  );
}

export function JournalWeekRow({
  week,
  children,
  className,
  dailyPnl,
  ...props
}: WeekProps & { dailyPnl: Map<string, DailyPnl> }) {
  let total = 0;
  let percent = 0;
  let tradeCount = 0;
  for (const day of week.days) {
    const entry = dailyPnl.get(localDateToKey(day.date));
    if (!entry) continue;
    total += entry.pnl;
    percent += entry.percent;
    tradeCount += entry.tradeCount;
  }
  const hasTrades = tradeCount > 0;
  const tone = !hasTrades ? "muted" : total > 0 ? "success" : total < 0 ? "danger" : "muted";

  // Gradient background: only win/loss weeks get a tint, scaled by |percent|.
  const intensity = Math.min(Math.abs(percent) / GRADIENT_CAP_PERCENT, 1);
  const alpha = MIN_ALPHA + intensity * (MAX_ALPHA - MIN_ALPHA);
  const bgStyle: CSSProperties | undefined =
    tone === "success" || tone === "danger"
      ? { backgroundColor: `color-mix(in oklab, var(--${tone}) ${alpha}%, transparent)` }
      : undefined;

  return (
    <tr className={className} {...props}>
      {children}
      <td
        style={bgStyle}
        className={cn(
          WEEK_COL,
          "flex flex-col items-center justify-center gap-0.5 border-l border-foreground/10 px-1 text-center transition-colors",
        )}
        aria-label={hasTrades ? `Week total: ${formatSignedCurrency(total)}` : "Week total: no trades"}
      >
        <span className="text-[9px] leading-none tracking-wide text-muted-foreground uppercase">Week</span>
        <span
          className={cn(
            "text-xs leading-tight font-semibold tabular-nums",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {hasTrades ? formatSignedCurrency(total) : "—"}
        </span>
      </td>
    </tr>
  );
}
