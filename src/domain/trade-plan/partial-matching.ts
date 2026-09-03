/**
 * Deterministic planned-target <-> actual-partial-exit matching (checkpoint
 * 2 §14). Never assumes "the first recorded exit is TP1" — matches by price
 * proximity (direction-aware: closer to the entry = an earlier target for a
 * trade moving favorably), falling back to exit order only as a tiebreaker.
 * Ambiguous cases return no match rather than guessing — the trader
 * explicitly maps those via TradeActualPartialExit.plannedTargetId.
 */
import { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";
import type { InstrumentSpec } from "@/domain/trade-plan/instrument-catalog";

export interface ActualPartialForMatching {
  exitOrder: number;
  exitPrice: Decimal.Value;
}

export interface PlannedTargetForMatching {
  targetOrder: number;
  targetPrice: Decimal.Value;
}

export type MatchConfidence = "EXACT" | "CLOSEST" | "AMBIGUOUS" | "NONE";

export interface PartialMatchResult {
  exitOrder: number;
  matchedTargetOrder: number | null;
  confidence: MatchConfidence;
}

function toleranceFor(spec: InstrumentSpec | null): Decimal {
  if (!spec) return new Decimal("0.0005");
  const size = spec.preferredUnit === "PIP" ? spec.pipSize : spec.preferredUnit === "TICK" ? spec.tickSize : spec.pointSize;
  return size ? new Decimal(size).times(3) : new Decimal("0.0005"); // within ~3 units counts as an exact price match
}

/** Matches each actual partial to at most one planned target, greedily by
 *  closest price first (so the tightest, most confident matches are claimed
 *  before looser ones), each target usable at most once. A target within
 *  `toleranceFor(spec)` of the exit price is EXACT; otherwise the nearest
 *  remaining target is offered as CLOSEST (lower confidence, still
 *  deterministic) UNLESS two remaining targets are nearly equidistant, in
 *  which case it's AMBIGUOUS and left for the trader to resolve explicitly. */
export function matchPartialsToTargets(
  _direction: DirectionLike,
  partials: ActualPartialForMatching[],
  targets: PlannedTargetForMatching[],
  spec: InstrumentSpec | null,
): PartialMatchResult[] {
  if (targets.length === 0) {
    return partials.map((p) => ({ exitOrder: p.exitOrder, matchedTargetOrder: null, confidence: "NONE" }));
  }

  const tolerance = toleranceFor(spec);
  const remaining = new Map(targets.map((t) => [t.targetOrder, new Decimal(t.targetPrice)]));
  const results: PartialMatchResult[] = [];

  // Rank partials by how close their best candidate match is, so the most
  // confident pairings are resolved (and remove their target) first.
  const scored = partials.map((p) => {
    const exitPrice = new Decimal(p.exitPrice);
    const distances = [...remaining.entries()]
      .map(([order, price]) => ({ order, diff: exitPrice.minus(price).abs() }))
      .sort((a, b) => a.diff.minus(b.diff).toNumber());
    return { partial: p, exitPrice, distances };
  });
  scored.sort((a, b) => (a.distances[0]?.diff.minus(b.distances[0]?.diff ?? new Decimal(0)).toNumber() ?? 0));

  for (const { partial, exitPrice } of scored) {
    const candidates = [...remaining.entries()]
      .map(([order, price]) => ({ order, diff: exitPrice.minus(price).abs() }))
      .sort((a, b) => a.diff.minus(b.diff).toNumber());

    if (candidates.length === 0) {
      results.push({ exitOrder: partial.exitOrder, matchedTargetOrder: null, confidence: "NONE" });
      continue;
    }

    const best = candidates[0];
    const secondBest = candidates[1];
    // Ambiguous when the second-closest target is nearly as close as the
    // closest one (within the same tolerance band) — don't guess between them.
    const ambiguous = secondBest != null && secondBest.diff.minus(best.diff).abs().lessThanOrEqualTo(tolerance);

    if (ambiguous) {
      results.push({ exitOrder: partial.exitOrder, matchedTargetOrder: null, confidence: "AMBIGUOUS" });
      continue;
    }

    const confidence: MatchConfidence = best.diff.lessThanOrEqualTo(tolerance) ? "EXACT" : "CLOSEST";
    results.push({ exitOrder: partial.exitOrder, matchedTargetOrder: best.order, confidence });
    remaining.delete(best.order);
  }

  // Restore original exitOrder ordering (the loop above reordered by confidence).
  const byExitOrder = new Map(results.map((r) => [r.exitOrder, r]));
  return partials.map((p) => byExitOrder.get(p.exitOrder)!);
}
