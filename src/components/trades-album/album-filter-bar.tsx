"use client";

import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hasActiveFilters, type TradeFilters } from "@/domain/trades/filter";
import { ALBUM_SORT_OPTIONS, type AlbumSort } from "@/domain/trades/album-sort";

function FilterSelect({
  value,
  allLabel,
  label,
  options,
  onSelect,
}: {
  value: string | null;
  allLabel: string;
  label: string;
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
      <SelectTrigger className="h-9 w-auto min-w-32" aria-label={`Filter by ${label}`}>
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

export function AlbumFilterBar({
  filters,
  onChange,
  onClear,
  sort,
  onSortChange,
  assets,
  strategies,
  sessions,
  propFirmAccountOptions = [],
  propFirmOptions = [],
}: {
  filters: TradeFilters;
  onChange: (patch: Partial<TradeFilters>) => void;
  onClear: () => void;
  sort: AlbumSort;
  onSortChange: (sort: AlbumSort) => void;
  assets: string[];
  strategies: string[];
  sessions: string[];
  propFirmAccountOptions?: { id: string; label: string }[];
  propFirmOptions?: { id: string; label: string }[];
}) {
  const resultTab = filters.result === "WIN" ? "WIN" : filters.result === "LOSS" ? "LOSS" : "ALL";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={resultTab}
          onValueChange={(v) =>
            onChange({ result: v === "ALL" ? null : (v as TradeFilters["result"]) })
          }
        >
          <TabsList>
            <TabsTrigger value="ALL">All Trades</TabsTrigger>
            <TabsTrigger value="WIN">Winning</TabsTrigger>
            <TabsTrigger value="LOSS">Losing</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select
          items={ALBUM_SORT_OPTIONS}
          value={sort}
          onValueChange={(v) => onSortChange(v as AlbumSort)}
        >
          <SelectTrigger className="h-9 w-auto min-w-40" aria-label="Sort trades">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALBUM_SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

        <FilterSelect
          value={filters.direction}
          allLabel="Any direction"
          label="direction"
          options={[
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
          onSelect={(v) => onChange({ direction: v as TradeFilters["direction"] })}
        />
        {strategies.length > 0 && (
          <FilterSelect
            value={filters.strategy}
            allLabel="All strategies"
            label="strategy"
            options={strategies.map((s) => ({ value: s, label: s }))}
            onSelect={(v) => onChange({ strategy: v })}
          />
        )}
        {assets.length > 0 && (
          <FilterSelect
            value={filters.asset}
            allLabel="All assets"
            label="asset"
            options={assets.map((a) => ({ value: a, label: a }))}
            onSelect={(v) => onChange({ asset: v })}
          />
        )}
        {sessions.length > 0 && (
          <FilterSelect
            value={filters.session}
            allLabel="Any session"
            label="session"
            options={sessions.map((s) => ({ value: s, label: s }))}
            onSelect={(v) => onChange({ session: v })}
          />
        )}
        <FilterSelect
          value={filters.minAdherence != null ? String(filters.minAdherence) : null}
          allLabel="Any adherence"
          label="adherence"
          options={[
            { value: "80", label: "80%+" },
            { value: "60", label: "60%+" },
            { value: "40", label: "40%+" },
          ]}
          onSelect={(v) => onChange({ minAdherence: v ? Number(v) : null })}
        />
        {propFirmOptions.length > 0 && (
          <FilterSelect
            value={filters.propFirmId}
            allLabel="All prop firms"
            label="prop firm"
            options={propFirmOptions.map((f) => ({ value: f.id, label: f.label }))}
            onSelect={(v) => onChange({ propFirmId: v })}
          />
        )}
        {propFirmAccountOptions.length > 0 && (
          <FilterSelect
            value={filters.propFirmAccountId}
            allLabel="All accounts"
            label="account"
            options={propFirmAccountOptions.map((a) => ({ value: a.id, label: a.label }))}
            onSelect={(v) => onChange({ propFirmAccountId: v })}
          />
        )}
        {propFirmOptions.length > 0 && (
          <>
            <FilterSelect
              value={filters.marketCategory}
              allLabel="CFD & Futures"
              label="market category"
              options={[
                { value: "CFD", label: "CFD" },
                { value: "FUTURES", label: "Futures" },
              ]}
              onSelect={(v) => onChange({ marketCategory: v as TradeFilters["marketCategory"] })}
            />
            <FilterSelect
              value={filters.fundedOrChallenge}
              allLabel="Funded & Challenge"
              label="funded or challenge"
              options={[
                { value: "FUNDED", label: "Funded" },
                { value: "CHALLENGE", label: "Challenge" },
              ]}
              onSelect={(v) => onChange({ fundedOrChallenge: v as TradeFilters["fundedOrChallenge"] })}
            />
          </>
        )}

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) => onChange({ dateFrom: e.target.value || null })}
            className="h-9 w-auto"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) => onChange({ dateTo: e.target.value || null })}
            className="h-9 w-auto"
            aria-label="To date"
          />
        </div>

        {hasActiveFilters(filters) && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClear}>
            <X className="size-3.5" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
