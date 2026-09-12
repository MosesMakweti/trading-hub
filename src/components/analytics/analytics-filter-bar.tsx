"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsFilterOptions } from "@/server/services/analytics.service";
import type { CanonicalFilterOptionsDTO } from "@/server/services/analytics-canonical.service";

const ALL = "__all__";

// URL param key for each filter dimension.
const PARAMS = [
  "strategy",
  "entryModel",
  "asset",
  "direction",
  "session",
  "account",
  "winLoss",
  "status",
  // Stage 10 — additive filters for the canonical (R-primary) dataset.
  "setupType",
  "validationState",
  "behaviourLabel",
  "moodTag",
] as const;
type FilterParam = (typeof PARAMS)[number];

type Option = { value: string; label: string };

/**
 * Global Analytics filter bar. Each dimension is a URL search param, so filters
 * are shareable/bookmarkable and every section re-derives together on the server
 * (getAnalyticsData applies them). Date range stays in the separate DateRangeFilter.
 */
export function AnalyticsFilterBar({
  options,
  canonicalOptions,
}: {
  options: AnalyticsFilterOptions;
  /** Stage 10 — Setup Type / behaviour label / mood tag options, additive to
   *  the existing filter dimensions above (undefined = hide those selects,
   *  so any other caller of this bar is unaffected). */
  canonicalOptions?: CanonicalFilterOptionsDTO;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setFilter(param: FilterParam, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value == null) params.delete(param);
    else params.set(param, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const p of PARAMS) params.delete(p);
    router.push(`${pathname}?${params.toString()}`);
  }

  const strategyOpts: Option[] = options.strategies.map((s) => ({ value: s.id, label: s.name }));
  const accountOpts: Option[] = options.accounts.map((a) => ({ value: a.id, label: a.name }));
  const selfOpts = (xs: string[]): Option[] => xs.map((x) => ({ value: x, label: x }));

  const activeCount = PARAMS.filter((p) => searchParams.get(p)).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {strategyOpts.length > 0 && (
        <FilterSelect param="strategy" label="Strategy" options={strategyOpts} value={searchParams.get("strategy")} onChange={setFilter} />
      )}
      {options.entryModels.length > 0 && (
        <FilterSelect param="entryModel" label="Entry Model" options={selfOpts(options.entryModels)} value={searchParams.get("entryModel")} onChange={setFilter} />
      )}
      {options.assets.length > 0 && (
        <FilterSelect param="asset" label="Asset" options={selfOpts(options.assets)} value={searchParams.get("asset")} onChange={setFilter} />
      )}
      <FilterSelect
        param="direction"
        label="Direction"
        options={[
          { value: "LONG", label: "Long" },
          { value: "SHORT", label: "Short" },
        ]}
        value={searchParams.get("direction")}
        onChange={setFilter}
      />
      {options.sessions.length > 0 && (
        <FilterSelect param="session" label="Session" options={selfOpts(options.sessions)} value={searchParams.get("session")} onChange={setFilter} />
      )}
      {accountOpts.length > 0 && (
        <FilterSelect param="account" label="Account" options={accountOpts} value={searchParams.get("account")} onChange={setFilter} />
      )}
      <FilterSelect
        param="winLoss"
        label="Result"
        options={[
          { value: "win", label: "Winners" },
          { value: "loss", label: "Losers" },
        ]}
        value={searchParams.get("winLoss")}
        onChange={setFilter}
      />
      <FilterSelect
        param="status"
        label="Status"
        options={[
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
          { value: "REVIEWED", label: "Reviewed" },
        ]}
        value={searchParams.get("status")}
        onChange={setFilter}
      />

      {canonicalOptions && canonicalOptions.setupTypes.length > 0 && (
        <FilterSelect
          param="setupType"
          label="Setup Type"
          options={selfOpts(canonicalOptions.setupTypes)}
          value={searchParams.get("setupType")}
          onChange={setFilter}
        />
      )}
      {canonicalOptions && (
        <FilterSelect
          param="validationState"
          label="Validation"
          options={[
            { value: "VALIDATED", label: "Validated" },
            { value: "OVERRIDDEN", label: "Overridden" },
            { value: "NOT_VALIDATED", label: "Not validated" },
          ]}
          value={searchParams.get("validationState")}
          onChange={setFilter}
        />
      )}
      {canonicalOptions && canonicalOptions.behaviourLabels.length > 0 && (
        <FilterSelect
          param="behaviourLabel"
          label="Behaviour"
          options={selfOpts(canonicalOptions.behaviourLabels)}
          value={searchParams.get("behaviourLabel")}
          onChange={setFilter}
        />
      )}
      {canonicalOptions && canonicalOptions.moodTags.length > 0 && (
        <FilterSelect
          param="moodTag"
          label="Mood"
          options={selfOpts(canonicalOptions.moodTags)}
          value={searchParams.get("moodTag")}
          onChange={setFilter}
        />
      )}

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearAll}>
          <X className="size-3.5" />
          Clear {activeCount}
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  param,
  label,
  options,
  value,
  onChange,
}: {
  param: FilterParam;
  label: string;
  options: Option[];
  value: string | null;
  onChange: (param: FilterParam, value: string | null) => void;
}) {
  const current = value ?? ALL;
  const items = [{ value: ALL, label: `All ${label}` }, ...options];
  return (
    <Select
      items={items}
      value={current}
      onValueChange={(v) => onChange(param, v === ALL ? null : v)}
    >
      <SelectTrigger
        className={value ? "h-8 border-primary/50 text-xs" : "h-8 text-xs text-muted-foreground"}
        aria-label={label}
      >
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
