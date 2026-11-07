import { z } from "zod";

import { isValidDateKey } from "@/lib/date";

export const GOAL_DURATION_PRESETS = [7, 14, 21, 30, 60, 90] as const;
export const GOAL_MAX_DAYS = 365;
/** How far ahead a goal may be scheduled to start. */
export const GOAL_MAX_START_AHEAD_DAYS = 30;

const REQUIREMENT_TYPES = [
  "PRE_SESSION_ROUTINE",
  "CLOSE_AND_REFLECT",
  "REVIEW_CLOSED_TRADES",
  "FOLLOW_PLAN",
  "RESPECT_RISK",
  "JOURNAL_ENTRY",
  "CUSTOM_CHECKIN",
] as const;

const CATEGORIES = ["ROUTINE", "EXECUTION", "RISK", "JOURNAL", "MINDSET", "OTHER"] as const;

export const goalRequirementInputSchema = z.object({
  type: z.enum(REQUIREMENT_TYPES),
  label: z.string().trim().max(80, "Keep check-in names under 80 characters.").nullable().optional(),
  mandatory: z.boolean().default(true),
});

const nameSchema = z.string().trim().min(1, "Give your goal a name.").max(80, "Keep the name under 80 characters.");
const descriptionSchema = z.string().trim().max(500, "Keep the description under 500 characters.").nullable().optional();
const targetSchema = z
  .number()
  .int()
  .min(1, "A goal needs at least 1 day.")
  .max(GOAL_MAX_DAYS, `A goal can be at most ${GOAL_MAX_DAYS} days.`);

export const createGoalSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  category: z.enum(CATEGORIES),
  targetDays: targetSchema,
  startDate: z.string().refine(isValidDateKey, "Invalid start date."),
  requirements: z.array(goalRequirementInputSchema).min(1).max(8),
});

export const updateGoalSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema,
  category: z.enum(CATEGORIES).optional(),
  targetDays: targetSchema.optional(),
  requirements: z.array(goalRequirementInputSchema).min(1).max(8).optional(),
});

export const goalCheckInSchema = z.object({
  goalId: z.string().min(1),
  requirementId: z.string().min(1),
  dateKey: z.string().refine(isValidDateKey, "Invalid date."),
  checked: z.boolean(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type GoalRequirementInput = z.infer<typeof goalRequirementInputSchema>;
