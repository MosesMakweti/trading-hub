/**
 * Traditorium TradingView Extension — Step 7, §9. A deliberate PORT of the
 * exact formula in `src/domain/prop-firms/risk.ts::computePlannedR` — NOT
 * `scoreSetup`/`scoreStrategyAdherence`/confluence weighting (those stay
 * un-ported per §9/§23 — this is a pure arithmetic ratio, no instrument-spec
 * pip/tick rounding, no weighting, exactly the kind of "trivial and exactly
 * corresponds to the canonical definition" case §9 allows).
 *
 * NEVER submitted to the server as an authoritative value — this exists
 * purely for a non-authoritative UI preview (e.g. "TP1 ≈ 2.0R"). The
 * server (`domain/trade-plan/planned-rr.ts` via `savePlan`) computes and
 * persists the real `rMultiple` per target independently; whatever this
 * function returns is discarded once the server's response comes back.
 *
 * Uses plain `number` arithmetic (the server uses `Decimal.js` for storage
 * precision) — acceptable here because this is a rounded PREVIEW, not a
 * persisted value; float error at preview-display precision is invisible.
 */
export interface PlannedRPreview {
  r: number | null;
  /** Set instead of `r` when the risk distance is zero/inverted for the
   *  given direction — mirrors the server's own gate exactly (never a
   *  fabricated ratio when the risk side is invalid). */
  reason: string | null;
}

export function previewPlannedR(direction: "LONG" | "SHORT", entry: number, stopLoss: number, target: number): PlannedRPreview {
  const riskDistance = direction === "LONG" ? entry - stopLoss : stopLoss - entry;
  const rewardDistance = direction === "LONG" ? target - entry : entry - target;
  if (!(riskDistance > 0)) {
    return { r: null, reason: "Stop loss must be on the risk side of entry to preview R." };
  }
  return { r: rewardDistance / riskDistance, reason: null };
}
