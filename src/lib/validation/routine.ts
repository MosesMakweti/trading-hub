import { z } from "zod";

export const routineItemTypeSchema = z.enum(["CHECKBOX", "SHORT_TEXT", "LONG_TEXT"]);

export const routineSectionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(80),
});

export const routineItemSchema = z.object({
  sectionId: z.string().min(1),
  label: z.string().trim().min(1, "Label is required.").max(160),
  type: routineItemTypeSchema,
});

export const routineItemUpdateSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(160),
  type: routineItemTypeSchema,
});

export const routineReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export type RoutineSectionInput = z.infer<typeof routineSectionSchema>;
export type RoutineItemInput = z.infer<typeof routineItemSchema>;
export type RoutineItemUpdateInput = z.infer<typeof routineItemUpdateSchema>;
