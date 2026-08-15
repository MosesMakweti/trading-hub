"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/accounts/form-field";
import type { ModelTypeLike } from "@/domain/prop-firms/stage-templates";
import type { AccountDraft } from "../types";

const MODEL_OPTIONS: { value: ModelTypeLike; label: string; description: string }[] = [
  { value: "ONE_PHASE", label: "One-phase", description: "A single evaluation phase, then funded." },
  { value: "TWO_PHASE", label: "Two-phase", description: "Two evaluation phases, then funded." },
  { value: "THREE_PHASE", label: "Three-phase", description: "Three evaluation phases, then funded." },
  { value: "INSTANT_FUNDED", label: "Instant funded", description: "No evaluation — funded from day one." },
  { value: "CUSTOM", label: "Custom", description: "Define your own stage structure from scratch." },
];

export function StepModel({
  draft,
  onModelTypeChange,
  onModelNameChange,
}: {
  draft: AccountDraft;
  onModelTypeChange: (modelType: ModelTypeLike) => void;
  onModelNameChange: (modelName: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {MODEL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onModelTypeChange(option.value)}
            className={cn(
              "rounded-xl border border-border p-3.5 text-left transition-colors hover:border-primary hover:bg-muted",
              draft.modelType === option.value && "border-primary bg-muted",
            )}
          >
            <div className="text-sm font-medium">{option.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{option.description}</div>
          </button>
        ))}
      </div>
      <FormField label="Model name (optional)">
        <Input
          value={draft.modelName}
          onChange={(e) => onModelNameChange(e.target.value)}
          placeholder="e.g. Rapid, Knight, Standard…"
        />
      </FormField>
      <p className="text-xs text-muted-foreground">
        Choosing a model sets up default stage names on the next steps — every stage stays fully editable, and no
        numeric rule values are assumed for you.
      </p>
    </div>
  );
}
