"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { TrackRecordTable } from "@/components/accounts/track-record-table";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { resetPerformanceAccountAction } from "@/actions/accounts.actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { EquityCurvePoint } from "@/domain/performance/rr";
import type { PerformanceAccountDTO } from "@/types/accounts";

function currency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function percent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PerformanceAccountSection({
  account,
  equityCurve,
  winRate,
  profitFactor,
}: {
  account: PerformanceAccountDTO;
  equityCurve: EquityCurvePoint[];
  winRate: number | null;
  profitFactor: number | null;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleReset() {
    setIsPending(true);
    const result = await resetPerformanceAccountAction();
    setIsPending(false);
    if (!result.success) {
      toast.error(result.error ?? "Failed to reset.");
      return;
    }
    setConfirmOpen(false);
    toast.success("Performance Account reset. All trading history has been cleared.");
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{account.name}</h2>
          <p className="text-sm text-muted-foreground">
            The application&apos;s master ledger — every dashboard number is derived from this
            account.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setConfirmOpen(true)}>
          <RotateCcw className="size-3.5" />
          Reset Performance Account
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Current Balance" value={currency(account.currentBalance)} />
        <KpiCard
          label="Total Return"
          value={percent(account.totalReturnPercent)}
          tone={account.totalReturnPercent >= 0 ? "success" : "danger"}
        />
        <KpiCard
          label="Net Profit"
          value={currency(account.netProfit)}
          tone={account.netProfit >= 0 ? "success" : "danger"}
        />
        <KpiCard label="Win Rate" value={winRate == null ? "—" : `${winRate.toFixed(1)}%`} />
        <KpiCard
          label="Profit Factor"
          value={profitFactor == null ? "—" : profitFactor.toFixed(2)}
        />
      </div>

      <EquityCurveChart data={equityCurve} />

      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-medium text-muted-foreground">Recent Trade History</h3>
        <TrackRecordTable entries={account.trackRecord} limit={10} />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset the Performance Account?"
        description="This permanently deletes every trade, daily note, and psychology record, and resets the Performance Account balance back to $100,000. Other accounts keep their own details but their trade history is cleared too. This can't be undone."
        confirmLabel="Reset everything"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleReset}
      />
    </section>
  );
}
