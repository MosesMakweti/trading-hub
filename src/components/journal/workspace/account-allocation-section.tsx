"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountAllocationRow } from "@/components/journal/workspace/account-allocation-row";
import { AccountPerformanceBreakdown } from "@/components/journal/workspace/account-performance-breakdown";
import { PerformanceAccountRow } from "@/components/journal/workspace/performance-account-row";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";
import { useWorkspace } from "@/components/workspace/workspace-context";

type AccountAllocationSectionProps = {
  dateKey: string;
  tradeId: string;
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executions: ExecutionDTO[];
};

/** Performance Account + Prop Firm allocation are LIVE accounting — a
 *  simulated trade never has either (also refused server-side / by DB trigger). */
export function AccountAllocationSection(props: AccountAllocationSectionProps) {
  const { isBacktest } = useWorkspace();
  return isBacktest ? null : <LiveAccountAllocationSection {...props} />;
}

function LiveAccountAllocationSection({ dateKey, tradeId, propFirmAccounts, executions }: AccountAllocationSectionProps) {
  const editable = useWorkspaceEditable();
  const [addedAccountIds, setAddedAccountIds] = useState<string[]>([]);
  const [pickerValue, setPickerValue] = useState<string>("");

  const savedAccountIds = executions.map((e) => e.propFirmAccountId);
  const visibleAccountIds = [...new Set([...savedAccountIds, ...addedAccountIds])];
  const availableToAdd = propFirmAccounts.filter((a) => !visibleAccountIds.includes(a.id));

  // Spec §8: a compact, read-only Account/Stage/Risk/Risk-Amount/Realized-R/
  // Net-PnL breakdown for accounts with a resolved result — kept visually
  // distinct from the shared Trade Idea's own market result and from the
  // full editable rows below (which stay for entering/adjusting actuals).
  const resolvedExecutions = executions.filter((e) => e.netPnl != null);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/30 p-3">
      <PerformanceAccountRow dateKey={dateKey} tradeId={tradeId} />

      {resolvedExecutions.length > 0 && (
        <AccountPerformanceBreakdown executions={resolvedExecutions} propFirmAccounts={propFirmAccounts} />
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">Other participating accounts</div>
        {editable && availableToAdd.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              items={Object.fromEntries(availableToAdd.map((a) => [a.id, `${a.displayName} (${a.companyName})`]))}
              value={pickerValue}
              onValueChange={(v) => v && setPickerValue(v)}
            >
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Select account…" /></SelectTrigger>
              <SelectContent>
                {availableToAdd.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.displayName} ({a.companyName})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              disabled={!pickerValue}
              onClick={() => {
                if (pickerValue) {
                  setAddedAccountIds((ids) => [...ids, pickerValue]);
                  setPickerValue("");
                }
              }}
            >
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        )}
      </div>

      {visibleAccountIds.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No other accounts allocated to this idea yet.</p>
      ) : (
        <div className="space-y-3">
          {visibleAccountIds.map((accountId) => {
            const account = propFirmAccounts.find((a) => a.id === accountId);
            if (!account) return null;
            const execution = executions.find((e) => e.propFirmAccountId === accountId);
            return (
              <AccountAllocationRow
                key={accountId}
                tradeId={tradeId}
                account={account}
                execution={execution}
                onRemoved={() => setAddedAccountIds((ids) => ids.filter((id) => id !== accountId))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
