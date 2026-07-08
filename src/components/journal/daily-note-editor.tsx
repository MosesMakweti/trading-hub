"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateDailyNote } from "@/actions/journal.actions";

export function DailyNoteEditor({
  dateKey,
  initialContent,
}: {
  dateKey: string;
  initialContent: unknown;
}) {
  return (
    <RichTextEditor
      initialContent={initialContent}
      placeholder="Notes for this trading day..."
      onSave={(content) => updateDailyNote(dateKey, { content })}
    />
  );
}
