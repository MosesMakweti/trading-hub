import { describe, expect, it } from "vitest";

import {
  setupScenarioConditionAddSchema,
  setupScenarioConditionUpdateSchema,
  setupScenarioDirectionSchema,
  setupTypeCreateSchema,
  setupTypeUpdateSchema,
} from "./strategy-setup-types";

describe("setupTypeCreateSchema", () => {
  it("requires a non-empty name", () => {
    expect(setupTypeCreateSchema.safeParse({ name: "Type A" }).success).toBe(true);
    expect(setupTypeCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(setupTypeCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("accepts an optional description", () => {
    expect(setupTypeCreateSchema.safeParse({ name: "Type A", description: "notes" }).success).toBe(true);
    expect(setupTypeCreateSchema.safeParse({ name: "Type A", description: null }).success).toBe(true);
  });
});

describe("setupTypeUpdateSchema", () => {
  it("rejects an empty patch", () => {
    expect(setupTypeUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts name and/or description independently", () => {
    expect(setupTypeUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(setupTypeUpdateSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(setupTypeUpdateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("setupScenarioDirectionSchema", () => {
  it("only accepts BULLISH/BEARISH — never BOTH (that's the checklist-item vocabulary, not a scenario)", () => {
    expect(setupScenarioDirectionSchema.safeParse("BULLISH").success).toBe(true);
    expect(setupScenarioDirectionSchema.safeParse("BEARISH").success).toBe(true);
    expect(setupScenarioDirectionSchema.safeParse("BOTH").success).toBe(false);
  });
});

describe("setupScenarioConditionAddSchema", () => {
  it("requires a checklistItemId", () => {
    expect(setupScenarioConditionAddSchema.safeParse({ checklistItemId: "abc" }).success).toBe(true);
    expect(setupScenarioConditionAddSchema.safeParse({ checklistItemId: "" }).success).toBe(false);
  });

  it("bounds an optional weight override to 0-100", () => {
    expect(
      setupScenarioConditionAddSchema.safeParse({ checklistItemId: "abc", weightOverride: 50 }).success,
    ).toBe(true);
    expect(
      setupScenarioConditionAddSchema.safeParse({ checklistItemId: "abc", weightOverride: 101 }).success,
    ).toBe(false);
    expect(
      setupScenarioConditionAddSchema.safeParse({ checklistItemId: "abc", weightOverride: -1 }).success,
    ).toBe(false);
  });
});

describe("setupScenarioConditionUpdateSchema — tri-state override editing", () => {
  it("rejects an empty patch", () => {
    expect(setupScenarioConditionUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts clearing an override back to null (inherit)", () => {
    expect(setupScenarioConditionUpdateSchema.safeParse({ mandatoryOverride: null }).success).toBe(true);
    expect(setupScenarioConditionUpdateSchema.safeParse({ weightOverride: null }).success).toBe(true);
  });

  it("accepts setting an explicit override", () => {
    const r = setupScenarioConditionUpdateSchema.safeParse({ mandatoryOverride: false, weightOverride: 10 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mandatoryOverride).toBe(false);
      expect(r.data.weightOverride).toBe(10);
    }
  });

  it("rejects an out-of-range weight override", () => {
    expect(setupScenarioConditionUpdateSchema.safeParse({ weightOverride: 150 }).success).toBe(false);
  });
});
