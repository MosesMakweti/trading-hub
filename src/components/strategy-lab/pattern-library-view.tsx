"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Crosshair, Library, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { StrategyStatusBadge } from "@/components/strategy-lab/strategy-status-badge";
import { filterPatterns } from "@/domain/strategies/patterns";
import type { PatternDTO } from "@/types/strategies";

function PatternCard({ pattern }: { pattern: PatternDTO }) {
  const preview = pattern.conditionsPreview || pattern.descriptionPreview;
  return (
    <div className="glass space-y-2 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="bg-brand-gradient inline-flex size-7 shrink-0 items-center justify-center rounded-full text-white shadow-glow">
            <Crosshair className="size-4" />
          </span>
          <span className="truncate font-semibold">{pattern.name}</span>
        </div>
        <StrategyStatusBadge status={pattern.strategyStatus} />
      </div>

      {preview && <p className="line-clamp-2 text-sm text-muted-foreground">{preview}</p>}

      <Link
        href={`/strategy-lab/${pattern.strategyId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        <Library className="size-3" />
        {pattern.strategyName}
      </Link>
    </div>
  );
}

export function PatternLibraryView({ patterns }: { patterns: PatternDTO[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterPatterns(patterns, query), [patterns, query]);

  const strategyCount = new Set(patterns.map((p) => p.strategyId)).size;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to Strategy Lab"
          nativeButton={false}
          render={<Link href="/strategy-lab" />}
        >
          <ChevronLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pattern Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every entry model across your strategies — your whole library of setups in one place.
          </p>
        </div>
      </div>

      {patterns.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title="No patterns yet"
          description="Add entry models to your strategies (Strategy → Entry Models) and they'll be catalogued here as a searchable library of setups."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patterns, strategies, conditions…"
                className="pl-9"
                aria-label="Search patterns"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {patterns.length} pattern{patterns.length === 1 ? "" : "s"} ·{" "}
              {strategyCount} strateg{strategyCount === 1 ? "y" : "ies"}
            </p>
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No patterns match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <StaggerList className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((pattern) => (
                <StaggerItem key={pattern.id}>
                  <PatternCard pattern={pattern} />
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </>
      )}
    </div>
  );
}
