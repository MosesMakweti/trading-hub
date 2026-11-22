"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPropAccountStatusAction, requestPayoutAction } from "@/actions/simulation-prop.actions";
import type { PropAccountStatusDTO } from "@/server/services/simulation/sim-prop.service";
import type { SimAccountStateDTO } from "@/types/simulation";
import { fmtMoney } from "../format";

function Meter({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const bar = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-400", neutral: "bg-primary/70" }[tone];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{detail}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

/**
 * The account's rules, live: progress to the target, distance to each loss
 * floor (from current equity), trading days, unmet pass conditions, and — on
 * a funded account — payout eligibility. Refreshed after every server reply.
 */
export function PropRulesPanel({ state, onPaidOut }: { state: SimAccountStateDTO; onPaidOut: () => void }) {
  const [status, setStatus] = useState<PropAccountStatusDTO | null>(null);
  const [paying, setPaying] = useState(false);
  const version = `${state.clock?.version ?? 0}:${state.money.balance}:${state.status}`;

  useEffect(() => {
    let live = true;
    void getPropAccountStatusAction({ accountId: state.id }).then((res) => {
      if (live && res.success) setStatus(res.status);
    });
    return () => {
      live = false;
    };
  }, [state.id, version]);

  if (!status) return <p className="border-t border-border pt-3 text-xs text-muted-foreground">Loading rules…</p>;

  const equity = Number(state.money.equity);
  const start = Number(status.startingBalance);
  const target = status.profitTarget == null ? null : Number(status.profitTarget);
  const room = (floor: string | null) => (floor == null ? null : equity - Number(floor));
  const dailyRoom = room(status.dailyLossFloor);
  const maxRoom = room(status.maxLossFloor);
  const toneFor = (r: number | null, width: number) => (r == null ? "neutral" : r <= 0 ? "bad" : r < width * 0.3 ? "warn" : "good");
  const dailyWidth = status.dailyLossFloor ? Math.max(1, start - Number(status.dailyLossFloor) + (Number(status.balance) - start)) : 1;
  const maxWidth = status.maxLossFloor ? Math.max(1, equity - Number(status.maxLossFloor) + 1) : 1;

  const pay = async () => {
    setPaying(true);
    const res = await requestPayoutAction({ accountId: state.id });
    setPaying(false);
    if (!res.success) return void toast.error(res.error);
    toast.success(`Payout of ${fmtMoney(res.traderShare, state.currency)} to you`);
    onPaidOut();
  };

  return (
    <section aria-label="Account rules" className="space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium">{status.stage} rules</h2>
        <Link href={`/backtesting/prop/challenges/${status.challengeId}`} className="text-[11px] text-primary underline-offset-4 hover:underline">Challenge history</Link>
      </div>
      {target != null && (
        <Meter
          label="Profit target"
          value={((Number(status.balance) - start) / (target - start)) * 100}
          detail={`${fmtMoney(Number(status.balance) - start, state.currency, { sign: true })} / ${fmtMoney(target - start, state.currency)}`}
          tone={Number(status.balance) >= target ? "good" : "neutral"}
        />
      )}
      {status.dailyLossFloor && (
        <Meter label={`Daily loss (${status.dailyLossBasis})`} value={dailyRoom == null ? 0 : (dailyRoom / dailyWidth) * 100} detail={`${fmtMoney(dailyRoom, state.currency)} left · floor ${fmtMoney(status.dailyLossFloor, state.currency)}`} tone={toneFor(dailyRoom, dailyWidth)} />
      )}
      {status.maxLossFloor && (
        <Meter label={`Max loss (${status.maxLossModel})`} value={maxRoom == null ? 0 : Math.min(100, (maxRoom / (start * 0.1)) * 100)} detail={`${fmtMoney(maxRoom, state.currency)} left · floor ${fmtMoney(status.maxLossFloor, state.currency)}`} tone={toneFor(maxRoom, maxWidth)} />
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Trading days</dt>
          <dd className="font-mono tabular-nums">{status.tradingDays}{status.minTradingDays ? ` / ${status.minTradingDays}` : ""}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Calendar days</dt>
          <dd className="font-mono tabular-nums">{status.calendarDaysUsed}{status.maxCalendarDays ? ` / ${status.maxCalendarDays}` : ""}</dd>
        </div>
      </dl>
      {status.passUnmet.length > 0 && state.status === "ACTIVE" && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {status.passUnmet.map((u) => <li key={u}>· {u}</li>)}
        </ul>
      )}
      {status.notEnforced.length > 0 && <p className="text-[11px] text-muted-foreground">Not enforced: {status.notEnforced.join(", ")}.</p>}
      {state.status === "BREACHED" && (
        <p className="flex items-start gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 p-2 text-xs text-red-400">
          <ShieldAlert className="mt-px size-3.5 shrink-0" /> {state.statusReason ?? "A rule was breached."} The full report is in the challenge history.
        </p>
      )}
      {status.payout && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">Payout</span>
            <span className="text-muted-foreground">{status.payout.splitPercent}% to you</span>
          </div>
          {status.payout.eligible ? (
            <p className="text-xs">
              {fmtMoney(status.payout.grossPayout, state.currency)} eligible · you {fmtMoney(status.payout.traderShare, state.currency)}, firm {fmtMoney(status.payout.firmShare, state.currency)}
            </p>
          ) : (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">{status.payout.reasons.map((r) => <li key={r}>· {r}</li>)}</ul>
          )}
          <Button size="sm" className="w-full" variant="secondary" disabled={!status.payout.eligible || paying} onClick={() => void pay()}>
            {paying && <Loader2 className="animate-spin" />} Request payout
          </Button>
        </div>
      )}
    </section>
  );
}
