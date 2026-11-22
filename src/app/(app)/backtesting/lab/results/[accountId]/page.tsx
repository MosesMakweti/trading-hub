import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { SimNotFoundError } from "@/server/services/simulation/sim-account.service";
import { getBacktestResults } from "@/server/services/simulation/sim-study.service";
import { FadeIn } from "@/components/shared/motion";
import { ButtonLink } from "@/components/backtesting/button-link";
import { StatsKpis, StatsTable } from "@/components/simulation/stats-table";
import { EquityCurve } from "@/components/simulation/equity-curve";
import { fmtMoney, pnlTone } from "@/components/simulation/format";
import { cn } from "@/lib/utils";

/** A Strategy Lab backtest's results: every closed trade, net of costs. */
export default async function BacktestResultsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const user = await requireUser();
  let r;
  try {
    r = await getBacktestResults(user.id, accountId);
  } catch (e) {
    if (e instanceof SimNotFoundError) notFound();
    throw e;
  }
  return (
    <FadeIn className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-3">
        <Link href="/backtesting/lab" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="size-3.5" /> Strategy Lab</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{r.name}</h1>
            <p className="text-sm text-muted-foreground">Results of every closed trade, after commissions and swaps.</p>
          </div>
          <ButtonLink href={`/backtesting/terminal/${r.accountId}`} variant="outline">Open terminal</ButtonLink>
        </div>
      </header>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Balance after each trade</h2>
          <EquityCurve points={r.equityCurve} currency={r.currency} />
        </div>
        <dl className="grid grid-cols-2 content-start gap-4 rounded-xl border border-border bg-card p-4">
          <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Starting balance</dt><dd className="font-mono tabular-nums">{fmtMoney(r.startingBalance, r.currency)}</dd></div>
          <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Net result</dt><dd className={cn("font-mono tabular-nums", pnlTone(r.money.netPnl))}>{fmtMoney(r.money.netPnl, r.currency, { sign: true })}</dd></div>
          <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Commissions</dt><dd className="font-mono tabular-nums">{fmtMoney(r.money.commissions, r.currency)}</dd></div>
          <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Swaps</dt><dd className="font-mono tabular-nums">{fmtMoney(r.money.swaps, r.currency)}</dd></div>
          {r.money.tradesWithoutRisk > 0 && <p className="col-span-2 text-xs text-muted-foreground">{r.money.tradesWithoutRisk} trade{r.money.tradesWithoutRisk === 1 ? " was" : "s were"} opened without a stop loss, so {r.money.tradesWithoutRisk === 1 ? "it has" : "they have"} no R. Money totals include {r.money.tradesWithoutRisk === 1 ? "it" : "them"}.</p>}
        </dl>
      </section>
      <StatsKpis stats={r.overall} />
      <div className="grid gap-6 lg:grid-cols-2">
        <StatsTable title="By instrument" groups={r.bySymbol} />
        <StatsTable title="By direction" groups={r.bySide} />
        <StatsTable title="By entry hour (server time)" groups={r.byHour} />
        <StatsTable title="By weekday" groups={r.byWeekday} />
      </div>
    </FadeIn>
  );
}
