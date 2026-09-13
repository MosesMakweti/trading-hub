import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import { AUTOMATIC_EVIDENCE_RULE_KEYS } from "@/domain/improvements/commitment-adherence";

/**
 * Weekly review reflection patch (P10). Partial — each rich-text section
 * autosaves on its own. Values are Tiptap JSON.
 */
export const weeklyReviewSchema = z
  .object({
    wentWell: z.unknown(),
    toImprove: z.unknown(),
    focusNextWeek: z.unknown(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type WeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;

// ── Improvement Commitments (Stage 16 §6-14) ────────────────────────────────

const commitmentCategorySchema = z.enum(["EXECUTION", "BEHAVIOR", "PROCESS", "OPPORTUNITY", "STRATEGY", "RISK"]);
const commitmentPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
const commitmentStatusSchema = z.enum(["ACTIVE", "COMPLETED", "RETIRED"]);

/** Stage 19.1 §24 — an optional opt-in to automatic evidence tracking on an
 *  otherwise manual commitment, restricted to the fixed, deterministic rule
 *  set — never arbitrary trader-entered text. */
const automaticRuleKeySchema = z.enum(AUTOMATIC_EVIDENCE_RULE_KEYS);

/** §8 — kept fast/minimal by design: title, short description, category, priority. */
export const createManualCommitmentSchema = z.object({
  category: commitmentCategorySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  priority: commitmentPrioritySchema.default("MEDIUM"),
  automaticRuleKey: automaticRuleKeySchema.nullable().optional(),
});

/** §9-10 — the trader may edit a suggestion's text/category/priority before
 *  accepting it; the ruleKey/evidence are frozen as submitted (matching
 *  whatever domain/replay-improvements produced). */
export const acceptSuggestedCommitmentSchema = z.object({
  category: commitmentCategorySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  priority: commitmentPrioritySchema.default("MEDIUM"),
  ruleKey: z.string().trim().min(1).max(80),
  evidence: z.array(z.string().trim().max(300)).max(20),
});

export const updateCommitmentSchema = z
  .object({
    category: commitmentCategorySchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).nullable(),
    priority: commitmentPrioritySchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const setCommitmentStatusSchema = z.object({ status: commitmentStatusSchema });

const commitmentDailyStatusSchema = z.enum(["ACKNOWLEDGED", "FOLLOWED", "BREACHED"]);

/** §19 — the breach note is optional and short by design: a quick "why,"
 *  not a journal entry. */
export const setCommitmentDailyStateSchema = z.object({
  dateKey: z.string().refine(isValidDateKey, { message: "Invalid date." }),
  status: commitmentDailyStatusSchema,
  note: z.string().trim().max(280).nullable().optional(),
});

// ── Cross-period continuity (Stage 19 §4) ───────────────────────────────────

export const continueCommitmentSchema = z.object({
  previousCommitmentId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const refineCommitmentSchema = z.object({
  previousCommitmentId: z.string().min(1),
  sessionId: z.string().min(1),
  category: commitmentCategorySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  priority: commitmentPrioritySchema.default("MEDIUM"),
});
