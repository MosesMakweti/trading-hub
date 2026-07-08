import { z } from "zod";

import { PSYCHOLOGY_QUESTIONS } from "@/domain/psychology/questions";

const answerValueSchema = z.union([z.string(), z.number()]);

// The questionnaire is mandatory: every question in PSYCHOLOGY_QUESTIONS
// must have a valid answer, so a trade literally cannot be saved without it.
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
