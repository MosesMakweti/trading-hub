// Today V3 (Phase 2) — Quick Trade Idea inheritance + compatibility values.
// Pure. SYSTEM SUGGESTS (prefill from the day/asset plan) → TRADER CONFIRMS
// (the create action). Nothing here is ever a silent decision:
//  - direction is prefilled ONLY from a LONG/SHORT Final Bias; NEUTRAL or no
//    bias leaves it unselected (never a default Long).
//  - session is prefilled only when the existing resolver is unambiguous.

import { resolveDefaultSession, type SessionWindow } from "@/domain/schedule/session-countdown";

export interface AssetPlanContext {
  assetSymbol: string;
  activeStrategyId: string | null;
  finalBias: "LONG" | "SHORT" | "NEUTRAL" | null;
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
}

export interface IdeaDefaults {
  assetSymbol: string;
  strategyId: string | null;
  direction: "LONG" | "SHORT" | null;
  directionFromFinalBias: boolean;
  session: string | null;
}

export function ideaDefaults(
  asset: AssetPlanContext | null,
  day: { activeSessions: string[]; sessionWindows: SessionWindow[]; nowMinutes: number | null },
): IdeaDefaults {
  const direction = asset?.finalBias === "LONG" || asset?.finalBias === "SHORT" ? asset.finalBias : null;
  return {
    assetSymbol: asset?.assetSymbol ?? "",
    strategyId: asset?.activeStrategyId ?? null,
    direction,
    directionFromFinalBias: direction != null,
    session: resolveDefaultSession(day.activeSessions, day.sessionWindows, day.nowMinutes),
  };
}

/**
 * Values the existing schema/API require that V3 does NOT ask for. They are
 * compatibility values, never presented as trader decisions:
 *  - higherTimeframeBias: today's asset HTF read when it's directional,
 *    otherwise the direction's own side (Trade.higherTimeframeBias is a
 *    non-null BULLISH/BEARISH column). Analytics use dailyBiasSnapshot, not
 *    this column (display/export only).
 *  - biasConfidencePercent: the schema's long-standing neutral 50 (non-null
 *    column; display/export only). V3 never shows it as a confidence.
 *  - executionMinutes: PROVISIONAL — the clock time the idea was created.
 *    Replaced by the real Entry Time when the first actual entry is
 *    recorded (Decision 4). Never shown as an execution time.
 */
export function compatibilityFields(input: {
  direction: "LONG" | "SHORT";
  assetHtfBias: AssetPlanContext["htfBias"];
  nowMinutes: number;
}): { higherTimeframeBias: "BULLISH" | "BEARISH"; biasConfidencePercent: number; executionMinutes: number } {
  const higherTimeframeBias =
    input.assetHtfBias === "BULLISH" || input.assetHtfBias === "BEARISH"
      ? input.assetHtfBias
      : input.direction === "LONG"
        ? "BULLISH"
        : "BEARISH";
  return {
    higherTimeframeBias,
    biasConfidencePercent: 50,
    executionMinutes: clampMinutes(input.nowMinutes),
  };
}

export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1439, Math.max(0, Math.round(n)));
}

/** Strategy partial take-profits → suggested plan target rows (form defaults
 *  only: prices blank, nothing stored until "Confirm plan"). */
export function suggestedPlanTargets(
  partials: { trigger: string | null; percentToClose: number | null; reason: string | null }[],
): { label: string; plannedClosePercent: number | null; managementInstruction: string | null }[] {
  return partials.map((p, i) => ({
    label: `TP${i + 1}`,
    plannedClosePercent: p.percentToClose,
    managementInstruction: [p.trigger, p.reason].filter((x): x is string => !!x && x.trim() !== "").join(" — ") || null,
  }));
}
