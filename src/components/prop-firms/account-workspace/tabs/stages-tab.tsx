"use client";

import { useState } from "react";
import { CheckCircle2, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowBar } from "@/components/analytics/row-bar";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { CompleteStageDialog } from "../complete-stage-dialog";
import type { AccountStageDTO, PropFirmAccountDTO, RuleHealthDTO } from "@/types/prop-firms";

const STAGE_STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  PENDING: "outline",
  ACTIVE: "secondary",
  PASSED: "success",
  FAILED: "danger",
  BREACHED: "danger",
  RESET: "warning",
  ABANDONED: "outline",
  ARCHIVED: "outline",
};

export function StagesTab({
  account,
  ruleHealthByRuleId,
}: {
  account: PropFirmAccountDTO;
  ruleHealthByRuleId: Record<string, RuleHealthDTO>;
}) {
  const [completingStage, setCompletingStage] = useState<AccountStageDTO | null>(null);

  return (
    <div className="space-y-2.5">
      {account.stages.map((stage) => {
        const profitTargetRule = stage.rules.find((r) => r.ruleKey === "PROFIT_TARGET");
        const profitTargetHealth = profitTargetRule ? ruleHealthByRuleId[profitTargetRule.id] : undefined;
        const targetReached = stage.status === "ACTIVE" && profitTargetHealth?.state === "TARGET_REACHED";

        return (
        <div key={stage.id} className="glass rounded-xl p-4">
          {targetReached && (
            <button
              type="button"
              onClick={() => setCompletingStage(stage)}
              className="mb-3 flex w-full items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-left text-xs text-success transition-colors hover:bg-success/15"
            >
              <Target className="size-3.5 shrink-0" />
              Target reached — confirm the official result to close this stage.
            </button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{stage.name}</span>
              <Badge variant={STAGE_STATUS_VARIANT[stage.status] ?? "secondary"}>{stage.status}</Badge>
              <span className="text-xs text-muted-foreground">{stage.type.replace(/_/g, " ")}</span>
            </div>
            {stage.status === "ACTIVE" && (
              <Button type="button" size="sm" className="gap-1.5" onClick={() => setCompletingStage(stage)}>
                <CheckCircle2 className="size-3.5" />
                Complete stage
              </Button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
            <div>
              <div className="text-muted-foreground uppercase">Starting balance</div>
              <div className="mt-0.5 font-medium">{formatCurrency(stage.startingBalance)}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase">Final balance</div>
              <div className="mt-0.5 font-medium">
                {stage.currentBalance != null ? formatCurrency(stage.currentBalance) : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase">P&L</div>
              <div className={`mt-0.5 font-medium ${stage.profitLoss != null && stage.profitLoss !== 0 ? (stage.profitLoss > 0 ? "text-success" : "text-danger") : ""}`}>
                {stage.profitLoss != null ? formatSignedCurrency(stage.profitLoss) : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase">Started</div>
              <div className="mt-0.5 font-medium">{formatDate(stage.startDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase">Completed</div>
              <div className="mt-0.5 font-medium">{formatDate(stage.completionDate)}</div>
            </div>
          </div>

          {profitTargetHealth?.percentConsumed != null && (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Profit target progress</span>
              <RowBar percent={profitTargetHealth.percentConsumed} />
            </div>
          )}

          <div className="mt-2 text-xs text-muted-foreground">
            {stage.rules.length} rule{stage.rules.length === 1 ? "" : "s"} configured
          </div>

          {stage.completionNotes && <p className="mt-2 text-xs text-muted-foreground italic">{stage.completionNotes}</p>}
        </div>
        );
      })}

      {completingStage && (
        <CompleteStageDialog
          accountId={account.id}
          stage={completingStage}
          open={completingStage != null}
          onOpenChange={(open) => !open && setCompletingStage(null)}
        />
      )}
    </div>
  );
}
