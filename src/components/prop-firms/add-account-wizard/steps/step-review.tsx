"use client";

import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { Badge } from "@/components/ui/badge";
import { RULE_TEMPLATE_BY_KEY } from "@/domain/prop-firms/rule-templates";
import type { AccountDraft } from "../types";

const MODEL_LABELS: Record<string, string> = {
  ONE_PHASE: "One-phase",
  TWO_PHASE: "Two-phase",
  THREE_PHASE: "Three-phase",
  INSTANT_FUNDED: "Instant funded",
  CUSTOM: "Custom",
};

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function StepReview({ draft }: { draft: AccountDraft }) {
  const totalCosts =
    Math.max(0, num(draft.purchasePrice) - num(draft.discount)) +
    num(draft.resetFees) +
    num(draft.activationFees) +
    num(draft.otherCosts);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4">
        <div className="text-sm font-medium">{draft.displayName || "Untitled account"}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {draft.companyName} · {draft.marketCategory} · {MODEL_LABELS[draft.modelType]}
          {draft.modelName ? ` (${draft.modelName})` : ""}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <ReviewField label="Account size" value={formatCurrency(num(draft.accountSize))} />
          <ReviewField label="Currency" value={draft.accountCurrency || "USD"} />
          <ReviewField label="Total costs" value={formatCurrency(totalCosts)} />
          <ReviewField label="Purchase date" value={draft.purchaseDate || "—"} />
        </div>
        {draft.notes && <p className="mt-3 text-xs text-muted-foreground">{draft.notes}</p>}
      </div>

      <div className="space-y-2.5">
        <div className="text-xs font-medium text-muted-foreground">
          {draft.stages.length} stage{draft.stages.length === 1 ? "" : "s"}
        </div>
        {draft.stages.map((stage) => (
          <div key={stage.localId} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{stage.name}</span>
              <Badge variant="outline">{stage.type.replace(/_/g, " ")}</Badge>
            </div>
            {stage.rules.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground italic">No rules configured.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {stage.rules.map((rule) => {
                  const template = RULE_TEMPLATE_BY_KEY[rule.ruleKey];
                  const value =
                    template.inputKind === "toggle"
                      ? rule.booleanValue
                        ? "Restricted"
                        : "Allowed"
                      : template.inputKind === "text"
                        ? rule.textValue || "—"
                        : rule.numericValue
                          ? `${rule.numericValue}${template.inputKind === "percent" ? "%" : ""}`
                          : "—";
                  return (
                    <li key={rule.localId} className="flex items-center justify-between text-xs">
                      <span className={rule.isEnabled ? "text-foreground" : "text-muted-foreground line-through"}>
                        {rule.name}
                      </span>
                      <span className="text-muted-foreground">{value}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
