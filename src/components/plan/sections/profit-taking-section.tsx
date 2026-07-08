"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateProfitTakingRules } from "@/actions/trading-plan.actions";

export function ProfitTakingSection({ profitTakingRules }: { profitTakingRules: unknown }) {
  return (
    <RichTextEditor
      initialContent={profitTakingRules}
      placeholder="When and how do you take profit?"
      onSave={(content) => updateProfitTakingRules({ profitTakingRules: content })}
    />
  );
}
