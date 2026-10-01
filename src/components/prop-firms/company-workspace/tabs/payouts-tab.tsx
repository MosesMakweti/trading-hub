import { PiggyBank } from "lucide-react";
import { VIZ, tint } from "@/components/viz/tokens";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Donut, type DonutSegment } from "@/components/analytics/donut";
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
    .flatMap((a) =>
      a.payouts.map((p) => ({
        ...p,
        accountName: a.displayName,
        accountProduct: a.modelName ?? a.modelType.replace(/_/g, " "),
        accountCurrency: a.accountCurrency,
      })),
    )
    .sort((a, b) => (b.paidDate ?? b.requestedDate ?? "").localeCompare(a.paidDate ?? a.requestedDate ?? ""));

  if (payouts.length === 0) {
    return (
      <EmptyState
        icon={PiggyBank}
        title="No payouts yet"
        description="Payouts for funded accounts will show up here once requested — open a funded account to log one, or import a statement."
      />
    );
  }

  const paid = payouts.filter((p) => p.status === "PAID");
  // Main total = what the trader actually received after each payout's own
  // profit split. Gross and prop-firm-share reported separately.
  const totalTraderReceived = paid.reduce((sum, p) => sum + p.traderReceived, 0);
  const totalGross = paid.reduce((sum, p) => sum + p.grossPayout, 0);
  const totalPropFirmShare = paid.reduce((sum, p) => sum + (p.propFirmShare ?? 0), 0);

  const statusCounts = payouts.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusSegments: DonutSegment[] = [
    // In-progress stages share one ordinal blue ramp (lighter = earlier);
    // outcomes use polarity: paid = profit, rejected = loss, cancelled = neutral.
    { label: "Paid", value: statusCounts.PAID ?? 0, color: VIZ.profit },
    { label: "Approved", value: statusCounts.APPROVED ?? 0, color: "var(--viz-1)" },
    { label: "Under review", value: statusCounts.UNDER_REVIEW ?? 0, color: tint("var(--viz-1)", 75) },
    { label: "Requested", value: statusCounts.REQUESTED ?? 0, color: tint("var(--viz-1)", 55) },
    { label: "Available", value: statusCounts.AVAILABLE ?? 0, color: tint("var(--viz-1)", 38) },
    { label: "Rejected", value: statusCounts.REJECTED ?? 0, color: VIZ.loss },
    { label: "Cancelled", value: statusCounts.CANCELLED ?? 0, color: VIZ.neutral },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        {statusSegments.length > 1 && (
          <div className="glass flex items-center justify-center rounded-2xl p-4">
            <Donut segments={statusSegments} size={132} stroke={14}>
              <span className="text-xs text-muted-foreground">Payouts</span>
              <span className="text-base font-semibold tabular-nums">{payouts.length}</span>
            </Donut>
          </div>
        )}
        <div className="glass grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Trader received (paid)</div>
            <div className="text-lg font-semibold text-success tabular-nums">{formatCurrency(totalTraderReceived)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Gross payouts</div>
            <div className="text-lg font-semibold tabular-nums">{formatCurrency(totalGross)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Prop-firm share</div>
            <div className="text-lg font-semibold tabular-nums">{formatCurrency(totalPropFirmShare)}</div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Ccy</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">Split</th>
              <th className="px-3 py-2 text-right font-medium">Trader received</th>
              <th className="px-3 py-2 text-right font-medium">Firm share</th>
              <th className="px-3 py-2 font-medium">Paid</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{p.accountName}</td>
                <td className="px-3 py-2 text-muted-foreground capitalize">{p.accountProduct}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.accountCurrency}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.grossPayout)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.profitSplitPercent != null ? `${p.profitSplitPercent}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-success">
                  {formatCurrency(p.traderReceived)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.propFirmShare != null ? formatCurrency(p.propFirmShare) : "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(p.paidDate)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.importBatchId ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="outline">Import</Badge>
                      <span className="max-w-[10rem] truncate">{p.platformTransactionId ?? p.referenceId ?? "—"}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="outline">Manual</Badge>
                      <span>{p.referenceId ?? "—"}</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{p.status.replace(/_/g, " ")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
