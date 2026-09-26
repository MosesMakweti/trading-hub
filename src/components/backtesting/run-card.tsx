import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtR } from "@/lib/analytics-format";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { RunActionsMenu } from "@/components/backtesting/run-actions-menu";
import { RunProgressBar } from "@/components/backtesting/run-progress";
import { RunStatusBadge } from "@/components/backtesting/run-status-badge";
import { StrategyDriftNote } from "@/components/backtesting/strategy-drift-note";
import { formatRunPeriod, formatSimDate } from "@/components/backtesting/format";
import type { BacktestRunOverviewDTO } from "@/types/backtesting";
import { ButtonLink } from "@/components/backtesting/button-link";

export function sessionHref(run: Pick<BacktestRunOverviewDTO, "id" | "resumeDateKey">): string {
  return `/backtesting/${run.id}/session?date=${run.resumeDateKey}`;
}

export function AssetChips({ assets, max = 4 }: { assets: string[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {assets.slice(0, max).map((asset) => (
        <span
          key={asset}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
            TAG_STYLES[colorForName(asset)].chip,
          )}
        >
          <span className={cn("size-1.5 rounded-full", TAG_STYLES[colorForName(asset)].dot)} />
          {asset}
        </span>
      ))}
      {assets.length > max && <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{assets.length - max}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function RunCard({ run }: { run: BacktestRunOverviewDTO }) {
  const archived = run.status === "ARCHIVED";
  return (
    <article
      className={cn(
        "glass flex h-full flex-col gap-4 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated",
        archived && "opacity-75",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link href={sessionHref(run)} className="block truncate font-semibold hover:underline">
            {run.name}
          </Link>
          <p className="text-xs text-muted-foreground tabular-nums">{formatRunPeriod(run.startDateKey, run.endDateKey)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RunStatusBadge status={run.status} />
          <RunActionsMenu run={run} />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Strategy" value={run.strategy?.name ?? "No strategy"} />
        <Stat label="Last session" value={run.currentPositionDateKey ? formatSimDate(run.currentPositionDateKey) : "Not started"} />
        <Stat label="Trades" value={String(run.stats.executedTrades)} />
        <Stat
          label="Net R"
          value={run.stats.netR == null ? "—" : `${fmtR(run.stats.netR)}${run.stats.winRate == null ? "" : ` · ${Math.round(run.stats.winRate)}% win`}`}
        />
      </dl>

      <AssetChips assets={run.assets} />
      <StrategyDriftNote drift={run.strategyDrift} />

      <div className="mt-auto space-y-3 border-t border-border pt-3">
        <RunProgressBar progress={run.progress} />
        <div className="flex justify-end">
          <ButtonLink href={sessionHref(run)} size="sm" variant="outline" className="gap-1.5">
            {run.status === "ACTIVE" ? (run.currentPositionDateKey ? "Continue" : "Start") : "Open"}
            <ArrowRight className="size-3.5" />
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
