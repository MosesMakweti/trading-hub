"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

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

export function YearView({
  year,
  noteCountsByMonth,
  onSelectMonth,
  onChangeYear,
}: {
  year: number;
  noteCountsByMonth: number[];
  onSelectMonth: (monthIndex: number) => void;
  onChangeYear: (year: number) => void;
}) {
  return (
    <div className="glass space-y-5 rounded-2xl p-4">
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon-sm" onClick={() => onChangeYear(year - 1)}>
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium">{year}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onChangeYear(year + 1)}>
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
            <div className="font-medium">{name}</div>
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
