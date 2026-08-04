"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateDailyNote } from "@/actions/journal.actions";

export function DailyNoteEditor({
  dateKey,
  initialContent,
  editable = true,
}: {
  dateKey: string;
  initialContent: unknown;
  editable?: boolean;
}) {
  return (
    <RichTextEditor
      initialContent={initialContent}
      placeholder={editable ? "Notes for this trading day..." : "No notes for this day."}
      editable={editable}
      onSave={(content) => updateDailyNote(dateKey, { content })}
    />
  );
}
