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

export const strategyChecklistItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  color: tagColorSchema.default("GRAY"),
  category: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(2000).nullish(),
  weight: z.coerce.number().int().min(0).max(100).nullish(),
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
export type StrategyChecklistItemInput = z.infer<typeof strategyChecklistItemSchema>;
export type StrategySessionInput = z.infer<typeof strategySessionSchema>;
