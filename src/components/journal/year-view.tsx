"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localDateToKey, formatDateKeyShort } from "@/lib/date";
import { formatRR, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { deriveDayResultState } from "@/domain/trades/day-result-state";

interface DailyPerformance {
  executedTradeCount: number;
  cancelledCount: number;
  totalRealizedR: number;
  totalPnl: number;
  wins: number;
  losses: number;
}

type DayState = "win" | "loss" | "breakeven" | "none" | "future";

interface DayCell {
  day: number;
  dateKey: string;
  state: DayState;
  isToday: boolean;
  entry: DailyPerformance | undefined;
}

interface MonthData {
  index: number;
  name: string;
  totalR: number;
  leadingBlanks: number;
  cells: DayCell[];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function buildMonths(
  year: number,
  dailyPerformance: Map<string, DailyPerformance>,
  isAvailable: (dateKey: string) => boolean,
  todayKey: string | null,
): MonthData[] {
  return MONTH_NAMES.map((name, index) => {
    const daysInMonth = new Date(year, index + 1, 0).getDate();
    const leadingBlanks = new Date(year, index, 1).getDay();

    let totalR = 0;
    const cells: DayCell[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${pad(index + 1)}-${pad(day)}`;
      const entry = dailyPerformance.get(dateKey);
      const isFuture = !isAvailable(dateKey);
      const resultState = deriveDayResultState(entry?.executedTradeCount ?? 0, entry?.totalRealizedR ?? 0);
      const state: DayState = isFuture
        ? "future"
        : resultState === "NONE"
          ? "none"
          : resultState === "WIN"
            ? "win"
            : resultState === "LOSS"
              ? "loss"
              : "breakeven";
      if (entry) totalR += entry.totalRealizedR;
      cells.push({ day, dateKey, state, isToday: todayKey != null && dateKey === todayKey, entry });
    }

    return { index, name, totalR, leadingBlanks, cells };
  });
}

// Translucent tints — the number is the primary signal now, color is a wash
// behind it rather than a solid block.
const STATE_BG: Record<DayState, string> = {
  win: "bg-success/20 hover:bg-success/30",
  loss: "bg-danger/20 hover:bg-danger/30",
  breakeven: "bg-muted-foreground/20 hover:bg-muted-foreground/30",
  none: "bg-foreground/[0.05] hover:bg-foreground/[0.09]",
  future: "bg-foreground/[0.02]",
};
const STATE_TEXT: Record<DayState, string> = {
  win: "text-success",
  loss: "text-danger",
  breakeven: "text-muted-foreground",
  none: "text-muted-foreground/50",
  future: "text-muted-foreground/25",
};
// Legend swatches stay a touch bolder than the actual (translucent) cells so
// the color key itself is easy to read.
const LEGEND_DOT: Record<DayState, string> = {
  win: "bg-success/60",
  loss: "bg-danger/60",
  breakeven: "bg-muted-foreground/50",
  none: "bg-foreground/10",
  future: "bg-foreground/5",
};

function YearDayCell({ cell, onSelectDay, showPnl }: { cell: DayCell; onSelectDay: (dateKey: string) => void; showPnl: boolean }) {
  const base = cn(
    "flex aspect-square items-center justify-center rounded-sm text-[9px] leading-none tabular-nums transition-colors",
    STATE_BG[cell.state],
    STATE_TEXT[cell.state],
    cell.isToday && "ring-1 ring-inset ring-primary/60",
  );

  if (cell.state === "future") {
    return (
      <div aria-hidden className={base}>
        {cell.day}
      </div>
    );
  }

  const { entry } = cell;
  const hasTrades = !!entry && entry.executedTradeCount > 0;

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        onClick={() => onSelectDay(cell.dateKey)}
        className={cn(base, "cursor-pointer font-medium")}
        aria-label={`${formatDateKeyShort(cell.dateKey)}${hasTrades ? `, ${formatRR(entry.totalRealizedR)}` : ", no trades"}`}
      >
        {cell.day}
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="space-y-0.5">
          <div className="font-medium">{formatDateKeyShort(cell.dateKey)}</div>
          <div className="text-[11px] opacity-90">
            {hasTrades
              ? `${formatRR(entry.totalRealizedR)}${showPnl ? ` (${formatSignedCurrency(entry.totalPnl)})` : ""} · ${entry.executedTradeCount} trade${entry.executedTradeCount === 1 ? "" : "s"} · ${entry.wins}W / ${entry.losses}L`
              : entry && entry.cancelledCount > 0
                ? `No executed trades · ${entry.cancelledCount} cancelled`
                : "No trades"}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const LEGEND_BASE: { state: DayState; label: string }[] = [
  { state: "win", label: "Win" },
  { state: "loss", label: "Loss" },
  { state: "breakeven", label: "Breakeven" },
  { state: "none", label: "No trades" },
];

export function YearView({
  year,
  dailyPerformance,
  onSelectMonth,
  onSelectDay,
  onChangeYear,
  isDayAvailable,
  unavailableLabel = "Upcoming",
  showPnl = true,
}: {
  year: number;
  dailyPerformance: Map<string, DailyPerformance>;
  onSelectMonth: (monthIndex: number) => void;
  onSelectDay: (dateKey: string) => void;
  onChangeYear: (year: number) => void;
  /** Backtesting (Stage 5): which dates belong to the run; defaults to "not in
   *  the future" (the live Journal). Unavailable days render muted/inert. */
  isDayAvailable?: (dateKey: string) => boolean;
  unavailableLabel?: string;
  showPnl?: boolean;
}) {
  const todayKey = useMemo(() => (isDayAvailable ? null : localDateToKey(new Date())), [isDayAvailable]);
  const months = useMemo(
    () => buildMonths(year, dailyPerformance, isDayAvailable ?? ((key) => key <= localDateToKey(new Date())), todayKey),
    [year, dailyPerformance, isDayAvailable, todayKey],
  );
  const legend = [...LEGEND_BASE, { state: "future" as DayState, label: unavailableLabel }];

  return (
    <div className="glass space-y-5 rounded-2xl p-4">
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous year"
          onClick={() => onChangeYear(year - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium">{year}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next year"
          onClick={() => onChangeYear(year + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => (
          <div key={m.index} className="rounded-xl border border-foreground/10 bg-background/40 p-3">
            <button
              type="button"
              onClick={() => onSelectMonth(m.index)}
              className="mb-2 flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent"
            >
              <span className="text-sm font-medium">{m.name}</span>
              {m.totalR !== 0 && (
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    m.totalR > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {formatRR(m.totalR)}
                </span>
              )}
            </button>

            <div className="grid grid-cols-7 gap-[3px] px-1">
              {WEEKDAY_LABELS.map((label, i) => (
                <span
                  key={`${m.index}-wd-${i}`}
                  className="text-center text-[8px] leading-none text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {Array.from({ length: m.leadingBlanks }).map((_, i) => (
                <div key={`${m.index}-blank-${i}`} />
              ))}
              {m.cells.map((cell) => (
                <YearDayCell key={cell.dateKey} cell={cell} onSelectDay={onSelectDay} showPnl={showPnl} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-foreground/10 pt-3">
        {legend.map(({ state, label }) => (
          <div key={state} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", LEGEND_DOT[state])} />
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
