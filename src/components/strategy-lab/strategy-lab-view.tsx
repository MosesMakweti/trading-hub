"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FlaskConical, Library, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { CreateStrategyDialog } from "@/components/strategy-lab/create-strategy-dialog";
import { StrategyCard } from "@/components/strategy-lab/strategy-card";
import {
  STRATEGY_STATUS_META,
  STRATEGY_STATUS_ORDER,
} from "@/components/strategy-lab/strategy-status-badge";
import type { StrategyStatusValue } from "@/lib/validation/strategies";
import type { StrategyDTO } from "@/types/strategies";

type Filter = "ALL" | StrategyStatusValue;

export function StrategyLabView({ strategies }: { strategies: StrategyDTO[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: strategies.length, DRAFT: 0, TESTING: 0, LIVE: 0, ARCHIVED: 0 };
    for (const s of strategies) c[s.status] += 1;
    return c;
  }, [strategies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return strategies.filter((s) => {
      if (filter !== "ALL" && s.status !== filter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        s.applicableAssets.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [strategies, query, filter]);

  const filters: Filter[] = ["ALL", ...STRATEGY_STATUS_ORDER];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Strategy Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Design, document, and refine your trading strategies — your personal methodology base.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href="/strategy-lab/patterns" />}
          >
            <Library className="size-4" />
            Pattern library
          </Button>
          <CreateStrategyDialog />
        </div>
      </div>

      {strategies.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No strategies yet"
          description="Create your first strategy — think ICT London Model, NASDAQ Trend Continuation, or a Gold Reversal playbook."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search strategies, assets…"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filters.map((f) => {
                const label = f === "ALL" ? "All" : STRATEGY_STATUS_META[f].label;
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {label}
                    <span className="ml-1 text-[10px] opacity-70">{counts[f]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="glass rounded-2xl px-6 py-12 text-center text-sm text-muted-foreground">
              No strategies match your search.
            </div>
          ) : (
            <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((strategy) => (
                <StaggerItem key={strategy.id} className="h-full">
                  <StrategyCard strategy={strategy} />
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </>
      )}
    </div>
  );
}
