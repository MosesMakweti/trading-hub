import { describe, expect, it } from "vitest";

import {
  buildSetupValidationSnapshot,
  resolveValidationState,
  type BuildSetupValidationSnapshotInput,
} from "@/domain/trades/setup-validation";
import type { ResolvedSetupCondition } from "@/domain/strategies/setup-type-scoring";

function condition(over: Partial<ResolvedSetupCondition> & { id: string; checklistItemId: string }): ResolvedSetupCondition {
  return {
    name: over.checklistItemId,
    color: "GRAY",
    kind: "CONFLUENCE",
    directionApplicability: "BULLISH",
    weight: 25,
    mandatory: false,
    sortOrder: 0,
    ...over,
  };
}

function baseInput(
  over: Partial<BuildSetupValidationSnapshotInput> = {},
): BuildSetupValidationSnapshotInput {
  return {
    strategyName: "Liquidity Reversal",
    strategyVersion: 3,
    setupType: { id: "st-1", name: "Type A" },
    scenario: { id: "sc-1", direction: "BULLISH" },
    conditions: [],
    selectedChecklistItemIds: [],
    overrideReason: null,
    overrideNote: null,
    now: new Date("2026-09-12T12:00:00.000Z"),
    ...over,
  };
}

describe("resolveValidationState", () => {
  it("is VALIDATED once the mandatory gate is met, regardless of override", () => {
    expect(resolveValidationState(true, false)).toBe("VALIDATED");
    expect(resolveValidationState(true, true)).toBe("VALIDATED");
  });

  it("is NOT_VALIDATED when the gate fails and no override was requested", () => {
    expect(resolveValidationState(false, false)).toBe("NOT_VALIDATED");
  });

  it("is OVERRIDDEN when the gate fails and an override was requested", () => {
    expect(resolveValidationState(false, true)).toBe("OVERRIDDEN");
  });
});

describe("buildSetupValidationSnapshot", () => {
  it("validates when every mandatory condition is checked, optional ones don't block", () => {
    const conditions = [
      condition({ id: "c1", checklistItemId: "sell-side-liquidity", mandatory: true }),
      condition({ id: "c2", checklistItemId: "htf-bullish-area", mandatory: true }),
      condition({ id: "c3", checklistItemId: "bullish-displacement", mandatory: true }),
      condition({ id: "c4", checklistItemId: "bullish-mss", mandatory: true }),
      condition({ id: "c5", checklistItemId: "fvg-present", mandatory: false }),
      condition({ id: "c6", checklistItemId: "execution-confirmation", mandatory: false }),
    ];
    const { validationState, snapshot } = buildSetupValidationSnapshot(
      baseInput({
        conditions,
        selectedChecklistItemIds: [
          "sell-side-liquidity",
          "htf-bullish-area",
          "bullish-displacement",
          "bullish-mss",
        ],
      }),
    );

    expect(validationState).toBe("VALIDATED");
    expect(snapshot.mandatoryGateMet).toBe(true);
    expect(snapshot.missingMandatoryConditionNames).toEqual([]);
    expect(snapshot.conditions.find((c) => c.checklistItemId === "fvg-present")?.checked).toBe(false);
  });

  it("stays NOT_VALIDATED with a missing mandatory condition even if every optional one is checked", () => {
    const conditions = [
      condition({ id: "c1", checklistItemId: "mandatory-a", mandatory: true }),
      condition({ id: "c2", checklistItemId: "mandatory-b", mandatory: true }),
      condition({ id: "c3", checklistItemId: "optional-a", mandatory: false }),
    ];
    const { validationState, overrideReason, snapshot } = buildSetupValidationSnapshot(
      baseInput({
        conditions,
        selectedChecklistItemIds: ["mandatory-a", "optional-a"],
      }),
    );

    expect(validationState).toBe("NOT_VALIDATED");
    expect(overrideReason).toBeNull();
    expect(snapshot.missingMandatoryConditionNames).toEqual(["mandatory-b"]);
  });

  it("becomes OVERRIDDEN and preserves the reason + incomplete checklist state", () => {
    const conditions = [
      condition({ id: "c1", checklistItemId: "mandatory-a", mandatory: true }),
      condition({ id: "c2", checklistItemId: "mandatory-b", mandatory: true }),
    ];
    const { validationState, overrideReason, overrideNote, snapshot } = buildSetupValidationSnapshot(
      baseInput({
        conditions,
        selectedChecklistItemIds: ["mandatory-a"],
        overrideReason: "FOMO",
        overrideNote: "Chart moved fast, jumped in.",
      }),
    );

    expect(validationState).toBe("OVERRIDDEN");
    expect(overrideReason).toBe("FOMO");
    expect(overrideNote).toBe("Chart moved fast, jumped in.");
    expect(snapshot.conditions.find((c) => c.checklistItemId === "mandatory-a")?.checked).toBe(true);
    expect(snapshot.conditions.find((c) => c.checklistItemId === "mandatory-b")?.checked).toBe(false);
  });

  it("clears an override reason/note that was submitted when the gate actually passed", () => {
    const conditions = [condition({ id: "c1", checklistItemId: "mandatory-a", mandatory: true })];
    const { validationState, overrideReason, overrideNote } = buildSetupValidationSnapshot(
      baseInput({
        conditions,
        selectedChecklistItemIds: ["mandatory-a"],
        overrideReason: "DISCRETIONARY_OVERRIDE",
        overrideNote: "Not actually needed.",
      }),
    );

    expect(validationState).toBe("VALIDATED");
    expect(overrideReason).toBeNull();
    expect(overrideNote).toBeNull();
  });

  it("scores a BEARISH scenario correctly (bearish + both conditions eligible)", () => {
    const conditions = [
      condition({ id: "c1", checklistItemId: "bearish-mss", mandatory: true, directionApplicability: "BEARISH" }),
      condition({ id: "c2", checklistItemId: "session-both", mandatory: false, directionApplicability: "BOTH" }),
    ];
    const { validationState, snapshot } = buildSetupValidationSnapshot(
      baseInput({
        scenario: { id: "sc-2", direction: "BEARISH" },
        conditions,
        selectedChecklistItemIds: ["bearish-mss", "session-both"],
      }),
    );

    expect(validationState).toBe("VALIDATED");
    expect(snapshot.score).toBe(100);
  });

  it("ignores stale checked ids that no longer belong to the resolved conditions", () => {
    const conditions = [condition({ id: "c1", checklistItemId: "mandatory-a", mandatory: true })];
    const { validationState, snapshot } = buildSetupValidationSnapshot(
      baseInput({
        conditions,
        selectedChecklistItemIds: ["some-condition-from-a-different-scenario"],
      }),
    );

    expect(validationState).toBe("NOT_VALIDATED");
    expect(snapshot.conditions[0].checked).toBe(false);
  });
});
