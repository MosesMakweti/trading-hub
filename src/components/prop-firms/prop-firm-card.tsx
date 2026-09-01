"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Plus, ShieldAlert, Star, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { toAccountRollupInput } from "@/components/prop-firms/rollup";
import { aggregateAccounts } from "@/domain/prop-firms/metrics";
import { deleteUserPropFirmAction, updateUserPropFirmAction } from "@/actions/prop-firms.actions";
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

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-medium tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function PropFirmCard({ firm }: { firm: UserPropFirmDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, startDelete] = useTransition();

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

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteUserPropFirmAction(firm.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Prop firm deleted.");
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{firm.companyName}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {firm.marketCategory} · {firm.accounts.length} account{firm.accounts.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {firm.status === "ARCHIVED" && <Badge variant="secondary">Archived</Badge>}
          <Button
            type="button"
            variant={firm.isPriority ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={isPending}
            onClick={togglePriority}
            aria-pressed={firm.isPriority}
            title={firm.isPriority ? "Priority firm — click to unpin" : "Mark as priority"}
            aria-label={firm.isPriority ? `Remove ${firm.companyName} from priority` : `Mark ${firm.companyName} as priority`}
          >
            <Star className={cn("size-4", firm.isPriority ? "fill-warning text-warning" : "")} />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            onClick={() => setConfirmDelete(true)}
            title="Delete firm"
            aria-label={`Delete ${firm.companyName}`}
          >
            <Trash2 className="size-4" />
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
            <Metric
              label="Account ROI"
              value={formatPercent(metrics.accountRoiPercent)}
              tone={toneClass(metrics.accountRoiPercent)}
              hint="Net trading P&L ÷ combined starting balance — how the accounts themselves are performing."
            />
            <Metric
              label="Investment ROI"
              value={formatPercent(metrics.traderInvestmentRoiPercent)}
              tone={toneClass(metrics.traderInvestmentRoiPercent)}
              hint="Net prop-firm profit (payouts − costs) ÷ total costs — return on what you spent on challenges. Can be large or −100% when costs are small."
            />
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

      <div className="mt-1 flex gap-2">
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          nativeButton={false}
          render={<Link href={`/prop-firms/${firm.id}`} />}
          aria-label={`Open ${firm.companyName} workspace`}
        >
          <ArrowUpRight className="size-4" />
          Open workspace
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          nativeButton={false}
          render={<Link href={`/prop-firms/add-account?firmId=${firm.id}`} />}
        >
          <Plus className="size-3.5" />
          Add account
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this prop firm?"
        description={`"${firm.companyName}" and all ${firm.accounts.length} of its purchased account${firm.accounts.length === 1 ? "" : "s"} will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
