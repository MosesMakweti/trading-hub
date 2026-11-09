// Trade Idea Validation Shield (Stage 4). Pure, DB-free domain logic: given a
// Setup Type scenario's effective conditions and which ones the trader
// checked, decide the trade's validation state and build the frozen
// historical record. No new scoring math — this reuses the exact same
// direction-aware weighted engine as everything else (scoreConfluences), just
// scoped to a Setup Type's curated condition list instead of a strategy's
// whole checklist. See domain/strategies/setup-type-scoring.ts for how that
// scoped list is resolved from Strategy Lab.

import { isConfluenceEligible, scoreConfluences, type ConfluenceDirectionValue } from "@/domain/trades/confluence-score";
import { toScorableConfluences, type ResolvedSetupCondition } from "@/domain/strategies/setup-type-scoring";

export type TradeValidationStateValue = "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN";

export type OverrideReasonValue =
  | "ANTICIPATING_CONFIRMATION"
  | "DISCRETIONARY_OVERRIDE"
  | "FOMO"
  | "MOMENTUM_FAST_MARKET"
  | "NEWS_DRIVEN"
  | "OTHER";

export type ScenarioDirectionValue = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface SetupValidationSnapshotCondition {
  checklistItemId: string;
  name: string;
  mandatory: boolean;
  weight: number | null;
  directionApplicability: ConfluenceDirectionValue;
  checked: boolean;
  sortOrder: number;
}

/** The frozen, self-contained historical record — see Trade.setupValidationSnapshot. */
export interface SetupValidationSnapshot {
  strategyName: string | null;
  strategyVersion: number | null;
  setupType: { id: string; name: string };
  /** `name` is absent on snapshots frozen before named scenarios existed. */
  scenario: { id: string; direction: ScenarioDirectionValue; name?: string };
  conditions: SetupValidationSnapshotCondition[];
  score: number | null;
  totalEligibleWeight: number;
  selectedEligibleWeight: number;
  mandatoryGateMet: boolean;
  missingMandatoryConditionNames: string[];
  validationState: TradeValidationStateValue;
  overrideReason: OverrideReasonValue | null;
  overrideNote: string | null;
  evaluatedAt: string; // ISO
}

/**
 * A trade is VALIDATED only when every eligible mandatory condition is
 * checked. Otherwise it's NOT_VALIDATED, unless the trader explicitly
 * requested an override (Take Anyway), in which case it's OVERRIDDEN.
 * Optional conditions never affect this gate — they only feed the score.
 */
export function resolveValidationState(
  mandatoryGateMet: boolean,
  overrideRequested: boolean,
): TradeValidationStateValue {
  if (mandatoryGateMet) return "VALIDATED";
  return overrideRequested ? "OVERRIDDEN" : "NOT_VALIDATED";
}

export interface BuildSetupValidationSnapshotInput {
  strategyName: string | null;
  strategyVersion: number | null;
  setupType: { id: string; name: string };
  scenario: { id: string; direction: ScenarioDirectionValue; name?: string };
  /** The trade's own direction. Required to score a NEUTRAL scenario (whose
   *  conditions may be bull- or bear-only); for a Bullish/Bearish scenario it
   *  is implied, so older callers may omit it. */
  tradeDirection?: "LONG" | "SHORT";
  conditions: ResolvedSetupCondition[];
  /** checklistItemIds the trader checked — matched by id, not name, so a
   *  renamed checklist item can't silently lose its checked state. */
  selectedChecklistItemIds: string[];
  /** Non-null = the trader requested "Take Anyway". Only persisted on the
   *  returned result when the gate actually failed — see resolveValidationState. */
  overrideReason: OverrideReasonValue | null;
  overrideNote: string | null;
  now?: Date;
}

export interface BuildSetupValidationSnapshotResult {
  snapshot: SetupValidationSnapshot;
  validationState: TradeValidationStateValue;
  overrideReason: OverrideReasonValue | null;
  overrideNote: string | null;
}

/**
 * The Stage 4 hand-off point: resolveScenarioConditions() (Stage 3) resolved
 * WHICH conditions apply and at what effective weight/mandatory status; this
 * scores what the trader actually checked against them and freezes the
 * result. For a BULLISH/BEARISH scenario every condition is eligible by
 * construction (isEligibleForScenario is enforced when a condition is added in
 * Strategy Lab) and the direction passed to scoreConfluences is the one the
 * scenario implies. A NEUTRAL scenario is two-sided, so its conditions are
 * filtered to the trade's own direction (`tradeDirection`) before scoring.
 */
export function buildSetupValidationSnapshot(
  input: BuildSetupValidationSnapshotInput,
): BuildSetupValidationSnapshotResult {
  const selected = new Set(input.selectedChecklistItemIds);
  const direction: "LONG" | "SHORT" =
    input.tradeDirection ?? (input.scenario.direction === "BEARISH" ? "SHORT" : "LONG");
  // A NEUTRAL scenario may hold bull-only and bear-only conditions: only the
  // ones that apply to THIS trade's direction are part of its checklist.
  const conditions =
    input.scenario.direction === "NEUTRAL"
      ? input.conditions.filter((c) => isConfluenceEligible(c.directionApplicability, direction))
      : input.conditions;
  const selectedNames = conditions.filter((c) => selected.has(c.checklistItemId)).map((c) => c.name);

  const result = scoreConfluences({
    confluences: toScorableConfluences(conditions),
    selectedNames,
    direction,
  });

  const validationState = resolveValidationState(result.mandatoryRequirementsMet, input.overrideReason != null);
  const overrideReason = validationState === "OVERRIDDEN" ? input.overrideReason : null;
  const overrideNote = validationState === "OVERRIDDEN" ? input.overrideNote : null;

  const snapshot: SetupValidationSnapshot = {
    strategyName: input.strategyName,
    strategyVersion: input.strategyVersion,
    setupType: input.setupType,
    scenario: input.scenario,
    conditions: conditions
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        checklistItemId: c.checklistItemId,
        name: c.name,
        mandatory: c.mandatory,
        weight: c.weight,
        directionApplicability: c.directionApplicability,
        checked: selected.has(c.checklistItemId),
        sortOrder: c.sortOrder,
      })),
    score: result.score,
    totalEligibleWeight: result.totalEligibleWeight,
    selectedEligibleWeight: result.selectedEligibleWeight,
    mandatoryGateMet: result.mandatoryRequirementsMet,
    missingMandatoryConditionNames: result.missingMandatoryConfluenceNames,
    validationState,
    overrideReason,
    overrideNote,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
  };

  return { snapshot, validationState, overrideReason, overrideNote };
}
