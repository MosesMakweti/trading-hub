"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Plus, ShieldAlert, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { toAccountRollupInput } from "@/components/prop-firms/rollup";
import { aggregateAccounts } from "@/domain/prop-firms/metrics";
import { updateUserPropFirmAction } from "@/actions/prop-firms.actions";
import type { PropFirmAccountDTO, UserPropFirmDTO } from "@/types/prop-firms";

const ACCOUNT_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "danger" | "warning" | "outline"
> = {
  ACTIVE: "secondary",
  PASSED: "success",
  FAILED: "danger",
  BREACHED: "danger",
  FUNDED: "success",
  ARCHIVED: "outline",
};

function statusVariant(status: string) {
  return ACCOUNT_STATUS_VARIANT[status] ?? "secondary";
}

function currentStageLabel(account: PropFirmAccountDTO): string | null {
  const current = account.stages.find((s) => s.status === "PENDING" || s.status === "ACTIVE");
  return current?.name ?? null;
}

function formatPercent(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function toneClass(n: number | null): string {
  if (n == null || n === 0) return "text-foreground";
  return n > 0 ? "text-success" : "text-danger";
}

function AccountRow({ account }: { account: PropFirmAccountDTO }) {
  const stageLabel = currentStageLabel(account);
  const pnl = account.currentBalance != null ? account.currentBalance - account.startingBalance : null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{account.displayName}</span>
          <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatCurrency(account.accountSize)} · {account.marketCategory}
          {stageLabel ? ` · ${stageLabel}` : ""}
        </div>
      </div>
      {pnl != null && (
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", toneClass(pnl))}>
          {formatSignedCurrency(pnl)}
        </span>
      )}
    </div>
  );
}

/** Costs-vs-payouts at a glance: two slim proportional bars, no axis, no
 *  precision claimed — just "which is bigger" read in half a second. */
function CompactViz({ costs, payouts }: { costs: number; payouts: number }) {
  if (costs === 0 && payouts === 0) return null;
  const max = Math.max(costs, payouts, 1);
  return (
    <div className="space-y-1" aria-hidden>
      <div className="flex items-center gap-1.5">
        <span className="w-12 text-[10px] text-muted-foreground">Costs</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-danger/60" style={{ width: `${Math.min(100, (costs / max) * 100)}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-12 text-[10px] text-muted-foreground">Payouts</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success/60" style={{ width: `${Math.min(100, (payouts / max) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-medium tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function PropFirmCard({ firm }: { firm: UserPropFirmDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const metrics = aggregateAccounts(firm.accounts.map(toAccountRollupInput));

  function togglePriority() {
    startTransition(async () => {
      const result = await updateUserPropFirmAction(firm.id, { isPriority: !firm.isPriority });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{firm.companyName}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {firm.marketCategory} · {firm.accounts.length} account{firm.accounts.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {firm.status === "ARCHIVED" && <Badge variant="secondary">Archived</Badge>}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={isPending}
            onClick={togglePriority}
            aria-pressed={firm.isPriority}
            aria-label={firm.isPriority ? `Remove ${firm.companyName} from priority` : `Mark ${firm.companyName} as priority`}
          >
            <Star className={cn("size-3.5", firm.isPriority ? "fill-warning text-warning" : "text-muted-foreground")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            nativeButton={false}
            render={<Link href={`/prop-firms/${firm.id}`} />}
            aria-label={`Open ${firm.companyName} workspace`}
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {firm.accounts.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4">
            <Metric label="Challenges" value={String(metrics.activeChallengeCount)} />
            <Metric label="Funded" value={String(metrics.fundedCount)} />
            <Metric
              label="At risk"
              value={String(metrics.atRiskCount)}
              tone={metrics.atRiskCount > 0 ? "text-warning" : undefined}
            />
            <Metric
              label="Breached"
              value={String(metrics.breachedCount)}
              tone={metrics.breachedCount > 0 ? "text-danger" : undefined}
            />
            <Metric label="Net P&L" value={formatSignedCurrency(metrics.netTradingPnl)} tone={toneClass(metrics.netTradingPnl)} />
            <Metric label="Profit" value={formatSignedCurrency(metrics.netPropFirmProfit)} tone={toneClass(metrics.netPropFirmProfit)} />
            <Metric label="Account ROI" value={formatPercent(metrics.accountRoiPercent)} tone={toneClass(metrics.accountRoiPercent)} />
            <Metric label="Investment ROI" value={formatPercent(metrics.traderInvestmentRoiPercent)} tone={toneClass(metrics.traderInvestmentRoiPercent)} />
          </div>

          <CompactViz costs={metrics.totalCosts} payouts={metrics.totalPayoutsReceived} />

          {(metrics.atRiskCount > 0 || metrics.breachedCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {metrics.atRiskCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                  <AlertTriangle className="size-3" /> {metrics.atRiskCount} at risk
                </span>
              )}
              {metrics.breachedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                  <ShieldAlert className="size-3" /> {metrics.breachedCount} breached
                </span>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {firm.accounts.slice(0, 3).map((a) => (
              <AccountRow key={a.id} account={a} />
            ))}
          </div>
          {firm.accounts.length > 3 && (
            <Link href={`/prop-firms/${firm.id}`} className="text-xs text-primary hover:underline">
              +{firm.accounts.length - 3} more account{firm.accounts.length - 3 === 1 ? "" : "s"}
            </Link>
          )}
        </>
      )}

      {firm.accounts.length === 0 && <p className="text-xs text-muted-foreground italic">No purchased accounts yet.</p>}

      {firm.notes && <p className="text-xs text-muted-foreground">{firm.notes}</p>}

      <div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          nativeButton={false}
          render={<Link href={`/prop-firms/add-account?firmId=${firm.id}`} />}
        >
          <Plus className="size-3.5" />
          Add account
        </Button>
      </div>
    </div>
  );
}
