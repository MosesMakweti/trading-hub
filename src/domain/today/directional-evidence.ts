/**
 * Daily Market Plan — Directional Evidence (Stage 11 §7-13). Pure and
 * framework-free: a lightweight, OPTIONAL bullish-vs-bearish evidence tally
 * that can *suggest* a bias, never determine one. This is evidence, not
 * probability — callers must never render `suggestedBias` as a percentage or
 * statistical claim (§10). A tie or an empty list has no leader; the trader's
 * manual `finalBias` on DailyAssetAnalysis remains authoritative regardless
 * of what this suggests (§11) — disagreement is expected and fine.
 */

export type EvidenceDirection = "BULLISH" | "BEARISH";
export type LeadingDirection = "BULLISH" | "BEARISH" | "BALANCED" | "NONE";
export type SuggestedBias = "LONG" | "SHORT" | null;
export type FinalBiasValue = "LONG" | "SHORT" | "NEUTRAL" | null;
export type BiasAgreement = "ALIGNED" | "CONFLICT" | "NONE";

export interface DirectionalEvidenceItemInput {
  direction: EvidenceDirection;
  /** Active/inactive — an unchecked item doesn't count toward the tally but
   *  isn't deleted (the trader may be noting evidence that no longer holds). */
  checked: boolean;
}

export interface DirectionalEvidenceSummary {
  bullishCount: number;
  bearishCount: number;
  leadingDirection: LeadingDirection;
  /** LONG when bullish leads, SHORT when bearish leads, null when balanced
   *  or there's no evidence — never a percentage or probability claim. */
  suggestedBias: SuggestedBias;
}

export function summarizeDirectionalEvidence(
  items: DirectionalEvidenceItemInput[],
): DirectionalEvidenceSummary {
  const active = items.filter((i) => i.checked);
  const bullishCount = active.filter((i) => i.direction === "BULLISH").length;
  const bearishCount = active.filter((i) => i.direction === "BEARISH").length;

  let leadingDirection: LeadingDirection;
  if (bullishCount === 0 && bearishCount === 0) leadingDirection = "NONE";
  else if (bullishCount === bearishCount) leadingDirection = "BALANCED";
  else leadingDirection = bullishCount > bearishCount ? "BULLISH" : "BEARISH";

  const suggestedBias: SuggestedBias =
    leadingDirection === "BULLISH" ? "LONG" : leadingDirection === "BEARISH" ? "SHORT" : null;

  return { bullishCount, bearishCount, leadingDirection, suggestedBias };
}

/**
 * Purely informational (§11) — never blocks the trader's manual `finalBias`.
 * NONE when there's nothing to compare (no suggestion, no final bias, or the
 * final bias is itself NEUTRAL — NEUTRAL isn't "wrong", it's a legitimate
 * first-class conclusion, not a side to agree/disagree with).
 */
export function compareSuggestedToFinalBias(
  suggestedBias: SuggestedBias,
  finalBias: FinalBiasValue,
): BiasAgreement {
  if (suggestedBias == null || finalBias == null || finalBias === "NEUTRAL") return "NONE";
  return suggestedBias === finalBias ? "ALIGNED" : "CONFLICT";
}
