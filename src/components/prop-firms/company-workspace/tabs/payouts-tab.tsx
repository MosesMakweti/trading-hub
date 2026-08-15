import { PiggyBank } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import type { UserPropFirmDTO } from "@/types/prop-firms";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  AVAILABLE: "outline",
  REQUESTED: "secondary",
  UNDER_REVIEW: "warning",
  APPROVED: "secondary",
  PAID: "success",
  REJECTED: "danger",
  CANCELLED: "outline",
};

export function PayoutsTab({ firm }: { firm: UserPropFirmDTO }) {
  const payouts = firm.accounts
    .flatMap((a) => a.payouts.map((p) => ({ ...p, accountName: a.displayName })))
    .sort((a, b) => (b.paidDate ?? b.requestedDate ?? "").localeCompare(a.paidDate ?? a.requestedDate ?? ""));

  if (payouts.length === 0) {
    return (
      <EmptyState
        icon={PiggyBank}
        title="No payouts yet"
        description="Payouts for funded accounts will show up here once requested — open a funded account to log one."
      />
    );
  }

  const totalReceived = payouts.filter((p) => p.status === "PAID").reduce((sum, p) => sum + (p.netReceived ?? p.grossPayout), 0);

  return (
    <div className="space-y-3">
      <div className="glass flex items-center justify-between rounded-2xl p-4">
        <span className="text-sm text-muted-foreground">Total received</span>
        <span className="text-lg font-semibold text-success">{formatCurrency(totalReceived)}</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Gross</th>
              <th className="px-3 py-2 font-medium">Net</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Requested</th>
              <th className="px-3 py-2 font-medium">Paid</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{p.accountName}</td>
                <td className="px-3 py-2 tabular-nums">{formatCurrency(p.grossPayout)}</td>
                <td className="px-3 py-2 tabular-nums">{p.netReceived != null ? formatCurrency(p.netReceived) : "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{p.status.replace(/_/g, " ")}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(p.requestedDate)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(p.paidDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
