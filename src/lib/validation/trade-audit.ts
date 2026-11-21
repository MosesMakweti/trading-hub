import { z } from "zod";

import { isValidDateKey, weekStartKey } from "@/lib/date";
import {
  ANNOTATION_KINDS,
  AUDIT_EXECUTION_ISSUES,
  AUDIT_INVALID_REASONS,
  AUDIT_VERDICTS,
  AUDIT_WEAKNESSES,
  MISS_REASONS,
  NO_TRADE_REASONS,
} from "@/types/trade-audit";

/**
 * Weekly Trade Audit input validation. Every server action parses its input
 * here; nothing authorization-sensitive is accepted from the client — the
 * audit is always resolved server-side from (user, week, scope), never from a
 * client-supplied audit id.
 */

const dateKey = z.string().refine(isValidDateKey, { message: "Invalid date." });
const text = z.string().trim().max(4000).nullable();
const shortText = z.string().trim().max(300).nullable();
const rating = z.number().int().min(1).max(5).nullable();
const price = z.number().finite().min(0).max(1e12).nullable();
const id = z.string().trim().min(1).max(64);

export const auditScopeSchema = z.object({
  weekStart: dateKey.refine((k) => weekStartKey(k) === k, { message: "A weekly audit starts on a Monday." }),
  strategyId: id.nullable().default(null),
  assetSymbols: z.array(z.string().trim().min(1).max(32)).max(30).default([]),
});
export type AuditScopeInput = z.infer<typeof auditScopeSchema>;

export const saveDayAuditSchema = z.object({
  scope: auditScopeSchema,
  dateKey,
  patch: z
    .object({
      noTradeReason: z.enum(NO_TRADE_REASONS).nullable(),
      wentWell: text,
      wentWrong: text,
      couldDoBetter: text,
      mainLesson: text,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." }),
});

export const setDayStatusSchema = z.object({
  scope: auditScopeSchema,
  dateKey,
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
});

export const saveAssessmentSchema = z.object({
  scope: auditScopeSchema,
  tradeId: id,
  patch: z
    .object({
      verdict: z.enum(AUDIT_VERDICTS).nullable(),
      invalidReasons: z.array(z.enum(AUDIT_INVALID_REASONS)).max(AUDIT_INVALID_REASONS.length),
      executionIssues: z.array(z.enum(AUDIT_EXECUTION_ISSUES)).max(AUDIT_EXECUTION_ISSUES.length),
      executionQuality: rating,
      mistake: text,
      weaknesses: z.array(z.enum(AUDIT_WEAKNESSES)).max(AUDIT_WEAKNESSES.length),
      underlyingWeakness: text,
      improvement: text,
    })
    .partial(),
});

const expectedFields = {
  assetSymbol: z.string().trim().min(1).max(32),
  direction: z.enum(["LONG", "SHORT"]),
  intendedEntry: price,
  stopLoss: price,
  target: price,
  intendedRiskPercent: z.number().finite().min(0).max(100).nullable(),
  strategyId: id.nullable(),
  setupName: shortText,
  timeframe: z.string().trim().max(20).nullable(),
  // Required: a miss is justified by the strategy, never by where price went.
  validityReason: z.string().trim().min(1, "Explain why the setup met your criteria.").max(4000),
  criteriaMet: z.array(z.string().trim().min(1).max(160)).max(40),
  missReason: z.enum(MISS_REASONS).nullable(),
  missNote: text,
  weaknesses: z.array(z.enum(AUDIT_WEAKNESSES)).max(AUDIT_WEAKNESSES.length),
  underlyingWeakness: text,
  improvement: text,
  linkedTradeId: id.nullable(),
};

export const createExpectedTradeSchema = z.object({
  scope: auditScopeSchema,
  dateKey,
  clientKey: z.string().trim().min(8).max(64),
  data: z.object(expectedFields).partial().required({ assetSymbol: true, direction: true, validityReason: true }),
});

export const updateExpectedTradeSchema = z.object({
  id,
  patch: z
    .object(expectedFields)
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." }),
});

export const saveAnnotationSchema = z.object({
  scope: auditScopeSchema,
  attachmentId: id,
  markers: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        kind: z.enum(ANNOTATION_KINDS),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        note: z.string().trim().max(300).nullable(),
      }),
    )
    .max(40),
});

export const saveWeeklyAssessmentSchema = z.object({
  scope: auditScopeSchema,
  patch: z
    .object({
      executionSummary: text,
      decisionSummary: text,
      strongestArea: text,
      biggestWeakness: text,
      recurringPatterns: text,
      mainLesson: text,
      nextWeekPriority: text,
      executionQualityRating: rating,
      tradeSelectionRating: rating,
      patienceRating: rating,
      strategyAdherenceRating: rating,
      riskManagementRating: rating,
      tradeManagementRating: rating,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." }),
});

export const ensureOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ASSESSMENT"), scope: auditScopeSchema, tradeId: id }),
  z.object({ kind: z.literal("DAY"), scope: auditScopeSchema, dateKey }),
]);

export const commitmentFromAuditSchema = z.object({
  scope: auditScopeSchema,
  category: z.enum(["EXECUTION", "BEHAVIOR", "PROCESS", "OPPORTUNITY", "STRATEGY", "RISK"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
});

export const resolveCarriedCommitmentSchema = z.object({
  scope: auditScopeSchema,
  commitmentId: id,
  decision: z.enum(["CONTINUE", "DONE", "DROP"]),
});

export const setAuditCommitmentStatusSchema = z.object({
  scope: auditScopeSchema,
  commitmentId: id,
  status: z.enum(["ACTIVE", "COMPLETED", "RETIRED"]),
});
