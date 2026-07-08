"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PropFirmAccountDialog } from "@/components/accounts/prop-firm-account-dialog";
import { BrokerageAccountDialog } from "@/components/accounts/brokerage-account-dialog";
import { archiveTradingAccount } from "@/actions/accounts.actions";
import { computeBrokerageMetrics, computePropFirmRoi } from "@/domain/accounts/derived";
import type { TradingAccountDTO } from "@/types/accounts";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PASSED: "Passed",
  FAILED: "Failed",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

const PHASE_LABELS: Record<string, string> = {
  PHASE_1: "Phase 1",
  PHASE_2: "Phase 2",
  MASTER: "Master",
};

function currency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function percent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function AccountCard({ account }: { account: TradingAccountDTO }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await archiveTradingAccount(account.id);
      if (!result.success) {
        toast.error(result.error ?? "Failed to remove account.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const isPropFirm = account.kind === "PROP_FIRM";
  const roi = isPropFirm ? computePropFirmRoi(account.purchaseCost, account.totalPayouts) : null;
  const brokerage = !isPropFirm
    ? computeBrokerageMetrics({
        startingBalance: account.startingBalance,
        currentBalance: account.currentBalance,
        totalWithdrawals: account.totalWithdrawals,
        totalDeposits: account.totalDeposits,
      })
    : null;

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{account.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {isPropFirm ? account.propFirmName : account.brokerName}
            {isPropFirm && account.phase && ` · ${PHASE_LABELS[account.phase]}`}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {STATUS_LABELS[account.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="Current balance" value={currency(account.currentBalance)} />
        {isPropFirm ? (
          <>
            <Metric label="Account size" value={currency(account.accountSize ?? 0)} />
            <Metric label="Purchase cost" value={currency(account.purchaseCost ?? 0)} />
            <Metric label="Total payouts" value={currency(account.totalPayouts ?? 0)} />
            <Metric
              label="ROI"
              value={roi == null ? "—" : percent(roi)}
              tone={roi == null ? "neutral" : roi >= 0 ? "success" : "danger"}
            />
          </>
        ) : (
          <>
            <Metric label="Starting balance" value={currency(account.startingBalance ?? 0)} />
            <Metric
              label="Net profit"
              value={brokerage?.netProfit == null ? "—" : currency(brokerage.netProfit)}
              tone={
                brokerage?.netProfit == null ? "neutral" : brokerage.netProfit >= 0 ? "success" : "danger"
              }
            />
            <Metric
              label="Total return"
              value={brokerage?.totalReturnPercent == null ? "—" : percent(brokerage.totalReturnPercent)}
              tone={
                brokerage?.totalReturnPercent == null
                  ? "neutral"
                  : brokerage.totalReturnPercent >= 0
                    ? "success"
                    : "danger"
              }
            />
            <Metric
              label="Equity growth"
              value={
                brokerage?.currentEquityGrowthPercent == null
                  ? "—"
                  : percent(brokerage.currentEquityGrowthPercent)
              }
              tone={
                brokerage?.currentEquityGrowthPercent == null
                  ? "neutral"
                  : brokerage.currentEquityGrowthPercent >= 0
                    ? "success"
                    : "danger"
              }
            />
          </>
        )}
      </div>

      {account.notes && <p className="text-xs text-muted-foreground">{account.notes}</p>}

      <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
        {isPropFirm ? (
          <PropFirmAccountDialog
            mode="edit"
            accountId={account.id}
            defaultValues={{
              name: account.name,
              propFirmName: account.propFirmName ?? "",
              accountSize: account.accountSize ?? 0,
              currentBalance: account.currentBalance,
              phase: account.phase ?? "PHASE_1",
              purchaseCost: account.purchaseCost ?? 0,
              totalPayouts: account.totalPayouts ?? 0,
              status: account.status,
              notes: account.notes ?? undefined,
            }}
          />
        ) : (
          <BrokerageAccountDialog
            mode="edit"
            accountId={account.id}
            defaultValues={{
              name: account.name,
              brokerName: account.brokerName ?? "",
              startingBalance: account.startingBalance ?? 0,
              currentBalance: account.currentBalance,
              totalWithdrawals: account.totalWithdrawals ?? 0,
              totalDeposits: account.totalDeposits ?? 0,
              status: account.status,
              notes: account.notes ?? undefined,
            }}
          />
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => setConfirmOpen(true)}>
          <Trash2 />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove this account?"
        description={`"${account.name}" will be archived and removed from My Accounts. This can't be undone from here.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-medium",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
    </div>
  );
}
