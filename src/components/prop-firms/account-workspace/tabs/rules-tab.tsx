"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RULE_TEMPLATE_BY_KEY } from "@/domain/prop-firms/rule-templates";
import { RuleHealthBadge } from "@/components/prop-firms/rule-health-badge";
import type { PropFirmAccountDTO, RuleHealthDTO, StageRuleDTO } from "@/types/prop-firms";

function formatRuleValue(rule: StageRuleDTO): string {
  const template = RULE_TEMPLATE_BY_KEY[rule.ruleKey as keyof typeof RULE_TEMPLATE_BY_KEY];
  const inputKind = template?.inputKind;
  if (inputKind === "toggle") return rule.booleanValue ? "Restricted" : "Allowed";
  if (inputKind === "text") return rule.textValue || "—";
  if (rule.numericValue == null) return "—";
  return `${rule.numericValue}${inputKind === "percent" ? "%" : ""}`;
}

export function RulesTab({
  account,
  ruleHealthByRuleId,
}: {
  account: PropFirmAccountDTO;
  ruleHealthByRuleId: Record<string, RuleHealthDTO>;
}) {
  const [activeStageId, setActiveStageId] = useState(account.stages[0]?.id ?? "");
  const stage = account.stages.find((s) => s.id === activeStageId) ?? account.stages[0];

  if (!stage) return <p className="text-sm text-muted-foreground">No stages on this account.</p>;

  return (
    <div className="space-y-4">
      <Tabs value={stage.id} onValueChange={setActiveStageId}>
        <TabsList className="flex-wrap">
          {account.stages.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.name} {s.rules.length > 0 && <span className="ml-1 text-muted-foreground">({s.rules.length})</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {stage.rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          No rules configured for this stage.
        </p>
      ) : (
        <div className="space-y-2">
          {stage.rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between rounded-lg border border-border px-3 py-2.5 ${!rule.isEnabled ? "opacity-60" : ""}`}
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {rule.name}
                  {!rule.isEnabled && <Badge variant="outline">Disabled</Badge>}
                </div>
                {(rule.measurementBasis || rule.measurementPeriod) && (
                  <div className="text-xs text-muted-foreground">
                    {[rule.measurementBasis, rule.measurementPeriod].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-medium">{formatRuleValue(rule)}</div>
                  {rule.breachAction && (
                    <div className="text-xs text-muted-foreground">{rule.breachAction.replace(/_/g, " ").toLowerCase()}</div>
                  )}
                </div>
                {rule.isEnabled && <RuleHealthBadge health={ruleHealthByRuleId[rule.id]} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
