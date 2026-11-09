import { z } from "zod";

import { scenarioContextSchema, scenarioExecutionPlanSchema } from "@/domain/strategies/scenario-playbook";

export const setupScenarioDirectionSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);

export const setupTypeCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  description: z.string().trim().max(500).nullish(),
});

// Rename + describe — both optional so either can be autosaved independently.
export const setupTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80),
    description: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const setupScenarioUpdateSchema = z.object({
  description: z.string().trim().max(500).nullable(),
});

export const setupScenarioTypeSchema = z.enum(["CONTINUATION", "REVERSAL", "BREAKOUT", "CUSTOM"]);
const scenarioName = z.string().trim().min(1, "Give the scenario a name.").max(80);
const tagList = z.array(z.string().trim().min(1).max(40)).max(20);

export const setupScenarioCreateSchema = z.object({
  name: scenarioName,
  direction: setupScenarioDirectionSchema,
  scenarioType: setupScenarioTypeSchema.nullish(),
});

// Every field optional so the editor can autosave one field at a time.
export const setupScenarioDetailsSchema = z
  .object({
    name: scenarioName,
    direction: setupScenarioDirectionSchema,
    scenarioType: setupScenarioTypeSchema.nullable(),
    customType: z.string().trim().max(60).nullable(),
    instruments: tagList,
    timeframes: tagList,
    context: scenarioContextSchema.nullable(),
    executionPlan: scenarioExecutionPlanSchema.nullable(),
    description: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const setupScenarioReorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

export const setupScenarioConditionAddSchema = z.object({
  checklistItemId: z.string().min(1),
  // Tri-state: omit to inherit, or set explicitly. null clears back to inherit.
  mandatoryOverride: z.boolean().nullish(),
  weightOverride: z.coerce.number().int().min(0).max(100).nullish(),
});

// Partial override edit — undefined leaves the field untouched, null clears it
// back to "inherit from the underlying checklist item".
export const setupScenarioConditionUpdateSchema = z
  .object({
    mandatoryOverride: z.boolean().nullable(),
    weightOverride: z.coerce.number().int().min(0).max(100).nullable(),
    note: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const setupTypeReorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });
export const setupScenarioConditionReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export type SetupScenarioDirectionValue = z.infer<typeof setupScenarioDirectionSchema>;
export type SetupTypeCreateInput = z.infer<typeof setupTypeCreateSchema>;
export type SetupTypeUpdateInput = z.infer<typeof setupTypeUpdateSchema>;
export type SetupScenarioUpdateInput = z.infer<typeof setupScenarioUpdateSchema>;
export type SetupScenarioCreateInput = z.infer<typeof setupScenarioCreateSchema>;
export type SetupScenarioDetailsInput = z.infer<typeof setupScenarioDetailsSchema>;
export type SetupScenarioConditionAddInput = z.infer<typeof setupScenarioConditionAddSchema>;
export type SetupScenarioConditionUpdateInput = z.infer<typeof setupScenarioConditionUpdateSchema>;
