import { z } from "zod";

export const strategyStatusSchema = z.enum(["DRAFT", "TESTING", "LIVE", "ARCHIVED"]);

const strategyName = z.string().trim().min(1, "Strategy name is required.").max(120);

const optionalDescription = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : undefined));

// Free-text market symbols. Normalized to non-empty, de-duplicated tags; the
// UI adds/removes them as chips.
const applicableAssets = z
  .array(z.string().trim().min(1).max(30))
  .max(100, "That's a lot of assets — keep it under 100.")
  .default([])
  .transform((arr) => Array.from(new Set(arr.filter(Boolean))));

/** Create dialog — name required, description optional; the rest is set in Settings. */
export const strategyCreateSchema = z.object({
  name: strategyName,
  description: optionalDescription,
});

/** Full Settings tab payload (autosaved). */
export const strategySettingsSchema = z.object({
  name: strategyName,
  description: optionalDescription,
  applicableAssets,
  status: strategyStatusSchema,
});

export const strategyRenameSchema = z.object({ name: strategyName });

export type StrategyCreateInput = z.infer<typeof strategyCreateSchema>;
export type StrategyCreateFormValues = z.input<typeof strategyCreateSchema>;
export type StrategySettingsInput = z.infer<typeof strategySettingsSchema>;
export type StrategySettingsFormValues = z.input<typeof strategySettingsSchema>;
export type StrategyRenameInput = z.infer<typeof strategyRenameSchema>;
export type StrategyStatusValue = z.infer<typeof strategyStatusSchema>;
