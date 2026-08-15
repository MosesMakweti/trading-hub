import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";

/** Spec §8 — inside a completed Trade Idea, each account's financial result
 *  next to the others, distinguishable from the Idea's own shared market
 *  result (that lives in Trade Execution / Trade Review, not here). Totals
 *  are grouped by account currency rather than summed across currencies
 *  (spec §9 — no fabricated FX conversion), and always labeled as the
 *  COMBINED allocated-account result, never as "the trade's PnL". */
export function AccountPerformanceBreakdown({
  executions,
  propFirmAccounts,
}: {
  executions: ExecutionDTO[];
  propFirmAccounts: AccountAllocationSelectorDTO[];
}) {
  const totalsByCurrency = new Map<string, number>();
  for (const execution of executions) {
    const account = propFirmAccounts.find((a) => a.id === execution.propFirmAccountId);
    const currency = account?.accountCurrency ?? "USD";
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + (execution.netPnl ?? 0));
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Account performance breakdown</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-background/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Risk</th>
              <th className="px-3 py-2 font-medium text-right">Risk amount</th>
              <th className="px-3 py-2 font-medium text-right">Realized R</th>
              <th className="px-3 py-2 font-medium text-right">Net PnL</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((execution) => {
              const account = propFirmAccounts.find((a) => a.id === execution.propFirmAccountId);
              return (
                <tr key={execution.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {account && <PropFirmLogo name={account.companyName} logoUrl={account.logoUrl} accentColor={account.accentColor} className="size-4" />}
                      <span className="font-medium">{account?.displayName ?? "Account"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{execution.stageName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {execution.riskPercentOfBase != null ? `${execution.riskPercentOfBase.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(execution.plannedRiskAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {execution.actualR != null ? `${execution.actualR >= 0 ? "+" : ""}${execution.actualR.toFixed(2)}R` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${execution.netPnl! >= 0 ? "text-success" : "text-danger"}`}>
                    {formatSignedCurrency(execution.netPnl!)}
                    {execution.isPnlEstimated && <span className="ml-1 text-[10px] font-normal text-muted-foreground italic">est.</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[...totalsByCurrency.entries()].map(([currency, total]) => (
              <tr key={currency} className="border-t border-border bg-background/40">
                <td colSpan={5} className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Combined allocated-account PnL ({currency})
                </td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${total >= 0 ? "text-success" : "text-danger"}`}>
                  {formatSignedCurrency(total)}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
