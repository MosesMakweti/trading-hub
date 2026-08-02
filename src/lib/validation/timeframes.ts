import { z } from "zod";

// Tiptap documents are arbitrary JSON; structure is enforced by the editor.
const richText = z.unknown().nullable();

const timeframeName = z.string().trim().min(1, "Timeframe name is required.").max(60);
const checkpointTitle = z.string().trim().min(1, "Checkpoint title is required.").max(160);

/** Checkpoint rich-text field keys, in display order. Reused by UI + duplicate. */
export const CHECKPOINT_RICH_FIELDS = ["description", "notes"] as const;
export type CheckpointRichField = (typeof CHECKPOINT_RICH_FIELDS)[number];

// ── Timeframes ───────────────────────────────────────────────────────────────
export const timeframeCreateSchema = z.object({ name: timeframeName });
export const timeframeRenameSchema = z.object({ name: timeframeName });
export const timeframeReorderSchema = z.object({
  strategyId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

// ── Checkpoints ──────────────────────────────────────────────────────────────
export const checkpointCreateSchema = z.object({ title: checkpointTitle });
export const checkpointUpdateSchema = z.object({
  title: checkpointTitle.optional(),
  description: richText.optional(),
  notes: richText.optional(),
});
export const checkpointReorderSchema = z.object({
  timeframeId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type TimeframeCreateInput = z.infer<typeof timeframeCreateSchema>;
export type CheckpointCreateInput = z.infer<typeof checkpointCreateSchema>;
export type CheckpointUpdateInput = z.infer<typeof checkpointUpdateSchema>;
