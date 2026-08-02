import { z } from "zod";

// Tiptap documents are arbitrary JSON; structure is enforced by the editor.
const richText = z.unknown().nullable();

const stepTitle = z.string().trim().min(1, "Step title is required.").max(160);

/** The rich-text field keys, in display order. Reused by the UI and duplicate logic. */
export const FRAMEWORK_RICH_FIELDS = ["description", "notes"] as const;

export type FrameworkRichField = (typeof FRAMEWORK_RICH_FIELDS)[number];

export const frameworkStepCreateSchema = z.object({ title: stepTitle });

// Partial update — the title and/or either rich-text field (autosaved per field).
export const frameworkStepUpdateSchema = z.object({
  title: stepTitle.optional(),
  description: richText.optional(),
  notes: richText.optional(),
});

export const frameworkReorderSchema = z.object({
  strategyId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type FrameworkStepCreateInput = z.infer<typeof frameworkStepCreateSchema>;
export type FrameworkStepUpdateInput = z.infer<typeof frameworkStepUpdateSchema>;
