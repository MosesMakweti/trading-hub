import { requireUser } from "@/server/guards";
import { listBacktestRunOverviews } from "@/server/services/backtest-run.service";
import { listStrategies } from "@/server/services/strategies.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { BacktestingOverview } from "@/components/backtesting/backtesting-overview";
import { CreateBacktestRunDialog } from "@/components/backtesting/create-backtest-run-dialog";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import type { BacktestStrategyOptionDTO } from "@/types/backtesting";

export default async function LegacyBacktestingPage() {
  const user = await requireUser();
  const [runs, strategyRows] = await Promise.all([listBacktestRunOverviews(user.id), listStrategies(user.id)]);

  // Strategy Lab is the only source of strategies; archived ones aren't offered for new runs.
  const strategies: BacktestStrategyOptionDTO[] = strategyRows
    .filter((s) => s.status !== "ARCHIVED")
    .map((s) => ({ id: s.id, name: s.name, version: s.version, applicableAssets: s.applicableAssets }));

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <SimulationBadge />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Legacy backtest runs</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Runs journaled with the Today workflow, before Strategy Lab. They stay fully readable here. New backtests use Strategy Lab, with simulated accounts, orders and money.</p>
        </div>
        {runs.length > 0 && <CreateBacktestRunDialog strategies={strategies} />}
      </div>
      <SimulationNav />
      <BacktestingOverview runs={runs} strategies={strategies} />
    </FadeIn>
  );
}
