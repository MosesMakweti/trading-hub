// Trade Idea Validation Shield (Stage 4). Pure, DB-free domain logic: given a
// Setup Type scenario's effective conditions and which ones the trader
// checked, decide the trade's validation state and build the frozen
// historical record. No new scoring math — this reuses the exact same
// direction-aware weighted engine as everything else (scoreConfluences), just
// scoped to a Setup Type's curated condition list instead of a strategy's
// whole checklist. See domain/strategies/setup-type-scoring.ts for how that
// scoped list is resolved from Strategy Lab.

import { scoreConfluences, type ConfluenceDirectionValue } from "@/domain/trades/confluence-score";
import { toScorableConfluences, type ResolvedSetupCondition } from "@/domain/strategies/setup-type-scoring";

export type TradeValidationStateValue = "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN";

export type OverrideReasonValue =
  | "ANTICIPATING_CONFIRMATION"
  | "DISCRETIONARY_OVERRIDE"
  | "FOMO"
  | "MOMENTUM_FAST_MARKET"
  | "NEWS_DRIVEN"
  | "OTHER";

export type ScenarioDirectionValue = "BULLISH" | "BEARISH";

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
  scenario: { id: string; direction: ScenarioDirectionValue };
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
  scenario: { id: string; direction: ScenarioDirectionValue };
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
 * result. `conditions` are already scoped to one BULLISH/BEARISH scenario, so
 * every one of them is eligible for it by construction (isEligibleForScenario
 * is enforced when a condition is added to a scenario in Strategy Lab) — the
 * pseudo trade-direction passed to scoreConfluences (BULLISH -> LONG, BEARISH
 * -> SHORT) exists only to satisfy that engine's eligibility filter, not to
 * represent this trade's own already-known direction a second time.
 */
export function buildSetupValidationSnapshot(
  input: BuildSetupValidationSnapshotInput,
): BuildSetupValidationSnapshotResult {
  const selected = new Set(input.selectedChecklistItemIds);
  const selectedNames = input.conditions
    .filter((c) => selected.has(c.checklistItemId))
    .map((c) => c.name);

  const pseudoDirection = input.scenario.direction === "BULLISH" ? "LONG" : "SHORT";
  const result = scoreConfluences({
    confluences: toScorableConfluences(input.conditions),
    selectedNames,
    direction: pseudoDirection,
  });

  const validationState = resolveValidationState(result.mandatoryRequirementsMet, input.overrideReason != null);
  const overrideReason = validationState === "OVERRIDDEN" ? input.overrideReason : null;
  const overrideNote = validationState === "OVERRIDDEN" ? input.overrideNote : null;

  const snapshot: SetupValidationSnapshot = {
    strategyName: input.strategyName,
    strategyVersion: input.strategyVersion,
    setupType: input.setupType,
    scenario: input.scenario,
    conditions: input.conditions
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
