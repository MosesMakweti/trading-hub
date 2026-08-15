import { Flame } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
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

  const totalCosts = firm.accounts.reduce((sum, a) => sum + accountTotalCosts(a), 0);

  return (
    <div className="space-y-3">
      <div className="glass flex items-center justify-between rounded-2xl p-4">
        <span className="text-sm text-muted-foreground">Total prop firm costs</span>
        <span className="text-lg font-semibold">{formatCurrency(totalCosts)}</span>
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
            {firm.accounts.map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{a.displayName}</td>
                <td className="px-3 py-2 tabular-nums">{a.purchasePrice != null ? formatCurrency(a.purchasePrice) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.discount != null ? formatCurrency(a.discount) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.resetFees != null ? formatCurrency(a.resetFees) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.activationFees != null ? formatCurrency(a.activationFees) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{a.otherCosts != null ? formatCurrency(a.otherCosts) : "—"}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{formatCurrency(accountTotalCosts(a))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
