import { z } from "zod";

import { PSYCHOLOGY_QUESTIONS } from "@/domain/psychology/questions";

const answerValueSchema = z.union([z.string(), z.number()]);

/**
 * Lenient shape: a map of answer key -> value, where each PRESENT answer must
 * be valid for its question, but the set may be partial or empty. Used when a
 * trade is logged as an idea (the post-trade questionnaire is filled later, in
 * the Trade Review tab) and by the workspace section-patch action. Completeness
 * is checked at scoring time (domain/psychology/scoring.ts), not here.
 */
export const partialPsychologyAnswersSchema = z
  .record(z.string(), answerValueSchema)
  .superRefine((answers, ctx) => {
    for (const question of PSYCHOLOGY_QUESTIONS) {
      const value = answers[question.key];
      if (value === undefined) continue;
      if (question.type === "choice") {
        if (!question.options.some((o) => o.value === value)) {
          ctx.addIssue({ code: "custom", message: `Invalid answer for "${question.prompt}"`, path: [question.key] });
        }
      } else if (typeof value !== "number" || value < question.min || value > question.max) {
        ctx.addIssue({ code: "custom", message: `Invalid answer for "${question.prompt}"`, path: [question.key] });
      }
    }
  });

// The strict variant — every question must have a valid answer. Kept for
// callers that genuinely require a completed questionnaire.
export const psychologyAnswersSchema = z
  .record(z.string(), answerValueSchema)
  .superRefine((answers, ctx) => {
    for (const question of PSYCHOLOGY_QUESTIONS) {
      const value = answers[question.key];
      if (value === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Answer required: "${question.prompt}"`,
          path: [question.key],
        });
        continue;
      }
      if (question.type === "choice") {
        if (!question.options.some((o) => o.value === value)) {
          ctx.addIssue({
            code: "custom",
            message: `Invalid answer for "${question.prompt}"`,
            path: [question.key],
          });
        }
      } else if (typeof value !== "number" || value < question.min || value > question.max) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid answer for "${question.prompt}"`,
          path: [question.key],
        });
      }
    }
  });

export type PsychologyAnswers = z.infer<typeof psychologyAnswersSchema>;
