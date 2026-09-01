import { z } from "zod";

export const tagColorSchema = z.enum([
  "GRAY",
  "BLUE",
  "GREEN",
  "AMBER",
  "RED",
  "PURPLE",
  "YELLOW",
  "TEAL",
]);

export const checklistKindSchema = z.enum(["CONFLUENCE", "EXECUTION"]);

/** Which trade direction a CONFLUENCE is eligible for. Invalid values are
 *  rejected by the API. Always BOTH for EXECUTION items. */
export const confluenceDirectionSchema = z.enum(["BULLISH", "BEARISH", "BOTH"]);

export const strategyChecklistItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  color: tagColorSchema.default("GRAY"),
  category: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(2000).nullish(),
  weight: z.coerce.number().int().min(0).max(100).nullish(),
  // Confluence scoring: mandatory gates setup validity; validationCriteria is the
  // objective "is it present?" test. Optional/empty for execution confirmations.
  mandatory: z.boolean().default(false),
  // CONFLUENCE only — filters the confluence to LONG (BULLISH) / SHORT (BEARISH)
  // / both (BOTH) BEFORE scoring. Defaults to BOTH so it's optional for callers.
  directionApplicability: confluenceDirectionSchema.default("BOTH"),
  // Optional organizational link between opposite versions of one condition.
  pairId: z.string().trim().max(60).nullish(),
  validationCriteria: z.string().trim().max(2000).nullish(),
  enabled: z.boolean().default(true),
});

export const strategySessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  color: tagColorSchema.default("GRAY"),
  startMinutes: z.coerce.number().int().min(0).max(1439).nullish(),
  endMinutes: z.coerce.number().int().min(0).max(1439).nullish(),
  enabled: z.boolean().default(true),
});

export const sotReorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

export type TagColorValue = z.infer<typeof tagColorSchema>;
export type StrategyChecklistKindValue = z.infer<typeof checklistKindSchema>;
export type ConfluenceDirectionValue = z.infer<typeof confluenceDirectionSchema>;
export type StrategyChecklistItemInput = z.infer<typeof strategyChecklistItemSchema>;
export type StrategySessionInput = z.infer<typeof strategySessionSchema>;
