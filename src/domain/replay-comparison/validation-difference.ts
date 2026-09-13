/**
 * Condition-level Setup Type validation comparison (Stage 15.2 §10). Only
 * meaningful when both sides validated against the SAME historical Strategy
 * version + Setup Type + scenario — condition identity (`checklistItemId`)
 * is otherwise unsafe to compare, since two different historical versions
 * may reuse ids for entirely different conditions or vice versa. When
 * incompatible, this returns `comparable: false` with a plain-language
 * reason rather than forcing a field-level comparison (§10's explicit
 * requirement).
 */
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { ValidationConditionComparison, ValidationDifference } from "@/domain/replay-comparison/types";
import type { ActualTradeComparisonSnapshot, ReplayTradeDTO } from "@/types/replay";

function emptyDifference(
  actualSnapshot: ActualTradeComparisonSnapshot | null,
  replay: ReplayTradeDTO,
  incompatibilityReason: string,
): ValidationDifference {
  const replaySnapshot = replay.replayValidationSnapshot as SetupValidationSnapshot | null;
  return {
    comparable: false,
    incompatibilityReason,
    actualValidationState: actualSnapshot?.validationState ?? null,
    replayValidationState: replay.validationState,
    actualScore: actualSnapshot?.validationSnapshot?.score ?? null,
    replayScore: replaySnapshot?.score ?? null,
    actualOverrideReason: actualSnapshot?.overrideReason ?? null,
    replayOverrideReason: replay.overrideReason,
    conditions: [],
    checkedOnlyInActual: [],
    checkedOnlyInReplay: [],
    mandatoryDifferenceNames: [],
  };
}

export function buildValidationDifference(
  actualSnapshot: ActualTradeComparisonSnapshot | null,
  replay: ReplayTradeDTO,
): ValidationDifference {
  if (!actualSnapshot) {
    return emptyDifference(actualSnapshot, replay, "Legacy baseline — no frozen validation evidence to compare.");
  }

  const actualVal = actualSnapshot.validationSnapshot;
  const replayVal = replay.replayValidationSnapshot as SetupValidationSnapshot | null;
  if (!actualVal || !replayVal) {
    return emptyDifference(actualSnapshot, replay, "One side has no Setup Type validation recorded.");
  }

  const compatible =
    actualSnapshot.strategyVersion != null &&
    actualSnapshot.strategyVersion === replay.strategyVersionSnapshot &&
    actualVal.setupType.name === replayVal.setupType.name &&
    actualVal.scenario.direction === replayVal.scenario.direction;

  if (!compatible) {
    return emptyDifference(
      actualSnapshot,
      replay,
      "Different historical Strategy versions — condition-by-condition comparison unavailable.",
    );
  }

  const actualById = new Map(actualVal.conditions.map((c) => [c.checklistItemId, c]));
  const replayById = new Map(replayVal.conditions.map((c) => [c.checklistItemId, c]));
  const allIds = new Set([...actualById.keys(), ...replayById.keys()]);

  const conditions: ValidationConditionComparison[] = [];
  const checkedOnlyInActual: string[] = [];
  const checkedOnlyInReplay: string[] = [];
  const mandatoryDifferenceNames: string[] = [];

  for (const id of allIds) {
    const a = actualById.get(id);
    const r = replayById.get(id);
    const name = a?.name ?? r?.name ?? id;
    const mandatory = a?.mandatory ?? r?.mandatory ?? false;
    const checkedInActual = a?.checked ?? false;
    const checkedInReplay = r?.checked ?? false;

    conditions.push({ checklistItemId: id, name, mandatory, checkedInActual, checkedInReplay });
    if (checkedInActual && !checkedInReplay) checkedOnlyInActual.push(name);
    if (checkedInReplay && !checkedInActual) checkedOnlyInReplay.push(name);
    if (mandatory && checkedInActual !== checkedInReplay) mandatoryDifferenceNames.push(name);
  }

  return {
    comparable: true,
    incompatibilityReason: null,
    actualValidationState: actualSnapshot.validationState,
    replayValidationState: replay.validationState,
    actualScore: actualVal.score,
    replayScore: replayVal.score,
    actualOverrideReason: actualSnapshot.overrideReason,
    replayOverrideReason: replay.overrideReason,
    conditions: conditions.sort((x, y) => x.name.localeCompare(y.name)),
    checkedOnlyInActual,
    checkedOnlyInReplay,
    mandatoryDifferenceNames,
  };
}
