"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

function formatPercent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function YearView({
  year,
  noteCountsByMonth,
  percentByMonth,
  onSelectMonth,
  onChangeYear,
}: {
  year: number;
  noteCountsByMonth: number[];
  percentByMonth: number[];
  onSelectMonth: (monthIndex: number) => void;
  onChangeYear: (year: number) => void;
}) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MONTH_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            onClick={() => onSelectMonth(i)}
            className="rounded-xl border border-border bg-background/40 p-4 text-left transition-colors hover:bg-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{name}</span>
              {percentByMonth[i] !== 0 && (
                <span
                  className={cn(
                    "text-xs font-semibold",
                    percentByMonth[i] > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {formatPercent(percentByMonth[i])}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {noteCountsByMonth[i] > 0
                ? `${noteCountsByMonth[i]} note${noteCountsByMonth[i] === 1 ? "" : "s"}`
                : "No notes"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
