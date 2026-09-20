import { z } from "zod";

import { tradeSchema, workspaceNote } from "@/lib/validation/trades";
import { confirmPlanSchema } from "@/lib/validation/trade-plan";

/**
 * TradingView Extension — Step 3 (docs/extension-api.md). The composed
 * request contract for POST /api/v1/trades. This is deliberately NOT a new
 * trade model: `trade` reuses `tradeSchema` VERBATIM (the exact input
 * `trades.service.ts::createTrade` already accepts from the web app's
 * Server Action) and `plan` reuses `confirmPlanSchema` VERBATIM (the exact
 * input `trade-plan.service.ts::savePlan` already accepts) minus its
 * `direction` field, which this endpoint derives from `trade.direction`
 * instead of asking the caller to repeat it and risk the two disagreeing.
 * The route composes these existing schemas; it does not define any new
 * validation rule of its own.
 */

const isoDateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateKey must be YYYY-MM-DD.");

export const apiPlanSchema = confirmPlanSchema.omit({ direction: true });

export const apiTradeNotesSchema = z.object({
  marketContext: workspaceNote.optional(),
  areasOfInterest: workspaceNote.optional(),
  reasonForTrade: workspaceNote.optional(),
});

export const apiCreateTradeSchema = z.object({
  /** Defaults to today (server-evaluated) when omitted. */
  dateKey: isoDateKey.optional(),
  /** The Trade Idea itself — verbatim `tradeSchema` (see module doc comment). */
  trade: tradeSchema,
  /** Optional multi-target plan — verbatim `confirmPlanSchema` minus `direction`. */
  plan: apiPlanSchema.optional(),
  /** Optional narrative fields — the same subset `tradeWorkspaceSectionSchema`
   *  already exposes for this purpose (never actualEntry/actualExit/etc. —
   *  those belong to trade EXECUTION, out of scope for idea creation). */
  notes: apiTradeNotesSchema.optional(),
  /** An already-uploaded MediaAsset this user owns (see docs/extension-api.md's
   *  "Screenshot Handling" section for the intended future capture flow). */
  mediaAssetId: z.string().min(1).optional(),
});

export type ApiCreateTradeInput = z.infer<typeof apiCreateTradeSchema>;
