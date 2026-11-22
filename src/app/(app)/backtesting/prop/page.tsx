import Link from "next/link";
import { Plus } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getPropOverview } from "@/server/services/simulation/sim-prop.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { ButtonLink } from "@/components/backtesting/button-link";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { ChallengeCard } from "@/components/simulation/prop/challenge-card";
import { fmtMoney, pnlTone } from "@/components/simulation/format";
import { cn } from "@/lib/utils";

const RULE_LABEL: Record<string, string> = { DAILY_LOSS: "Daily loss", MAX_LOSS: "Maximum loss", OVERNIGHT_HOLDING: "Overnight holding", WEEKEND_HOLDING: "Weekend holding" };
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const days = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} d`);

/** Prop Firm Simulator dashboard: every simulated challenge and how they went. */
export default async function PropFirmPage() {
  const user = await requireUser();
  const o = await getPropOverview(user.id);
  const t = o.totals;
  const kpis = [
    { label: "Challenges", value: String(t.purchased) },
    { label: "Funded", value: String(t.funded) },
    { label: "Pass rate", value: pct(t.passRate), hint: "Decided challenges that reached funded" },
    { label: "Phases passed", value: pct(t.phaseCompletionRate) },
    { label: "Fees paid", value: fmtMoney(t.fees) },
    { label: "Your payouts", value: fmtMoney(t.payoutsTrader), tone: pnlTone(t.payoutsTrader) },
    { label: "Firm share", value: fmtMoney(t.payoutsFirm) },
    { label: "Net (payouts − fees)", value: fmtMoney(t.netSimulated, "USD", { sign: true }), tone: pnlTone(t.netSimulated) },
    { label: "Avg time to fund", value: days(t.avgDaysToFund), hint: "Replay calendar days" },
    { label: "Avg funded lifespan", value: days(t.avgFundedLifespanDays), hint: "Replay calendar days" },
  ];
  const active = o.challenges.filter((c) => c.status === "IN_EVALUATION" || c.status === "FUNDED");
  const ended = o.challenges.filter((c) => !(c.status === "IN_EVALUATION" || c.status === "FUNDED"));

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <SimulationBadge />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prop Firm Simulator</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Buy a simulated challenge, pass its phases under the firm&apos;s rules, trade the funded account and take payouts — on historical data, with simulated money only.</p>
        </div>
        <ButtonLink href="/backtesting/prop/new" className="gap-1.5"><Plus className="size-4" /> New challenge</ButtonLink>
      </div>
      <SimulationNav />

      {o.challenges.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <h2 className="font-semibold">No challenges yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Pick a firm model, an account size and a historical period. The simulated fee is recorded; nothing is charged.</p>
          <ButtonLink href="/backtesting/prop/new" className="mt-4">Choose a challenge</ButtonLink>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.label} title={k.hint}>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</dt>
                <dd className={cn("font-mono text-sm tabular-nums", k.tone)}>{k.value}</dd>
              </div>
            ))}
          </dl>
          {active.length > 0 && (
            <section aria-label="Active challenges" className="space-y-3">
              <h2 className="text-lg font-semibold">Active</h2>
              <div className="grid gap-3 md:grid-cols-2">{active.map((c) => <ChallengeCard key={c.id} challenge={c} />)}</div>
            </section>
          )}
          {ended.length > 0 && (
            <section aria-label="Past challenges" className="space-y-3">
              <h2 className="text-lg font-semibold">History</h2>
              <div className="grid gap-3 md:grid-cols-2">{ended.map((c) => <ChallengeCard key={c.id} challenge={c} />)}</div>
            </section>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <section aria-label="Breaches by rule" className="space-y-2">
              <h2 className="text-sm font-medium">Most breached rules</h2>
              {o.breachesByRule.length === 0 ? <p className="text-xs text-muted-foreground">No breaches.</p> : (
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {o.breachesByRule.map((b) => <li key={b.rule} className="flex justify-between px-3 py-2"><span>{RULE_LABEL[b.rule] ?? b.rule}</span><span className="font-mono tabular-nums">{b.count}</span></li>)}
                </ul>
              )}
            </section>
            <section aria-label="By firm model" className="space-y-2">
              <h2 className="text-sm font-medium">By firm model</h2>
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {o.byModel.map((m) => <li key={m.model} className="flex justify-between gap-3 px-3 py-2"><span className="truncate">{m.model}</span><span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{m.purchased} bought · {m.funded} funded · {pct(m.passRate)}</span></li>)}
              </ul>
            </section>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">Firm models are simulations of the rules you configure. <Link href="/backtesting/prop/models/new" className="underline-offset-4 hover:underline">Build a custom model</Link>.</p>
    </FadeIn>
  );
}
