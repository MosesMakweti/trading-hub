"use client";

import type { CSSProperties } from "react";
import type { WeekProps, WeekdaysProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { localDateToKey } from "@/lib/date";
import { deriveDayResultState } from "@/domain/trades/day-result-state";
import { summarizePeriod, type DaySummaryLike } from "@/domain/journal/period-summary";
import { formatRR, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";


// A week's background tint scales with how big the week's realized R was:
// ±GRADIENT_CAP_R or beyond reaches full intensity, smaller weeks fade toward
// transparent — a gradient, not a flat win/loss color.
const GRADIENT_CAP_R = 3;
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
  dailyPerformance,
  showPnl = true,
  ...props
}: WeekProps & { dailyPerformance: Map<string, DaySummaryLike>; showPnl?: boolean }) {
  const weekKeys = new Set(week.days.map((day) => localDateToKey(day.date)));
  const { totalR, totalPnl, trades: tradeCount } = summarizePeriod(dailyPerformance.values(), (key) => weekKeys.has(key));
  const state = deriveDayResultState(tradeCount, totalR);
  const tone = state === "WIN" ? "success" : state === "LOSS" ? "danger" : "muted";

  // Gradient background: only win/loss weeks get a tint, scaled by |R|.
  const intensity = Math.min(Math.abs(totalR) / GRADIENT_CAP_R, 1);
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
        aria-label={tradeCount > 0 ? `Week total: ${formatRR(totalR)}${showPnl ? `, ${formatSignedCurrency(totalPnl)}` : ""}` : "Week total: no trades"}
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
          {tradeCount > 0 ? formatRR(totalR) : "—"}
        </span>
        {tradeCount > 0 && showPnl && (
          <span className="text-[9px] leading-none text-muted-foreground/70 tabular-nums">
            {formatSignedCurrency(totalPnl)}
          </span>
        )}
      </td>
    </tr>
  );
}
