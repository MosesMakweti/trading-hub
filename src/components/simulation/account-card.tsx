import Link from "next/link";

import { cn } from "@/lib/utils";
import type { SimAccountSummaryDTO } from "@/types/simulation";
import { fmtMoney, fmtWallClock, pnlTone } from "./format";

const STATUS_LABEL: Record<SimAccountSummaryDTO["status"], { label: string; tone: string }> = {
  CREATED: { label: "Not started", tone: "border-border text-muted-foreground" },
  ACTIVE: { label: "Active", tone: "border-emerald-500/40 text-emerald-500" },
  PASSED: { label: "Passed", tone: "border-sky-400/50 text-sky-400" },
  FAILED: { label: "Failed", tone: "border-red-400/50 text-red-400" },
  BREACHED: { label: "Breached", tone: "border-red-400/50 text-red-400" },
  COMPLETED: { label: "Completed", tone: "border-sky-400/50 text-sky-400" },
  SUSPENDED: { label: "Suspended", tone: "border-amber-400/50 text-amber-500" },
  ARCHIVED: { label: "Archived", tone: "border-border text-muted-foreground" },
};

export function SimStatusPill({ status }: { status: SimAccountSummaryDTO["status"] }) {
  const s = STATUS_LABEL[status];
  return <span className={cn("rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider", s.tone)}>{s.label}</span>;
}

/** One simulation account in a list: where its clock is, and where its money is. */
export function SimAccountCard({ account }: { account: SimAccountSummaryDTO }) {
  return (
    <Link
      href={`/backtesting/terminal/${account.id}`}
      className="group block rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{account.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {account.assets.join(", ")} · {fmtWallClock(account.period.start)} → {fmtWallClock(account.period.end)}
          </p>
        </div>
        <SimStatusPill status={account.status} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Balance</dt>
          <dd className="font-mono text-sm tabular-nums">{fmtMoney(account.balance, account.currency)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Result</dt>
          <dd className={cn("font-mono text-sm tabular-nums", pnlTone(account.netResult))}>{fmtMoney(account.netResult, account.currency, { sign: true })}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Trades</dt>
          <dd className="font-mono text-sm tabular-nums">
            {account.closedTrades}
            {account.openPositions > 0 && <span className="text-muted-foreground"> +{account.openPositions} open</span>}
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-1">
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Replay progress through the period" aria-valuenow={Math.round(account.progressPercent)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${account.progressPercent}%` }} />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">{account.clockTime ? `At ${fmtWallClock(account.clockTime)}` : "Replay not started"}</p>
      </div>
    </Link>
  );
}
