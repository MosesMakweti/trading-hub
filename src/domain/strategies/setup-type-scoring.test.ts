import { describe, expect, it } from "vitest";

import {
  isEligibleForScenario,
  resolveScenarioConditions,
  toScorableConfluences,
  type SetupScenarioConditionInput,
} from "./setup-type-scoring";
import { scoreConfluences } from "@/domain/trades/confluence-score";

function condition(over: Partial<SetupScenarioConditionInput> = {}): SetupScenarioConditionInput {
  return {
    id: "cond-1",
    checklistItemId: "item-1",
    checklistItemName: "Bullish MSB",
    checklistItemKind: "CONFLUENCE",
    checklistItemColor: "GREEN",
    checklistItemWeight: 30,
    checklistItemMandatory: true,
    checklistItemDirectionApplicability: "BULLISH",
    mandatoryOverride: null,
    weightOverride: null,
    sortOrder: 0,
    ...over,
  };
}

describe("resolveScenarioConditions — inheritance and overrides", () => {
  it("inherits the checklist item's weight/mandatory when no override is set", () => {
    const [resolved] = resolveScenarioConditions([condition()]);
    expect(resolved.weight).toBe(30);
    expect(resolved.mandatory).toBe(true);
  });

  it("applies a weight override without touching mandatory", () => {
    const [resolved] = resolveScenarioConditions([condition({ weightOverride: 50 })]);
    expect(resolved.weight).toBe(50);
    expect(resolved.mandatory).toBe(true); // still inherited
  });

  it("applies a mandatory override (demoting a mandatory item to optional for this scenario only)", () => {
    const [resolved] = resolveScenarioConditions([condition({ mandatoryOverride: false })]);
    expect(resolved.mandatory).toBe(false);
    expect(resolved.weight).toBe(30); // still inherited
  });

  it("applies both overrides independently", () => {
    const [resolved] = resolveScenarioConditions([
      condition({ mandatoryOverride: false, weightOverride: 10 }),
    ]);
    expect(resolved.mandatory).toBe(false);
    expect(resolved.weight).toBe(10);
  });

  it("a weightOverride of 0 is respected (not treated as falsy/absent)", () => {
    const [resolved] = resolveScenarioConditions([condition({ weightOverride: 0 })]);
    expect(resolved.weight).toBe(0);
  });

  it("sorts by sortOrder regardless of input order", () => {
    const resolved = resolveScenarioConditions([
      condition({ id: "b", sortOrder: 2, checklistItemName: "Second" }),
      condition({ id: "a", sortOrder: 0, checklistItemName: "First" }),
      condition({ id: "c", sortOrder: 1, checklistItemName: "Middle" }),
    ]);
    expect(resolved.map((r) => r.name)).toEqual(["First", "Middle", "Second"]);
  });

  it("does not mutate the input array", () => {
    const input = [condition({ sortOrder: 1 }), condition({ id: "x", sortOrder: 0 })];
    const inputCopy = [...input];
    resolveScenarioConditions(input);
    expect(input).toEqual(inputCopy);
  });
});

describe("toScorableConfluences — feeds the EXISTING scoring engine unchanged", () => {
  it("produces output scoreConfluences can consume directly, mandatory gate respected", () => {
    const resolved = resolveScenarioConditions([
      condition({ id: "a", checklistItemId: "a", checklistItemName: "Bullish MSB", weightOverride: 60, mandatoryOverride: true }),
      condition({
        id: "b",
        checklistItemId: "b",
        checklistItemName: "Bullish FVG",
        checklistItemDirectionApplicability: "BULLISH",
        checklistItemWeight: 40,
        checklistItemMandatory: false,
        sortOrder: 1,
      }),
    ]);
    const scorable = toScorableConfluences(resolved);

    const result = scoreConfluences({
      confluences: scorable,
      selectedNames: ["Bullish MSB"],
      direction: "LONG",
    });

    expect(result.score).toBe(60); // 60 / (60+40) selected
    expect(result.mandatoryRequirementsMet).toBe(true); // the only mandatory one (a) was selected
  });

  it("a scenario-demoted mandatory condition no longer gates validity", () => {
    const resolved = resolveScenarioConditions([condition({ mandatoryOverride: false })]);
    const result = scoreConfluences({
      confluences: toScorableConfluences(resolved),
      selectedNames: [], // not selected
      direction: "LONG",
    });
    expect(result.mandatoryRequirementsMet).toBe(true); // no mandatory condition remains
  });
});

describe("isEligibleForScenario — mirrors the existing direction-applicability rule", () => {
  it("BULLISH scenario accepts BULLISH and BOTH, rejects BEARISH", () => {
    expect(isEligibleForScenario("BULLISH", "BULLISH")).toBe(true);
    expect(isEligibleForScenario("BOTH", "BULLISH")).toBe(true);
    expect(isEligibleForScenario("BEARISH", "BULLISH")).toBe(false);
  });

  it("BEARISH scenario accepts BEARISH and BOTH, rejects BULLISH", () => {
    expect(isEligibleForScenario("BEARISH", "BEARISH")).toBe(true);
    expect(isEligibleForScenario("BOTH", "BEARISH")).toBe(true);
    expect(isEligibleForScenario("BULLISH", "BEARISH")).toBe(false);
  });
});
