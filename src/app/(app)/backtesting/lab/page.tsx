import Link from "next/link";

import { requireUser } from "@/server/guards";
import { listHistoricalDatasets } from "@/server/services/native-replay/historical-dataset.service";
import { listStrategies } from "@/server/services/strategies.service";
import { listExperiments } from "@/server/services/strategy-experiments.service";
import { listSimAccountSummaries } from "@/server/services/simulation/sim-state.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { SimAccountCard } from "@/components/simulation/account-card";
import { CreateLabAccountDialog } from "@/components/simulation/create-lab-account-dialog";
import { ButtonLink } from "@/components/backtesting/button-link";

/** Strategy Lab — the trader's backtest accounts. */
export default async function StrategyLabPage() {
  const user = await requireUser();
  const [accounts, datasets, strategies, experiments] = await Promise.all([
    listSimAccountSummaries(user.id, { product: "STRATEGY_LAB" }),
    listHistoricalDatasets(user.id),
    listStrategies(user.id),
    listExperiments(user.id),
  ]);
  const experimentOptions = experiments.filter((e) => e.status === "ACTIVE").map((e) => ({ id: e.id, name: e.name, label: e.label }));
  const datasetOptions = datasets.filter((d) => d.status === "READY").map((d) => ({ id: d.id, symbol: d.symbol, firstBar: d.firstBar, lastBar: d.lastBar }));
  const strategyOptions = strategies.filter((s) => s.status !== "ARCHIVED").map((s) => ({ id: s.id, name: s.name, version: s.version }));
  const groups = [
    { title: "Active", items: accounts.filter((a) => !a.archived && (a.status === "ACTIVE" || a.status === "CREATED")) },
    { title: "Completed", items: accounts.filter((a) => !a.archived && a.status === "COMPLETED") },
    { title: "Archived", items: accounts.filter((a) => a.archived) },
  ].filter((g) => g.items.length > 0);

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <SimulationBadge />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Strategy Lab</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Backtest a strategy bar by bar with a simulated account: real order types, stops and targets, commissions and swaps, all on historical MT5 data.</p>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/backtesting/sessions" variant="outline" size="sm">Manage sessions</ButtonLink>
          <CreateLabAccountDialog datasets={datasetOptions} strategies={strategyOptions} experiments={experimentOptions} />
        </div>
      </div>
      <SimulationNav />
      {experiments.length > 0 && (
        <section aria-label="Strategy experiments" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Strategy experiments <span className="tabular-nums">{experiments.length}</span></h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {experiments.map((e) => (
              <li key={e.id}>
                <Link href={`/backtesting/lab/experiments/${e.id}`} className="block rounded-xl border border-border p-3 transition-colors hover:bg-muted/50">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{e.label}</span>
                    <span className="ml-auto rounded border border-border px-1.5 py-px">{e.status.replaceAll("_", " ").toLowerCase()}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.baseline ? `Baseline: ${e.baseline.name}` : "New strategy"} · {e.sessionCount} session{e.sessionCount === 1 ? "" : "s"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <h2 className="font-semibold">No backtests yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Pick instruments with historical data and a period, set a starting balance, and trade it forward one bar at a time.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateLabAccountDialog datasets={datasetOptions} strategies={strategyOptions} experiments={experimentOptions} trigger="Create your first backtest" />
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.title} aria-label={g.title} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">{g.title} <span className="tabular-nums">{g.items.length}</span></h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((a) => <SimAccountCard key={a.id} account={a} />)}
            </div>
          </section>
        ))
      )}
    </FadeIn>
  );
}
