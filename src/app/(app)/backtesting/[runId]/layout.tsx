import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { loadOwnedRun } from "./load-run";
import { BacktestingNav } from "@/components/backtesting/backtesting-nav";
import { RunActionsMenu } from "@/components/backtesting/run-actions-menu";
import { RunStatusBadge } from "@/components/backtesting/run-status-badge";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { StrategyDriftNote } from "@/components/backtesting/strategy-drift-note";
import { formatRunPeriod, formatSimulationBalance, formatWeekdays } from "@/components/backtesting/format";

export default async function BacktestRunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { run } = await loadOwnedRun(runId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <Link href="/backtesting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" />
          All backtest runs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SimulationBadge />
              <RunStatusBadge status={run.status} />
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{run.name}</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatRunPeriod(run.startDateKey, run.endDateKey)} · {formatWeekdays(run.tradingWeekdays)}
              {run.strategy && <> · {run.strategy.name}</>}
              {run.assets.length > 0 && <> · {run.assets.join(", ")}</>}
              {run.simulation.startingBalance != null && (
                <> · Simulation balance {formatSimulationBalance(run.simulation.startingBalance, run.simulation.currency)}</>
              )}
            </p>
            <StrategyDriftNote drift={run.strategyDrift} />
          </div>
          <RunActionsMenu run={run} afterDeleteHref="/backtesting" />
        </div>
      </header>
      <BacktestingNav runId={run.id} />
      {children}
    </div>
  );
}
