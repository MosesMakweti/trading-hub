import { z } from "zod";

// Tiptap documents are arbitrary JSON; structure is enforced by the editor.
const richText = z.unknown().nullable();

const conceptName = z.string().trim().min(1, "Concept name is required.").max(120);

/** The rich-text field keys, in display order. Reused by the UI and duplicate logic. */
export const ARSENAL_RICH_FIELDS = [
  "definition",
  "purpose",
  "howIIdentify",
  "whyItMatters",
  "whenIUse",
  "whenIIgnore",
  "examples",
  "personalNotes",
] as const;

export type ArsenalRichField = (typeof ARSENAL_RICH_FIELDS)[number];

export const arsenalConceptCreateSchema = z.object({ name: conceptName });

// Partial update — the name and/or any single rich-text field (autosaved per field).
export const arsenalConceptUpdateSchema = z.object({
  name: conceptName.optional(),
  definition: richText.optional(),
  purpose: richText.optional(),
  howIIdentify: richText.optional(),
  whyItMatters: richText.optional(),
  whenIUse: richText.optional(),
  whenIIgnore: richText.optional(),
  examples: richText.optional(),
  personalNotes: richText.optional(),
});

export const arsenalReorderSchema = z.object({
  strategyId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type ArsenalConceptCreateInput = z.infer<typeof arsenalConceptCreateSchema>;
export type ArsenalConceptUpdateInput = z.infer<typeof arsenalConceptUpdateSchema>;
