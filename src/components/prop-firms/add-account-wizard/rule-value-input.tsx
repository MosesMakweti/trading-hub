"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { RuleInputKind } from "@/domain/prop-firms/rule-templates";
import type { DraftRule } from "./types";

/**
 * The one input that changes shape per rule template — percent/currency/
 * integer render as a number field with the right affix, toggle renders a
 * switch bound to `booleanValue`, text renders a plain text field. Nothing
 * here decides *whether* a rule applies to a market — that's `markets` on
 * the template, filtered before a rule ever reaches this component.
 */
export function RuleValueInput({
  inputKind,
  rule,
  onChange,
}: {
  inputKind: RuleInputKind;
  rule: DraftRule;
  onChange: (patch: Partial<DraftRule>) => void;
}) {
  if (inputKind === "toggle") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={rule.booleanValue}
          onCheckedChange={(checked) => onChange({ booleanValue: checked })}
          aria-label={`${rule.name || "Rule"} enabled value`}
        />
        <span className="text-xs text-muted-foreground">{rule.booleanValue ? "Restricted" : "Allowed"}</span>
      </div>
    );
  }

  if (inputKind === "text") {
    return (
      <Input
        value={rule.textValue}
        onChange={(e) => onChange({ textValue: e.target.value })}
        placeholder="Describe the rule…"
      />
    );
  }

  return (
    <div className="relative">
      {inputKind === "currency" && (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          $
        </span>
      )}
      <Input
        type="number"
        step={inputKind === "integer" ? 1 : "any"}
        value={rule.numericValue}
        onChange={(e) => onChange({ numericValue: e.target.value })}
        className={inputKind === "currency" ? "pl-6" : inputKind === "percent" ? "pr-7" : undefined}
        placeholder={inputKind === "percent" ? "e.g. 8" : inputKind === "currency" ? "e.g. 5000" : "e.g. 3"}
      />
      {inputKind === "percent" && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      )}
    </div>
  );
}
