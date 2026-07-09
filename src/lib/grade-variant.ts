import type { PsychologyGrade } from "@/domain/psychology/scoring";

export const GRADE_VARIANT: Record<PsychologyGrade, "success" | "warning" | "danger"> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "warning",
  F: "danger",
};
