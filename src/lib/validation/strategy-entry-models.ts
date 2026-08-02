import { z } from "zod";

// Tiptap documents are arbitrary JSON; structure is enforced by the editor.
const richText = z.unknown().nullable();

const modelName = z.string().trim().min(1, "Entry model name is required.").max(120);

/** The rich-text field keys, in display order. Reused by the UI and duplicate logic. */
export const ENTRY_MODEL_RICH_FIELDS = [
  "description",
  "conditions",
  "confirmationChecklist",
  "invalidation",
  "stopPlacement",
  "targetLogic",
  "notes",
] as const;

export type EntryModelRichField = (typeof ENTRY_MODEL_RICH_FIELDS)[number];

export const entryModelCreateSchema = z.object({ name: modelName });

// Partial update — the name and/or any single rich-text field (autosaved per field).
export const entryModelUpdateSchema = z.object({
  name: modelName.optional(),
  description: richText.optional(),
  conditions: richText.optional(),
  confirmationChecklist: richText.optional(),
  invalidation: richText.optional(),
  stopPlacement: richText.optional(),
  targetLogic: richText.optional(),
  notes: richText.optional(),
});

export const entryModelReorderSchema = z.object({
  strategyId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type EntryModelCreateInput = z.infer<typeof entryModelCreateSchema>;
export type EntryModelUpdateInput = z.infer<typeof entryModelUpdateSchema>;
