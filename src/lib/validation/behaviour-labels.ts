import { z } from "zod";

import { tagColorSchema } from "@/lib/validation/strategy-sot";

export const behaviourLabelPolaritySchema = z.enum(["POSITIVE", "NEGATIVE"]);

export const behaviourLabelCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  polarity: behaviourLabelPolaritySchema,
  color: tagColorSchema.default("GRAY"),
});
export type BehaviourLabelCreateInput = z.infer<typeof behaviourLabelCreateSchema>;

export const behaviourLabelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: tagColorSchema.optional(),
});
export type BehaviourLabelUpdateInput = z.infer<typeof behaviourLabelUpdateSchema>;

/** Replaces the full set of behaviour labels on a trade — simpler and safer
 *  than incremental attach/detach calls for a fast multi-select UI. */
export const setTradeBehaviourLabelsSchema = z.object({
  labelIds: z.array(z.string().trim().min(1)).default([]),
});
export type SetTradeBehaviourLabelsInput = z.infer<typeof setTradeBehaviourLabelsSchema>;
