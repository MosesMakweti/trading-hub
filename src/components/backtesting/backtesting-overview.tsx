"use client";

import { useMemo, useState } from "react";
import { ArrowRight, History } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerItem, StaggerList } from "@/components/shared/motion";
import { AssetChips, RunCard, sessionHref } from "@/components/backtesting/run-card";
import { CreateBacktestRunDialog } from "@/components/backtesting/create-backtest-run-dialog";
import { RunProgressBar } from "@/components/backtesting/run-progress";
import { StrategyDriftNote } from "@/components/backtesting/strategy-drift-note";
import { RUN_STATUS_META } from "@/components/backtesting/run-status-badge";
import { formatRunPeriod, formatSimDate, formatSimulationBalance } from "@/components/backtesting/format";
import type { BacktestRunOverviewDTO, BacktestRunStatusValue, BacktestStrategyOptionDTO } from "@/types/backtesting";
import { ButtonLink } from "@/components/backtesting/button-link";
import { fmtR } from "@/lib/analytics-format";

const FILTERS: BacktestRunStatusValue[] = ["ACTIVE", "COMPLETED", "ARCHIVED"];

function ContinueCard({ run }: { run: BacktestRunOverviewDTO }) {
  const started = run.currentPositionDateKey != null;
  return (
    <section aria-labelledby="continue-heading" className="glass-strong rounded-2xl p-5">
      <h2 id="continue-heading" className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {started ? "Continue backtesting" : "Start backtesting"}
      </h2>
      <div className="mt-3 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0 space-y-3">
          <div>
            <p className="truncate text-lg font-semibold">{run.name}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatRunPeriod(run.startDateKey, run.endDateKey)}
              {run.strategy && <> · {run.strategy.name}</>}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Last session</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">
                {started ? formatSimDate(run.currentPositionDateKey!) : "Not started"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {run.resumeDateKey === run.currentPositionDateKey ? "Resumes on" : "Next session"}
              </dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">
                {run.resumeDateKey === run.currentPositionDateKey ? "Same day" : formatSimDate(run.resumeDateKey)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Trades</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">{run.stats.executedTrades}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Net R</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">
                {run.stats.netR == null ? "—" : fmtR(run.stats.netR)}
                {run.stats.winRate != null && <span className="text-muted-foreground"> · {Math.round(run.stats.winRate)}% win</span>}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <AssetChips assets={run.assets} max={6} />
            {run.simulation.startingBalance != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Simulation balance {formatSimulationBalance(run.simulation.startingBalance, run.simulation.currency)}
              </span>
            )}
          </div>
          <StrategyDriftNote drift={run.strategyDrift} />
          <RunProgressBar progress={run.progress} className="max-w-md" />
        </div>
        <ButtonLink href={sessionHref(run)} size="lg" className="gap-1.5">
          {started ? "Continue" : "Start"}
          <ArrowRight className="size-4" />
        </ButtonLink>
      </div>
    </section>
  );
}

export function BacktestingOverview({
  runs,
  strategies,
}: {
  runs: BacktestRunOverviewDTO[];
  strategies: BacktestStrategyOptionDTO[];
}) {
  const [filter, setFilter] = useState<BacktestRunStatusValue>("ACTIVE");
  const counts = useMemo(() => {
    const c: Record<BacktestRunStatusValue, number> = { ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
    for (const r of runs) c[r.status] += 1;
    return c;
  }, [runs]);
  // Runs arrive most-recently-worked-on first.
  const continueRun = runs.find((r) => r.status === "ACTIVE") ?? null;
  const visible = runs.filter((r) => r.status === filter);

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Backtest your strategy"
        description="Create a historical testing run and journal each session with the same process you use in Today. Replay the date in FX Replay, TradingView Replay or any historical chart alongside Traditorium."
        action={<CreateBacktestRunDialog strategies={strategies} trigger="Create Backtest Run" />}
      />
    );
  }

  return (
    <div className="space-y-8">
      {continueRun && <ContinueCard run={continueRun} />}

      <section aria-labelledby="runs-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="runs-heading" className="text-lg font-semibold">Backtest runs</h2>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter runs">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "ACTIVE" ? "Active" : RUN_STATUS_META[f].label}
                <span className="ml-1 text-[10px] opacity-70 tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="glass rounded-2xl px-6 py-10 text-center text-sm text-muted-foreground">
            {filter === "ACTIVE" ? "No runs in progress." : filter === "COMPLETED" ? "No completed runs yet." : "No archived runs."}
          </div>
        ) : (
          <StaggerList key={filter} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((run) => (
              <StaggerItem key={run.id} className="h-full">
                <RunCard run={run} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </div>
  );
}
