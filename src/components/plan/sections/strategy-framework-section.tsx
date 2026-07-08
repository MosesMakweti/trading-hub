"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateStrategyFramework } from "@/actions/trading-plan.actions";

export function StrategyFrameworkSection({ strategyFramework }: { strategyFramework: unknown }) {
  return (
    <RichTextEditor
      initialContent={strategyFramework}
      placeholder="Write out your strategy framework..."
      onSave={(content) => updateStrategyFramework({ strategyFramework: content })}
    />
  );
}
