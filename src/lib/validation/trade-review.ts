import { z } from "zod";

export const tradeReviewLifecycleStatusSchema = z.enum([
  "FULLY_CLOSED",
  "PARTIALLY_CLOSED",
  "STILL_HOLDING",
  "CANCELLED_NEVER_TRIGGERED",
]);
export type TradeReviewLifecycleStatusValue = z.infer<typeof tradeReviewLifecycleStatusSchema>;

export const setReviewLifecycleStatusSchema = z
  .object({
    status: tradeReviewLifecycleStatusSchema,
    // Only meaningful (and only ever persisted) when status is
    // CANCELLED_NEVER_TRIGGERED — see trade-review.service.ts.
    cancellationReason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type SetReviewLifecycleStatusInput = z.infer<typeof setReviewLifecycleStatusSchema>;
