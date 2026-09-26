import { loadOwnedRun } from "../load-run";
import { getBacktestAnalytics } from "@/server/services/backtest-analytics.service";
import { FadeIn } from "@/components/shared/motion";
import { BacktestAnalyticsView } from "@/components/backtesting/analytics/backtest-analytics-view";
import { fmtR } from "@/lib/analytics-format";

/** Backtesting Analytics — one run, the canonical analytics engine, R-first. */
export default async function BacktestAnalyticsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { user, run } = await loadOwnedRun(runId);
  const summary = await getBacktestAnalytics(user.id, run.id);
  const o = summary.overview;

  return (
    <FadeIn className="space-y-6">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Days completed</dt>
          <dd className="font-semibold tabular-nums">
            {run.progress.completedTradingDays} / {run.progress.totalTradingDays}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Trades</dt>
          <dd className="font-semibold tabular-nums">{o.totalTrades}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Net</dt>
          <dd className="font-semibold tabular-nums">{o.finalizedTrades ? fmtR(o.netR) : "—"}</dd>
        </div>
      </dl>
      <BacktestAnalyticsView summary={summary} />
    </FadeIn>
  );
}
