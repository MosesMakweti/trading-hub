import { Flame } from "lucide-react";
import { SERIES, VIZ } from "@/components/viz/tokens";

import { EmptyState } from "@/components/shared/empty-state";
import { Donut, type DonutSegment } from "@/components/analytics/donut";
import { RowBar } from "@/components/analytics/row-bar";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { accountTotalCosts } from "@/domain/prop-firms/metrics";
import type { UserPropFirmDTO } from "@/types/prop-firms";

export function CostsTab({ firm }: { firm: UserPropFirmDTO }) {
  if (firm.accounts.length === 0) {
    return (
      <EmptyState
        icon={Flame}
        title="No costs recorded yet"
        description="Purchase price, resets, and other fees will show up here once an account is added."
      />
    );
  }

  const perAccountTotal = firm.accounts.map((a) => ({ account: a, total: accountTotalCosts(a) }));
  const totalCosts = perAccountTotal.reduce((sum, a) => sum + a.total, 0);
  const maxTotal = Math.max(...perAccountTotal.map((a) => a.total), 0);

  const composition = {
    purchasePrice: firm.accounts.reduce((sum, a) => sum + (a.purchasePrice ?? 0), 0),
    resetFees: firm.accounts.reduce((sum, a) => sum + (a.resetFees ?? 0), 0),
    activationFees: firm.accounts.reduce((sum, a) => sum + (a.activationFees ?? 0), 0),
    otherCosts: firm.accounts.reduce((sum, a) => sum + (a.otherCosts ?? 0), 0),
  };
  const compositionSegments: DonutSegment[] = [
    // Cost types are identities → identity slots in fixed order ("Other" neutral).
    { label: "Purchase price", value: composition.purchasePrice, color: SERIES[0] },
    { label: "Reset fees", value: composition.resetFees, color: SERIES[1] },
    { label: "Activation fees", value: composition.activationFees, color: SERIES[2] },
    { label: "Other", value: composition.otherCosts, color: VIZ.neutral },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        <div className="glass flex items-center justify-center rounded-2xl p-4">
          {compositionSegments.length > 0 ? (
            <Donut segments={compositionSegments} size={140} stroke={16}>
              <span className="text-xs text-muted-foreground">Total</span>
              <span className="text-base font-semibold tabular-nums">{formatCurrency(totalCosts)}</span>
            </Donut>
          ) : (
            <span className="text-sm text-muted-foreground">{formatCurrency(totalCosts)} total</span>
          )}
        </div>
        <div className="glass flex items-center justify-between rounded-2xl p-4">
          <span className="text-sm text-muted-foreground">Total prop firm costs</span>
          <span className="text-lg font-semibold">{formatCurrency(totalCosts)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Purchase price</th>
              <th className="px-3 py-2 font-medium">Discount</th>
              <th className="px-3 py-2 font-medium">Reset fees</th>
              <th className="px-3 py-2 font-medium">Activation fees</th>
              <th className="px-3 py-2 font-medium">Other</th>
              <th className="px-3 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {perAccountTotal.map(({ account: a, total }) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{a.displayName}</td>
                <td className="px-3 py-2 tabular-nums">{a.purchasePrice != null ? formatCurrency(a.purchasePrice) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.discount != null ? formatCurrency(a.discount) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.resetFees != null ? formatCurrency(a.resetFees) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.activationFees != null ? formatCurrency(a.activationFees) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.otherCosts != null ? formatCurrency(a.otherCosts) : "—"}</td>
                <td className="px-3 py-2 font-medium">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums">{formatCurrency(total)}</span>
                    <RowBar percent={maxTotal > 0 ? (total / maxTotal) * 100 : null} label="" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
