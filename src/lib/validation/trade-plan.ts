import { z } from "zod";

export const directionSchema = z.enum(["LONG", "SHORT"]);
export const distanceUnitSchema = z.enum(["PIP", "POINT", "TICK", "PRICE", "PERCENT"]);
export const annotationTypeSchema = z.enum(["ENTRY", "STOP_LOSS", "TARGET", "INVALIDATION", "BREAK_EVEN", "CUSTOM"]);

export const plannedTargetInputSchema = z.object({
  targetOrder: z.coerce.number().int().min(1),
  label: z.string().trim().min(1).max(40),
  targetPrice: z.coerce.number(),
  plannedClosePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  managementInstruction: z.string().trim().max(500).nullable().optional(),
  moveToBreakEven: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const confirmPlanSchema = z.object({
  direction: directionSchema,
  timeframe: z.string().trim().max(20).nullable().optional(),
  entry: z.coerce.number(),
  stopLoss: z.coerce.number(),
  targets: z.array(plannedTargetInputSchema).min(1, "At least one profit target is required."),
});

export type ConfirmPlanInput = z.infer<typeof confirmPlanSchema>;

export const revisePlanSchema = confirmPlanSchema.extend({
  editReason: z.string().trim().min(1, "An edit reason is required to change a locked plan.").max(500),
});

export type RevisePlanInput = z.infer<typeof revisePlanSchema>;

export const annotationUpsertSchema = z.object({
  id: z.string().trim().min(1).optional(),
  type: annotationTypeSchema,
  label: z.string().trim().min(1).max(40),
  confirmedPrice: z.coerce.number().nullable().optional(),
  y: z.coerce.number().min(0).max(1),
  startX: z.coerce.number().min(0).max(1).nullable().optional(),
  endX: z.coerce.number().min(0).max(1).nullable().optional(),
  endY: z.coerce.number().min(0).max(1).nullable().optional(),
  color: z.string().trim().min(1).max(60),
  visible: z.boolean().optional(),
  targetOrder: z.coerce.number().int().min(1).nullable().optional(),
});

export type AnnotationUpsertInput = z.infer<typeof annotationUpsertSchema>;

export const attachScreenshotSchema = z.object({
  mediaAssetId: z.string().trim().min(1),
  width: z.coerce.number().int().positive().nullable().optional(),
  height: z.coerce.number().int().positive().nullable().optional(),
});

export const useExistingScreenshotSchema = z.object({
  mediaAttachmentId: z.string().trim().min(1),
});

// ── Actual partial exits (checkpoint 2 §13) ──────────────────────────────────

export const partialExitSourceSchema = z.enum(["CONFIRMED", "MANUAL", "IMPORTED"]);

export const partialExitUpsertSchema = z.object({
  id: z.string().trim().min(1).optional(),
  accountExecutionId: z.string().trim().min(1).nullable().optional(),
  plannedTargetId: z.string().trim().min(1).nullable().optional(),
  exitOrder: z.coerce.number().int().min(1),
  exitPrice: z.coerce.number(),
  percentClosed: z.coerce.number().min(0).max(100).nullable().optional(),
  quantityClosed: z.coerce.number().min(0).nullable().optional(),
  exitedAt: z.coerce.date(),
  grossPnl: z.coerce.number().nullable().optional(),
  fees: z.coerce.number().nullable().optional(),
  netPnl: z.coerce.number().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  source: partialExitSourceSchema.optional(),
});

export type PartialExitUpsertInput = z.infer<typeof partialExitUpsertSchema>;
