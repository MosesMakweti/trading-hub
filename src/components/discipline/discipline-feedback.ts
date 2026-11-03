import { toast } from "sonner";

import type { DisciplineFeedbackDTO, TrackKey } from "@/types/discipline";

/**
 * Discipline Streaks — shared presentation vocabulary + the one quiet toast
 * shown after an action that can move a streak. Pure formatting: every
 * number comes from the server's feedback DTO.
 */

export const TRACK_META: Record<TrackKey, { emoji: string; label: string; unit: string; totalLabel: string }> = {
  routine: { emoji: "🔥", label: "Daily routine", unit: "day", totalLabel: "routine days" },
  review: { emoji: "📝", label: "Trade reviews", unit: "day", totalLabel: "trades reviewed" },
  adherence: { emoji: "🎯", label: "Plan adherence", unit: "trading day", totalLabel: "perfectly followed trades" },
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Turns server feedback into at most ONE toast (no notification spam). A
 * review that earned nothing new stays as the caller's own plain toast.
 */
export function showDisciplineFeedback(fb: DisciplineFeedbackDTO | null, fallback: string): void {
  if (!fb) {
    toast.success(fallback);
    return;
  }
  const extras: string[] = [];
  for (const a of fb.newAchievements) extras.push(`🏆 Achievement unlocked: ${a.title}`);

  if (fb.kind === "REVIEW" && fb.review) {
    if (!fb.review.counted) {
      toast.success(fallback);
      return;
    }
    const lines = [`Review streak ${plural(fb.review.streak, "day")}`];
    if (fb.adherence?.perfect) lines.push(`🎯 Plan followed perfectly · ${fb.adherence.totalPerfect} total`);
    const milestone = fb.review.milestoneReached ?? fb.adherence?.milestoneReached ?? null;
    if (milestone) lines.push(`Milestone reached: ${milestone} days`);
    toast.success(`📝 Review complete · ${plural(fb.review.totalReviewed, "trade")} reviewed`, {
      description: [...lines, ...extras].join(" · "),
    });
    return;
  }

  if (fb.kind === "ROUTINE" && fb.routine) {
    if (fb.routine.complete) {
      const title = fb.routine.milestoneReached
        ? `🔥 ${fb.routine.milestoneReached}-day routine streak — milestone reached`
        : `🔥 Full routine complete · ${plural(fb.routine.streak, "day")} streak`;
      toast.success(title, { description: [fallback, ...extras].join(" · ") });
      return;
    }
    const why = !fb.routine.preSession
      ? "the pre-session routine wasn't completed today"
      : "no daily reflection was written";
    toast.success(fallback, { description: `Not counted as a full routine day — ${why}.` });
  }
}
