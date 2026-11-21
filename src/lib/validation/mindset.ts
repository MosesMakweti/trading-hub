import { z } from "zod";

import {
  BREATHING_PATTERNS,
  MAX_MANTRA_SECONDS,
  MAX_SESSION_SECONDS,
  MIN_MANTRA_SECONDS,
  MIN_SESSION_SECONDS,
  SOUNDS,
} from "@/domain/mindset/options";

/** Mindset input validation — every server action parses its input here. */

const id = z.string().trim().min(1).max(64);
const text = z.string().trim().min(1, "Write the mantra first.").max(280);
const category = z.string().trim().min(1, "Give it a category.").max(40);
const soundId = z.enum(Object.keys(SOUNDS) as [keyof typeof SOUNDS, ...(keyof typeof SOUNDS)[]]);
const patternId = z.enum(Object.keys(BREATHING_PATTERNS) as [keyof typeof BREATHING_PATTERNS, ...(keyof typeof BREATHING_PATTERNS)[]]);

export const createMantraSchema = z.object({ text, category });

export const updateMantraSchema = z.object({
  id,
  patch: z
    .object({ text, category, enabled: z.boolean() })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." }),
});

export const renameCategorySchema = z.object({ from: category, to: category });

export const preferencesSchema = z
  .object({
    environment: z.enum(["NATURE", "FOCUS"]),
    durationSeconds: z.number().int().min(MIN_SESSION_SECONDS).max(MAX_SESSION_SECONDS),
    secondsPerMantra: z.number().int().min(MIN_MANTRA_SECONDS).max(MAX_MANTRA_SECONDS),
    order: z.enum(["SEQUENTIAL", "RANDOM"]),
    repeat: z.boolean(),
    selectedCategories: z.array(category).max(50),
    selectedMantraIds: z.array(id).max(500),
    audioEnabled: z.boolean(),
    sound: soundId,
    volume: z.number().int().min(0).max(100),
    breathingEnabled: z.boolean(),
    breathingPattern: patternId,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to save." });

export const startSessionSchema = z.object({
  plannedSeconds: z.number().int().min(MIN_SESSION_SECONDS).max(MAX_SESSION_SECONDS),
  environment: z.enum(["NATURE", "FOCUS"]),
  sound: soundId.nullable(),
  categories: z.array(category).max(50),
  mantraCount: z.number().int().min(0).max(1000),
  recommendationKey: z.string().trim().max(120).nullable(),
});

export const endSessionSchema = z.object({
  id,
  status: z.enum(["COMPLETED", "INTERRUPTED"]),
  activeSeconds: z.number().min(0).max(MAX_SESSION_SECONDS * 2),
});

export const dismissRecommendationSchema = z.object({ key: z.string().trim().min(1).max(120) });
