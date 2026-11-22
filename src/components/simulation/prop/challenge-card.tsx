import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ChallengeSummaryDTO } from "@/server/services/simulation/sim-prop.service";
import { SimStatusPill } from "../account-card";
import { fmtMoney, pnlTone } from "../format";

const CHALLENGE_TONE: Record<ChallengeSummaryDTO["status"], string> = {
  IN_EVALUATION: "border-border text-muted-foreground",
  FUNDED: "border-emerald-500/40 text-emerald-500",
  FAILED: "border-red-400/50 text-red-400",
  BREACHED: "border-red-400/50 text-red-400",
  ARCHIVED: "border-border text-muted-foreground",
};

/** One challenge: its stages as a progression, and where its money stands. */
export function ChallengeCard({ challenge: c }: { challenge: ChallengeSummaryDTO }) {
  const current = c.stages[c.stages.length - 1];
  const result = current ? Number(current.balance) - Number(current.startingBalance) : 0;
  return (
    <Link href={`/backtesting/prop/challenges/${c.id}`} className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{c.modelName} · {fmtMoney(c.accountSize, c.currency)}</h3>
          <p className="truncate text-xs text-muted-foreground">{c.firmName} · v{c.modelVersion} · fee {fmtMoney(c.fee, c.currency)}</p>
        </div>
        <span className={cn("rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider", CHALLENGE_TONE[c.status])}>{c.status.replace("_", " ").toLowerCase()}</span>
      </div>
      <ol className="mt-4 flex gap-1.5" aria-label="Stages">
        {Array.from({ length: c.totalStages }, (_, i) => {
          const s = c.stages[i];
          const tone = !s ? "bg-muted" : s.status === "PASSED" ? "bg-emerald-500" : s.status === "BREACHED" || s.status === "FAILED" ? "bg-red-400" : "bg-primary/70";
          return <li key={i} className={cn("h-1.5 flex-1 rounded-full", tone)} title={s ? `${s.name}: ${s.status.toLowerCase()}` : "Not reached"} />;
        })}
      </ol>
      {current && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <span className="font-medium">{current.name}</span> <SimStatusPill status={current.status} />
          </span>
          <span className={cn("font-mono tabular-nums", pnlTone(result))}>{fmtMoney(result, c.currency, { sign: true })}</span>
        </div>
      )}
      {c.breach && <p className="mt-2 text-xs text-red-400">{c.breach.detail}</p>}
      {c.payouts.count > 0 && <p className="mt-2 text-xs text-muted-foreground">{c.payouts.count} payout{c.payouts.count === 1 ? "" : "s"} · {fmtMoney(c.payouts.trader, c.currency)} to you</p>}
    </Link>
  );
}
