import { PSYCHOLOGY_QUESTIONS, type PsychologyPoints, type PsychologyQuestion } from "./questions";

export interface PsychologyAnswer {
  key: string;
  value: string | number;
}

export type PsychologyGrade = "A" | "B" | "C" | "D" | "F";

export interface PsychologyScoreResult {
  rawScore: number;
  percent: number;
  grade: PsychologyGrade;
}

export function pointsForAnswer(question: PsychologyQuestion, value: string | number): PsychologyPoints {
  if (question.type === "choice") {
    const option = question.options.find((o) => o.value === value);
    if (!option) {
      throw new Error(`Invalid answer "${String(value)}" for question "${question.key}".`);
    }
    return option.points;
  }

  if (typeof value !== "number" || value < question.min || value > question.max) {
    throw new Error(`Invalid answer "${String(value)}" for question "${question.key}".`);
  }
  return question.pointsForValue(value);
}

/** Sums all 8 questions' points. Range: -8 (min) to +8 (max). */
export function computeRawScore(answers: PsychologyAnswer[]): number {
  const byKey = new Map(answers.map((a) => [a.key, a.value]));
  return PSYCHOLOGY_QUESTIONS.reduce((sum, question) => {
    const value = byKey.get(question.key);
    if (value === undefined) {
      throw new Error(`Missing answer for question "${question.key}".`);
    }
    return sum + pointsForAnswer(question, value);
  }, 0);
}

export function computePsychologyPercent(rawScore: number): number {
  return ((rawScore + 8) / 16) * 100;
}

export function gradeFromPercent(percent: number): PsychologyGrade {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

export function scorePsychology(answers: PsychologyAnswer[]): PsychologyScoreResult {
  const rawScore = computeRawScore(answers);
  const percent = computePsychologyPercent(rawScore);
  const grade = gradeFromPercent(percent);
  return { rawScore, percent, grade };
}
