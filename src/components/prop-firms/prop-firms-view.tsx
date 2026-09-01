"use client";

import { useMemo, useState } from "react";
import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { AddPropFirmDialog } from "@/components/prop-firms/add-prop-firm-dialog";
import { PropFirmCard } from "@/components/prop-firms/prop-firm-card";
import { MarketSwitch, type MarketCategory } from "@/components/prop-firms/market-switch";
import { MarketOverview } from "@/components/prop-firms/market-overview";
import { PortfolioFilters, type DateRange, type PortfolioFilter } from "@/components/prop-firms/portfolio-filters";
import { PriorityReorderStrip } from "@/components/prop-firms/priority-reorder-strip";
import { PropFirmOverviewChart } from "@/components/prop-firms/prop-firm-overview-chart";
import { toAccountRollupInput } from "@/components/prop-firms/rollup";
import { aggregateAccounts, challengePassRatePercent, isFundedStageType } from "@/domain/prop-firms/metrics";
import type { OverviewAccountInput } from "@/domain/prop-firms/overview-series";
import type { DirectoryEntryDTO, PropFirmAccountDTO, UserPropFirmDTO } from "@/types/prop-firms";

function accountMatchesFilter(account: PropFirmAccountDTO, filter: PortfolioFilter): boolean {
  const activeStage = account.stages.find((s) => s.status === "ACTIVE");
  switch (filter) {
    case "ALL":
    case "PRIORITY":
      return true;
    case "ACTIVE":
      return account.status === "ACTIVE";
    case "CHALLENGES":
      return account.status === "ACTIVE" && !(activeStage && isFundedStageType(activeStage.type as never));
    case "FUNDED":
      return account.status === "FUNDED" || (account.status === "ACTIVE" && !!activeStage && isFundedStageType(activeStage.type as never));
    case "AT_RISK":
      return account.status === "ACTIVE" && account.currentBalance != null && account.currentBalance < account.startingBalance;
    case "ARCHIVED":
      return account.status === "ARCHIVED";
    default:
      return true;
  }
}

function accountMatchesDateRange(account: PropFirmAccountDTO, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  const key = (account.purchaseDate ?? account.createdAt).slice(0, 10);
  if (range.from && key < range.from) return false;
  if (range.to && key > range.to) return false;
  return true;
}

export function PropFirmsView({
  directory,
  firms,
  initialMarket,
  overviewAccounts,
}: {
  directory: DirectoryEntryDTO[];
  firms: UserPropFirmDTO[];
  initialMarket: MarketCategory;
  overviewAccounts: OverviewAccountInput[];
}) {
  const [market, setMarket] = useState<MarketCategory>(initialMarket);
  const [filter, setFilter] = useState<PortfolioFilter>("ALL");
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });

  const marketFirms = useMemo(() => firms.filter((f) => f.marketCategory === market), [firms, market]);
  const priorityFirms = useMemo(() => marketFirms.filter((f) => f.isPriority), [marketFirms]);

  const visibleFirms = useMemo(() => {
    return marketFirms
      .filter((f) => (filter === "PRIORITY" ? f.isPriority : true))
      .map((f) => ({
        firm: f,
        accounts:
          filter === "PRIORITY" || filter === "ALL"
            ? f.accounts.filter((a) => accountMatchesDateRange(a, dateRange))
            : f.accounts.filter((a) => accountMatchesFilter(a, filter) && accountMatchesDateRange(a, dateRange)),
      }))
      .filter(({ firm, accounts }) => accounts.length > 0 || (filter === "ALL" && firm.accounts.length === 0));
  }, [marketFirms, filter, dateRange]);

  const visibleAccounts = useMemo(() => visibleFirms.flatMap(({ accounts }) => accounts), [visibleFirms]);

  const visibleOverviewAccounts = useMemo(() => {
    const ids = new Set(visibleAccounts.map((a) => a.id));
    return overviewAccounts.filter((a) => ids.has(a.accountId));
  }, [overviewAccounts, visibleAccounts]);

  const metrics = useMemo(
    () => aggregateAccounts(visibleAccounts.map(toAccountRollupInput)),
    [visibleAccounts],
  );

  const passRate = useMemo(() => {
    const stages = visibleAccounts.flatMap((a) => a.stages);
    const resolved = stages.filter((s) => ["PASSED", "FAILED", "BREACHED", "ABANDONED"].includes(s.status));
    const passed = resolved.filter((s) => s.status === "PASSED");
    return challengePassRatePercent(passed.length, resolved.length);
  }, [visibleAccounts]);

  const totalAccountsInMarket = marketFirms.reduce((sum, f) => sum + f.accounts.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prop Firms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {marketFirms.length} firm{marketFirms.length === 1 ? "" : "s"} · {totalAccountsInMarket} account
            {totalAccountsInMarket === 1 ? "" : "s"} in {market === "CFD" ? "CFDs" : "Futures"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MarketSwitch market={market} onChange={setMarket} />
          <AddPropFirmDialog directory={directory} defaultMarket={market} />
        </div>
      </div>

      {firms.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No prop firms yet"
          description="Add a firm from the directory, or create a custom one, to start tracking purchased accounts."
        />
      ) : marketFirms.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={market === "CFD" ? "No CFD accounts yet" : "No Futures accounts yet"}
          description={`Add a ${market === "CFD" ? "CFD" : "Futures"} prop firm to start tracking accounts here.`}
        />
      ) : (
        <>
          <MarketOverview metrics={metrics} firmCount={visibleFirms.length} passRatePercent={passRate} />

          <PriorityReorderStrip firms={priorityFirms} />

          <PortfolioFilters
            filter={filter}
            onFilterChange={setFilter}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />

          {visibleOverviewAccounts.length > 0 && (
            <PropFirmOverviewChart
              accounts={visibleOverviewAccounts}
              from={dateRange.from}
              to={dateRange.to}
              subtitle={`Weekly funded-account capital and cumulative payouts · ${market === "CFD" ? "CFDs" : "Futures"}`}
            />
          )}

          {filter === "PRIORITY" && visibleFirms.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No priority firms yet — mark a firm as a priority to see it here.
            </p>
          ) : visibleFirms.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No accounts match these filters.
            </p>
          ) : (
            <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleFirms.map(({ firm, accounts }) => (
                <StaggerItem key={firm.id}>
                  <PropFirmCard firm={{ ...firm, accounts }} />
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </>
      )}
    </div>
  );
}
