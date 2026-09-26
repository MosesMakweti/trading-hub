"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateDailyNote } from "@/actions/journal.actions";
import { useDayRef } from "@/components/workspace/workspace-context";

export function DailyNoteEditor({
  dateKey,
  initialContent,
  editable = true,
}: {
  dateKey: string;
  initialContent: unknown;
  editable?: boolean;
}) {
  const dayRef = useDayRef(dateKey);
  return (
    <RichTextEditor
      initialContent={initialContent}
      placeholder={editable ? "Notes for this trading day..." : "No notes for this day."}
      editable={editable}
      onSave={(content) => updateDailyNote(dayRef, { content })}
    />
  );
}
