"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateStopLossPlacement } from "@/actions/trading-plan.actions";

export function StopLossSection({ stopLossPlacement }: { stopLossPlacement: unknown }) {
  return (
    <RichTextEditor
      initialContent={stopLossPlacement}
      placeholder="How do you decide where to place your stop?"
      onSave={(content) => updateStopLossPlacement({ stopLossPlacement: content })}
    />
  );
}
