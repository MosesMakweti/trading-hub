"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateWeeklyReview } from "@/actions/edge.actions";

const FIELDS = [
  {
    key: "wentWell",
    label: "What went well?",
    placeholder: "Your best decisions, disciplines, and wins this week…",
  },
  {
    key: "toImprove",
    label: "What to improve?",
    placeholder: "Mistakes, leaks, and patterns to fix…",
  },
  {
    key: "focusNextWeek",
    label: "Focus for next week",
    placeholder: "The one or two things you'll do differently…",
  },
] as const;

/**
 * The guided weekly reflection (P10) — three autosaving rich-text sections that
 * persist to the week's WeeklyReview. Reuses the shared RichTextEditor.
 */
export function WeeklyReflection({
  weekStartKey,
  initial,
}: {
  weekStartKey: string;
  initial: { wentWell: unknown; toImprove: unknown; focusNextWeek: unknown };
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Weekly reflection</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium">{f.label}</h3>
            <RichTextEditor
              initialContent={initial[f.key]}
              placeholder={f.placeholder}
              onSave={(content) => updateWeeklyReview(weekStartKey, { [f.key]: content })}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
