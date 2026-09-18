"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Lock, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import {
  getPerformanceRiskContextAction,
  updatePerformanceRiskOverrideAction,
} from "@/actions/performance-account.actions";
import type { PerformanceRiskContext } from "@/server/services/performance-account.service";

/**
 * Today V2 (T3) — the Performance Account's participation in a Trade Idea,
 * presented without any implementation terminology (no "System A",
 * "TradeAccountAllocation", "PerformanceRiskSnapshot" — those stay internal).
 * It always participates; the trader only ever controls risk %, and the $
 * amount is derived (never a second, manually-typed value — reuses the
 * existing settlement architecture via getPerformanceRiskContext, never a
 * second risk system). Stage C's null-never-means-zero principle applies
 * here too: a balance/risk-amount that hasn't loaded (or failed to) renders
 * "—"/"Unavailable", never a fake $0.
 */
export function PerformanceAccountRow({ dateKey, tradeId }: { dateKey: string; tradeId: string }) {
  const editable = useWorkspaceEditable();
  const [context, setContext] = useState<PerformanceRiskContext | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [riskInput, setRiskInput] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getPerformanceRiskContextAction(tradeId);
      if (!active) return;
      if (result.success) {
        setContext(result.data);
        setRiskInput(String(result.data.riskPercent));
      } else {
        setLoadFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [tradeId]);

  const saveState = useDebouncedAutosave({
    value: riskInput,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const parsed = Number(v.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { success: false, error: "Risk % must be greater than zero." };
      }
      const result = await updatePerformanceRiskOverrideAction(dateKey, tradeId, parsed);
      if (result.success) {
        // riskAmount depends on riskPercent — refresh the derived value
        // rather than computing a second copy of that math here.
        const refreshed = await getPerformanceRiskContextAction(tradeId);
        if (refreshed.success) setContext(refreshed.data);
      }
      return result;
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  const riskAmountDisplay = loadFailed
    ? "Unavailable"
    : context?.riskAmount == null
      ? "—"
      : formatCurrency(context.riskAmount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 shrink-0 text-primary" />
        <div>
          <div className="text-sm font-medium">Performance Account</div>
          <div className="text-xs text-muted-foreground">Always participating</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">Risk</div>
          {context?.locked ? (
            <div className="flex items-center justify-end gap-1 text-sm tabular-nums">
              {context.riskPercent}%
              <Lock className="size-3 text-muted-foreground" aria-label="Locked — trade already has an actual entry" />
            </div>
          ) : editable ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                min="0"
                className="h-7 w-16 text-right text-sm tabular-nums"
                value={riskInput}
                onChange={(e) => setRiskInput(e.target.value)}
                disabled={context == null}
                aria-label="Performance Account risk percent"
              />
              <span className="text-xs text-muted-foreground">%</span>
              {saveState === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              {saveState === "saved" && <Check className="size-3.5 text-success" />}
            </div>
          ) : (
            <div className={cn("text-sm tabular-nums", context == null && "text-muted-foreground")}>
              {context ? `${context.riskPercent}%` : "—"}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">Approx. risk amount</div>
          <div className={cn("text-sm font-medium tabular-nums", riskAmountDisplay === "—" && "text-muted-foreground")}>
            {riskAmountDisplay}
          </div>
        </div>
      </div>
    </div>
  );
}
