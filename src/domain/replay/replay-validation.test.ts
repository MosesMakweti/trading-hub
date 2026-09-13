import { describe, expect, it } from "vitest";

import { buildSetupValidationSnapshot, resolveValidationState } from "@/domain/trades/setup-validation";
import {
  findHistoricalScenario,
  scenarioDirectionForTradeDirection,
  toReplayResolvedConditions,
} from "@/domain/replay/replay-validation";
import type { StrategyVersionSetupTypeSnapshot } from "@/types/strategies";

const setupTypes: StrategyVersionSetupTypeSnapshot[] = [
  {
    name: "Type A",
    description: null,
    scenarios: [
      {
        direction: "BULLISH",
        description: null,
        conditions: [
          { checklistItemId: "c1", name: "Bullish MSS", directionApplicability: "BULLISH", mandatory: true, weight: 50, sortOrder: 0 },
          { checklistItemId: "c2", name: "Liquidity swept", directionApplicability: "BOTH", mandatory: false, weight: 30, sortOrder: 1 },
        ],
      },
      {
        direction: "BEARISH",
        description: null,
        conditions: [
          { checklistItemId: "c3", name: "Bearish MSS", directionApplicability: "BEARISH", mandatory: true, weight: 50, sortOrder: 0 },
        ],
      },
    ],
  },
];

describe("scenarioDirectionForTradeDirection (§5 — LONG/SHORT maps directly, no separate scenario picker)", () => {
  it("LONG maps to BULLISH", () => {
    expect(scenarioDirectionForTradeDirection("LONG")).toBe("BULLISH");
  });
  it("SHORT maps to BEARISH", () => {
    expect(scenarioDirectionForTradeDirection("SHORT")).toBe("BEARISH");
  });
});

describe("findHistoricalScenario", () => {
  it("finds the correct scenario for LONG", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "LONG");
    expect(found?.scenario.direction).toBe("BULLISH");
    expect(found?.scenario.conditions).toHaveLength(2);
  });

  it("finds the correct scenario for SHORT", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "SHORT");
    expect(found?.scenario.direction).toBe("BEARISH");
  });

  it("returns null for an unknown Setup Type", () => {
    expect(findHistoricalScenario(setupTypes, "Not A Real Type", "LONG")).toBeNull();
  });
});

describe("Replay validation reuses the exact Stage 3/4 scoring engine", () => {
  it("VALIDATED when every mandatory condition is checked", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "LONG")!;
    const result = buildSetupValidationSnapshot({
      strategyName: "My Strategy",
      strategyVersion: 2,
      setupType: { id: "st1", name: found.setupType.name },
      scenario: { id: "sc1", direction: found.scenario.direction },
      conditions: toReplayResolvedConditions(found.scenario),
      selectedChecklistItemIds: ["c1"],
      overrideReason: null,
      overrideNote: null,
    });
    expect(result.validationState).toBe("VALIDATED");
    expect(result.snapshot.mandatoryGateMet).toBe(true);
  });

  it("NOT_VALIDATED when a mandatory condition is missing and no override requested", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "LONG")!;
    const result = buildSetupValidationSnapshot({
      strategyName: "My Strategy",
      strategyVersion: 2,
      setupType: { id: "st1", name: found.setupType.name },
      scenario: { id: "sc1", direction: found.scenario.direction },
      conditions: toReplayResolvedConditions(found.scenario),
      selectedChecklistItemIds: ["c2"], // only the optional one
      overrideReason: null,
      overrideNote: null,
    });
    expect(result.validationState).toBe("NOT_VALIDATED");
  });

  it("OVERRIDDEN when the trader takes it anyway with a reason", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "LONG")!;
    const result = buildSetupValidationSnapshot({
      strategyName: "My Strategy",
      strategyVersion: 2,
      setupType: { id: "st1", name: found.setupType.name },
      scenario: { id: "sc1", direction: found.scenario.direction },
      conditions: toReplayResolvedConditions(found.scenario),
      selectedChecklistItemIds: [],
      overrideReason: "DISCRETIONARY_OVERRIDE",
      overrideNote: "Took it anyway.",
    });
    expect(result.validationState).toBe("OVERRIDDEN");
    expect(result.snapshot.overrideReason).toBe("DISCRETIONARY_OVERRIDE");
  });

  it("the snapshot freezes strategy/version/setup identity — not a live pointer", () => {
    const found = findHistoricalScenario(setupTypes, "Type A", "LONG")!;
    const result = buildSetupValidationSnapshot({
      strategyName: "Frozen Name",
      strategyVersion: 7,
      setupType: { id: "st1", name: found.setupType.name },
      scenario: { id: "sc1", direction: found.scenario.direction },
      conditions: toReplayResolvedConditions(found.scenario),
      selectedChecklistItemIds: ["c1"],
      overrideReason: null,
      overrideNote: null,
    });
    expect(result.snapshot.strategyName).toBe("Frozen Name");
    expect(result.snapshot.strategyVersion).toBe(7);
  });
});

describe("resolveValidationState (sanity — already covered by Stage 4, reused verbatim)", () => {
  it("VALIDATED when gate met regardless of override flag", () => {
    expect(resolveValidationState(true, true)).toBe("VALIDATED");
  });
});
