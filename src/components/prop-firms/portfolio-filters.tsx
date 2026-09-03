"use client";

import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PortfolioFilter = "ALL" | "PRIORITY" | "ACTIVE" | "CHALLENGES" | "FUNDED" | "AT_RISK" | "ARCHIVED";

const FILTER_LABELS: Record<PortfolioFilter, string> = {
  ALL: "All firms",
  PRIORITY: "Priority firms only",
  ACTIVE: "Active",
  CHALLENGES: "Challenges",
  FUNDED: "Funded",
  AT_RISK: "At risk",
  ARCHIVED: "Archived",
};

export interface DateRange {
  from: string | null;
  to: string | null;
}

export function PortfolioFilters({
  filter,
  onFilterChange,
  dateRange,
  onDateRangeChange,
}: {
  filter: PortfolioFilter;
  onFilterChange: (filter: PortfolioFilter) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}) {
  const hasActive = filter !== "ALL" || dateRange.from || dateRange.to;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select items={FILTER_LABELS} value={filter} onValueChange={(v) => onFilterChange(v as PortfolioFilter)}>
        <SelectTrigger className="h-9 w-auto min-w-40" aria-label="Filter accounts">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(FILTER_LABELS) as [PortfolioFilter, string][]).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={dateRange.from ?? ""}
          onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value || null })}
          className="h-9 w-auto"
          aria-label="Purchased from date"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={dateRange.to ?? ""}
          onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value || null })}
          className="h-9 w-auto"
          aria-label="Purchased to date"
        />
      </div>

      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            onFilterChange("ALL");
            onDateRangeChange({ from: null, to: null });
          }}
        >
          <X className="size-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
