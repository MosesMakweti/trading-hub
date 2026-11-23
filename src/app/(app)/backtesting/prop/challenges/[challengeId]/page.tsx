import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { prisma } from "@/server/db";
import { getPropOverview } from "@/server/services/simulation/sim-prop.service";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { FadeIn } from "@/components/shared/motion";
import { ButtonLink } from "@/components/backtesting/button-link";
import { DeleteSessionButton } from "@/components/simulation/delete-session-button";
import { SimStatusPill } from "@/components/simulation/account-card";
import { fmtMoney, fmtWallClock, pnlTone } from "@/components/simulation/format";
import { cn } from "@/lib/utils";

const RULE_LABEL: Record<string, string> = { DAILY_LOSS: "Daily loss", MAX_LOSS: "Maximum loss", OVERNIGHT_HOLDING: "Overnight holding", WEEKEND_HOLDING: "Weekend holding" };
const EVENT_LABEL: Record<string, string> = {
  CHALLENGE_PURCHASED: "Challenge purchased", CLOCK_STARTED: "Replay started", PHASE_PASSED: "Phase passed", PHASE_STARTED: "Next phase started",
  FUNDED: "Funded account opened", PHASE_FAILED: "Phase failed", BREACHED: "Breached", PAYOUT: "Payout", ACCOUNT_CREATED: "Account opened",
};

/** A challenge's whole history: every stage, the breach report, payouts and the timeline. */
export default async function ChallengePage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  const user = await requireUser();
  const overview = await getPropOverview(user.id);
  const c = overview.challenges.find((x) => x.id === challengeId);
  if (!c) notFound();
  const accountIds = c.stages.map((s) => s.accountId);
  const [events, payouts] = await Promise.all([
    prisma.simEvent.findMany({ where: { userId: user.id, accountId: { in: accountIds }, type: { in: Object.keys(EVENT_LABEL) } }, orderBy: { createdAt: "asc" } }),
    prisma.simPayout.findMany({ where: { userId: user.id, accountId: { in: accountIds } }, orderBy: { sequence: "asc" } }),
  ]);

  return (
    <FadeIn className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-2">
        <Link href="/backtesting/prop" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="size-3.5" /> Prop Firm Simulator</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.modelName} · {fmtMoney(c.accountSize, c.currency)}</h1>
          {c.stages[0] && <DeleteSessionButton kind="PROP" id={c.stages[0].accountId} name={`${c.modelName} · ${fmtMoney(c.accountSize, c.currency)}`} label="Delete challenge" redirectTo="/backtesting/prop" className="border border-red-500/30 text-red-500" />}
        </div>
        <p className="text-sm text-muted-foreground">{c.firmName} · model version {c.modelVersion} (frozen at purchase) · simulated fee {fmtMoney(c.fee, c.currency)}</p>
      </header>

      <section aria-label="Stages" className="space-y-3">
        <h2 className="text-lg font-semibold">Stages</h2>
        <ol className="space-y-2">
          {c.stages.map((s) => {
            const result = Number(s.balance) - Number(s.startingBalance);
            return (
              <li key={s.accountId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium">{s.name}</span><SimStatusPill status={s.status} /></div>
                  <p className="text-xs text-muted-foreground">{s.statusReason ?? (s.clock ? `At ${fmtWallClock(s.clock)}` : "Not started")}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm tabular-nums">{fmtMoney(s.balance, c.currency)} <span className={cn("text-xs", pnlTone(result))}>({fmtMoney(result, c.currency, { sign: true })})</span></span>
                  <ButtonLink href={`/backtesting/terminal/${s.accountId}`} size="sm" variant={s.status === "ACTIVE" || s.status === "CREATED" ? "default" : "outline"}>
                    {s.status === "ACTIVE" || s.status === "CREATED" ? "Trade" : "Review"}
                  </ButtonLink>
                </div>
              </li>
            );
          })}
          {Array.from({ length: c.totalStages - c.stages.length }, (_, i) => (
            <li key={`locked-${i}`} className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              {c.stages.length + i < c.totalStages - 1 ? `Phase ${c.stages.length + i + 1}` : "Funded"} — opens when the previous stage passes
            </li>
          ))}
        </ol>
      </section>

      {c.breach && (
        <section aria-label="Breach report" className="space-y-3 rounded-xl border border-red-400/40 bg-red-400/5 p-4">
          <h2 className="text-lg font-semibold">Breach report</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Rule</dt><dd>{RULE_LABEL[c.breach.rule] ?? c.breach.rule}</dd></div>
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">When (server time)</dt><dd className="font-mono tabular-nums">{fmtWallClock(c.breach.time)}</dd></div>
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Floating losses involved</dt><dd>{c.breach.floatingInvolved ? "Yes — open positions' worst price that minute" : "No"}</dd></div>
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Measured</dt><dd className="font-mono tabular-nums">{fmtMoney(c.breach.measured, c.currency)}</dd></div>
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Floor</dt><dd className="font-mono tabular-nums">{c.breach.floor ? fmtMoney(c.breach.floor, c.currency) : "—"}</dd></div>
            <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Balance / equity</dt><dd className="font-mono tabular-nums">{fmtMoney(c.breach.balance, c.currency)} / {fmtMoney(c.breach.equity, c.currency)}</dd></div>
          </dl>
          <p className="text-sm">{c.breach.detail}</p>
          {c.breach.contributors.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Trades that contributed</h3>
              <ul className="text-sm">{c.breach.contributors.map((t, i) => <li key={i} className="font-mono text-xs tabular-nums">{t.symbol} {t.side === "BUY" ? "buy" : "sell"} · {fmtMoney(t.pnl, c.currency, { sign: true })} {t.open ? "(open at the breach — closed by the firm)" : "(closed earlier that day)"}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {c.breach.rule === "DAILY_LOSS" || c.breach.rule === "MAX_LOSS"
              ? `To stay inside it, the combined risk of open positions plus the day's realized loss had to remain above ${c.breach.floor ? fmtMoney(c.breach.floor, c.currency) : "the floor"} — smaller size, a stop loss, or fewer simultaneous positions.`
              : "Close positions before the daily reset or the weekend on this model."}
          </p>
        </section>
      )}

      {payouts.length > 0 && (
        <section aria-label="Payouts" className="space-y-2">
          <h2 className="text-lg font-semibold">Payouts</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Gross</th><th className="px-3 py-2 text-left">You</th><th className="px-3 py-2 text-left">Firm</th><th className="px-3 py-2 text-left">Balance after</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-t border-border/60 font-mono text-xs tabular-nums">
                    <td className="px-3 py-2">{p.sequence}</td><td className="px-3 py-2">{fmtWallClock(formatWallClock(p.minute))}</td><td className="px-3 py-2">{fmtMoney(p.grossPayout.toString(), c.currency)}</td>
                    <td className="px-3 py-2 text-emerald-500">{fmtMoney(p.traderShare.toString(), c.currency)}</td><td className="px-3 py-2">{fmtMoney(p.firmShare.toString(), c.currency)}</td><td className="px-3 py-2">{fmtMoney(p.balanceAfter.toString(), c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Timeline" className="space-y-2">
        <h2 className="text-lg font-semibold">Timeline</h2>
        <ol className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{e.minute == null ? "—" : fmtWallClock(formatWallClock(e.minute))}</span><span>{EVENT_LABEL[e.type] ?? e.type}</span></li>
          ))}
        </ol>
      </section>
    </FadeIn>
  );
}
