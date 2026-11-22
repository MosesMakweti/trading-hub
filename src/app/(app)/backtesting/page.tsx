import Link from "next/link";
import { ArrowRight, FlaskConical, History, Landmark } from "lucide-react";

import { requireUser } from "@/server/guards";
import { prisma } from "@/server/db";
import { listSimAccountSummaries } from "@/server/services/simulation/sim-state.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { SimAccountCard } from "@/components/simulation/account-card";

/**
 * Backtesting home — the entry to the simulation environment, independent of
 * the live Today/Journal areas. Shows the products and the accounts the
 * trader is working in right now.
 */
export default async function BacktestingHomePage() {
  const user = await requireUser();
  const [accounts, legacyRuns, datasets] = await Promise.all([
    listSimAccountSummaries(user.id),
    prisma.backtestRun.count({ where: { userId: user.id } }),
    prisma.historicalDataset.count({ where: { userId: user.id, status: "READY" } }),
  ]);
  const inProgress = accounts.filter((a) => a.status === "ACTIVE" || a.status === "CREATED").slice(0, 6);
  const lab = accounts.filter((a) => a.product === "STRATEGY_LAB");
  const prop = accounts.filter((a) => a.product === "PROP_FIRM");

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-2">
        <SimulationBadge />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Backtesting</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Trade historical markets minute by minute with simulated accounts. Nothing here reaches your live accounts or journal.
        </p>
      </div>
      <SimulationNav />

      <section aria-label="Products" className="grid gap-4 md:grid-cols-2">
        <Link href="/backtesting/lab" className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-foreground/20">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" aria-hidden />
            <h2 className="font-semibold">Strategy Lab</h2>
            <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Backtest a strategy on historical data with orders, stops and a simulated balance, then review the results in R and money.</p>
          <p className="mt-4 font-mono text-xs text-muted-foreground tabular-nums">
            {lab.length} backtest{lab.length === 1 ? "" : "s"} · {lab.filter((a) => a.status === "ACTIVE").length} active
          </p>
        </Link>
        <Link href="/backtesting/prop" className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-foreground/20">
          <div className="flex items-center gap-2">
            <Landmark className="size-4 text-primary" aria-hidden />
            <h2 className="font-semibold">Prop Firm Simulator</h2>
            <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Buy a simulated challenge, pass its phases under the firm&apos;s rules, trade the funded account, take payouts, or breach.</p>
          <p className="mt-4 font-mono text-xs text-muted-foreground tabular-nums">
            {prop.length} account{prop.length === 1 ? "" : "s"} · {prop.filter((a) => a.kind === "FUNDED" && a.status === "ACTIVE").length} funded
          </p>
        </Link>
        <div className="rounded-xl border border-dashed border-border p-5 md:col-span-2">
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="font-semibold">Historical data</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {datasets === 0
              ? "Import an MT5 M1 export for each instrument you want to replay."
              : `${datasets} instrument dataset${datasets === 1 ? "" : "s"} ready to replay.`}
          </p>
          <Link href="/backtesting/data" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
            {datasets === 0 ? "Import data" : "Manage data"}
          </Link>
        </div>
      </section>

      <section aria-labelledby="in-progress" className="space-y-3">
        <h2 id="in-progress" className="text-lg font-semibold">In progress</h2>
        {inProgress.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            No simulation accounts yet. Start a backtest in <Link href="/backtesting/lab" className="font-medium text-foreground underline-offset-4 hover:underline">Strategy Lab</Link> or a challenge in the <Link href="/backtesting/prop" className="font-medium text-foreground underline-offset-4 hover:underline">Prop Firm Simulator</Link>.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inProgress.map((a) => <SimAccountCard key={a.id} account={a} />)}
          </div>
        )}
      </section>

      {legacyRuns > 0 && (
        <p className="text-sm text-muted-foreground">
          You have {legacyRuns} backtest run{legacyRuns === 1 ? "" : "s"} from the earlier Today-based workflow.{" "}
          <Link href="/backtesting/legacy" className="font-medium text-foreground underline-offset-4 hover:underline">Open legacy runs</Link>
        </p>
      )}
    </FadeIn>
  );
}
