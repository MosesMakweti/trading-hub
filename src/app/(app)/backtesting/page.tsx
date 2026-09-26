import { requireUser } from "@/server/guards";
import { listBacktestRunOverviews } from "@/server/services/backtest-run.service";
import { listStrategies } from "@/server/services/strategies.service";
import { FadeIn } from "@/components/shared/motion";
import { BacktestingNav } from "@/components/backtesting/backtesting-nav";
import { BacktestingOverview } from "@/components/backtesting/backtesting-overview";
import { CreateBacktestRunDialog } from "@/components/backtesting/create-backtest-run-dialog";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import type { BacktestStrategyOptionDTO } from "@/types/backtesting";

export default async function BacktestingPage() {
  const user = await requireUser();
  const [runs, strategyRows] = await Promise.all([listBacktestRunOverviews(user.id), listStrategies(user.id)]);

  // Strategy Lab is the only source of strategies; archived ones aren't offered for new runs.
  const strategies: BacktestStrategyOptionDTO[] = strategyRows
    .filter((s) => s.status !== "ARCHIVED")
    .map((s) => ({ id: s.id, name: s.name, version: s.version, applicableAssets: s.applicableAssets }));
  const currentRunId = runs.find((r) => r.status === "ACTIVE")?.id ?? null;

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <SimulationBadge />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Backtesting</h1>
          <p className="text-sm text-muted-foreground">Test and validate your strategies against historical markets.</p>
        </div>
        {runs.length > 0 && <CreateBacktestRunDialog strategies={strategies} />}
      </div>
      <BacktestingNav runId={currentRunId} />
      <BacktestingOverview runs={runs} strategies={strategies} />
    </FadeIn>
  );
}
