"use client";

import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hasActiveFilters, type TradeFilters } from "@/domain/trades/filter";

function FilterSelect({
  value,
  allLabel,
  options,
  onSelect,
}: {
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onSelect: (v: string | null) => void;
}) {
  const items = [{ value: "all", label: allLabel }, ...options];
  return (
    <Select
      items={items}
      value={value ?? "all"}
      onValueChange={(v) => onSelect(v && v !== "all" ? v : null)}
    >
      <SelectTrigger className="h-9 w-auto min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TradeFilterBar({
  filters,
  onChange,
  onClear,
  assets,
  strategies,
}: {
  filters: TradeFilters;
  onChange: (patch: Partial<TradeFilters>) => void;
  onClear: () => void;
  assets: string[];
  strategies: string[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search asset or strategy…"
            className="pl-9"
            aria-label="Search trades"
          />
        </div>
        {hasActiveFilters(filters) && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClear}>
            <X className="size-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          value={filters.direction}
          allLabel="Any direction"
          options={[
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
          onSelect={(v) => onChange({ direction: v as TradeFilters["direction"] })}
        />
        <FilterSelect
          value={filters.result}
          allLabel="All results"
          options={[
            { value: "WIN", label: "Winners" },
            { value: "LOSS", label: "Losers" },
            { value: "OPEN", label: "Open" },
          ]}
          onSelect={(v) => onChange({ result: v as TradeFilters["result"] })}
        />
        <FilterSelect
          value={filters.status}
          allLabel="Any status"
          options={[
            { value: "OPEN", label: "Open" },
            { value: "CLOSED", label: "Closed" },
            { value: "REVIEWED", label: "Reviewed" },
          ]}
          onSelect={(v) => onChange({ status: v as TradeFilters["status"] })}
        />
        <FilterSelect
          value={filters.grade}
          allLabel="Any grade"
          options={["A", "B", "C", "D", "F"].map((g) => ({ value: g, label: `Grade ${g}` }))}
          onSelect={(v) => onChange({ grade: v as TradeFilters["grade"] })}
        />
        {assets.length > 0 && (
          <FilterSelect
            value={filters.asset}
            allLabel="All assets"
            options={assets.map((a) => ({ value: a, label: a }))}
            onSelect={(v) => onChange({ asset: v })}
          />
        )}
        {strategies.length > 0 && (
          <FilterSelect
            value={filters.strategy}
            allLabel="All strategies"
            options={strategies.map((s) => ({ value: s, label: s }))}
            onSelect={(v) => onChange({ strategy: v })}
          />
        )}
      </div>
    </div>
  );
}
