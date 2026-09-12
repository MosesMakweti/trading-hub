// The resolver that turns a Setup Type scenario's curated, override-aware
// condition list into a flat set the EXISTING weighted confluence scoring
// engine (domain/trades/confluence-score.ts) already knows how to score.
// There is no second scoring engine here — this module only resolves
// "which conditions, at what effective weight/mandatory status" for one
// scenario; scoreConfluences still does all the actual math.

import type { ScorableConfluence } from "@/domain/trades/confluence-score";

export type ConfluenceDirectionValue = "BULLISH" | "BEARISH" | "BOTH";
export type ChecklistKindValue = "CONFLUENCE" | "EXECUTION";
export type SetupScenarioDirectionValue = "BULLISH" | "BEARISH";

/** One scenario condition as read from the DB — the join row plus enough of
 *  its underlying StrategyChecklistItem to resolve an effective value. Plain
 *  data, no Prisma types, so this stays testable without a DB. */
export interface SetupScenarioConditionInput {
  id: string; // StrategySetupScenarioCondition id
  checklistItemId: string;
  checklistItemName: string;
  checklistItemKind: ChecklistKindValue;
  checklistItemColor: string;
  checklistItemWeight: number | null;
  checklistItemMandatory: boolean;
  checklistItemDirectionApplicability: ConfluenceDirectionValue;
  /** null = inherit checklistItemMandatory. */
  mandatoryOverride: boolean | null;
  /** null = inherit checklistItemWeight. */
  weightOverride: number | null;
  sortOrder: number;
}

/** A condition after resolving its scenario override over its base checklist
 *  item — "the effective Bullish Type A checklist" the spec asks for. */
export interface ResolvedSetupCondition {
  id: string;
  checklistItemId: string;
  name: string;
  color: string;
  kind: ChecklistKindValue;
  directionApplicability: ConfluenceDirectionValue;
  weight: number | null;
  mandatory: boolean;
  sortOrder: number;
}

/**
 * Applies each condition's scenario-level override (if any) over its
 * underlying checklist item, in display order. Pure, deterministic, no I/O.
 */
export function resolveScenarioConditions(
  conditions: SetupScenarioConditionInput[],
): ResolvedSetupCondition[] {
  return conditions
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      checklistItemId: c.checklistItemId,
      name: c.checklistItemName,
      color: c.checklistItemColor,
      kind: c.checklistItemKind,
      directionApplicability: c.checklistItemDirectionApplicability,
      weight: c.weightOverride ?? c.checklistItemWeight,
      mandatory: c.mandatoryOverride ?? c.checklistItemMandatory,
      sortOrder: c.sortOrder,
    }));
}

/**
 * Converts resolved conditions into the exact shape the existing weighted
 * confluence scoring engine consumes. This is the hand-off point: Stage 4
 * calls resolveScenarioConditions() then this, and feeds the result straight
 * into scoreConfluences() from domain/trades/confluence-score.ts — no new
 * scoring math anywhere in this module.
 */
export function toScorableConfluences(resolved: ResolvedSetupCondition[]): ScorableConfluence[] {
  return resolved.map((c) => ({
    id: c.checklistItemId,
    name: c.name,
    weight: c.weight,
    mandatory: c.mandatory,
    directionApplicability: c.directionApplicability,
  }));
}

/**
 * Is a checklist item's directionApplicability eligible to be ADDED to a
 * scenario of the given direction? A Bullish scenario accepts BULLISH/BOTH
 * items; a Bearish scenario accepts BEARISH/BOTH. Semantically identical to
 * domain/trades/confluence-score.ts's isConfluenceEligible (which speaks in
 * LONG/SHORT trade-direction terms) — this is the Setup-Type-side name for
 * the same rule, so callers editing a scenario never have to translate
 * BULLISH/BEARISH scenario language into LONG/SHORT trade language.
 */
export function isEligibleForScenario(
  itemDirection: ConfluenceDirectionValue,
  scenarioDirection: SetupScenarioDirectionValue,
): boolean {
  return (
    itemDirection === "BOTH" ||
    (scenarioDirection === "BULLISH" && itemDirection === "BULLISH") ||
    (scenarioDirection === "BEARISH" && itemDirection === "BEARISH")
  );
}
