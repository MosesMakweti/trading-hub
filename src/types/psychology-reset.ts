/**
 * Trading Psychology Reset — UI transport types (plain JSON). The flow
 * content itself is static (domain/psychology-reset) and shared by server
 * and client; only the session state crosses the boundary.
 */
import type { ResetAnswers, ResetAssessment, ResetTrigger } from "@/domain/psychology-reset";

export type PsychologyResetSessionDTO = {
  id: string;
  trigger: ResetTrigger;
  flowVersion: number;
  status: "IN_PROGRESS" | "COMPLETED";
  /** Step index; equal to the number of steps = the summary. */
  currentStep: number;
  answers: ResetAnswers;
  nextAction: string | null;
  /** The trader chose "Finish later" — don't open it automatically. */
  deferred: boolean;
  createdAt: string;
  completedAt: string | null;
  /** What triggered it, for a one-line header (no outcome figures repeated). */
  context: { assetSymbol: string; direction: "LONG" | "SHORT"; dateKey: string } | null;
  /** Server-computed recommendation, including today's limits (which take precedence). */
  assessment: ResetAssessment;
};

export type PsychologyResetStateDTO = {
  enabled: boolean;
  /** Only while enabled: the newest unfinished session. */
  session: PsychologyResetSessionDTO | null;
};
