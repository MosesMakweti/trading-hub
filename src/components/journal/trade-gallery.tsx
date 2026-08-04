"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Images } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { TradeGalleryCard } from "@/components/journal/trade-gallery-card";
import { TradeFilterBar } from "@/components/journal/trade-filter-bar";
import { EMPTY_TRADE_FILTERS, filterTrades, type TradeFilters } from "@/domain/trades/filter";
import type { TradeWorkspaceDTO } from "@/types/trades";

/** The Trade Gallery: every trade as a card, newest first, with live filters (P8/P9). */
export function TradeGallery({ trades }: { trades: TradeWorkspaceDTO[] }) {
  const [filters, setFilters] = useState<TradeFilters>(EMPTY_TRADE_FILTERS);

  const assets = useMemo(
    () => [...new Set(trades.map((t) => t.assetSymbol))].sort(),
    [trades],
  );
  const strategies = useMemo(
    () =>
      [...new Set(trades.map((t) => t.strategyName).filter((s): s is string => Boolean(s)))].sort(),
    [trades],
  );
  const filtered = useMemo(() => filterTrades(trades, filters), [trades, filters]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to calendar"
            nativeButton={false}
            render={<Link href="/journal" />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trade Gallery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length === trades.length
                ? `Every trade at a glance — ${trades.length} trade${trades.length === 1 ? "" : "s"}.`
                : `${filtered.length} of ${trades.length} trades.`}
            </p>
          </div>
        </div>
      </div>

      {trades.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No trades yet"
          description="Log trades from the journal or the Today workspace and they'll be catalogued here."
        />
      ) : (
        <>
          <TradeFilterBar
            filters={filters}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            onClear={() => setFilters(EMPTY_TRADE_FILTERS)}
            assets={assets}
            strategies={strategies}
          />

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No trades match these filters.
            </p>
          ) : (
            <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((trade) => (
                <StaggerItem key={trade.id}>
                  <TradeGalleryCard trade={trade} />
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </>
      )}
    </div>
  );
}
