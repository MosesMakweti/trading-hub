import { describe, expect, it } from "vitest";

import { canonicalJson, detectStrategyDrift } from "./strategy-drift";

const frozen = { name: "London Sweep", status: "TESTING", applicableAssets: ["EURUSD"], confluences: [{ name: "HTF bias", weight: 2 }] };

describe("detectStrategyDrift", () => {
  it("is key-order insensitive (jsonb reorders keys) and ignores status", () => {
    const reordered = { confluences: [{ weight: 2, name: "HTF bias" }], applicableAssets: ["EURUSD"], name: "London Sweep", status: "LIVE" };
    expect(canonicalJson(frozen)).toBe(canonicalJson({ ...reordered, status: "TESTING" }));
    expect(detectStrategyDrift({ hadStrategy: true, frozenSnapshot: frozen, currentSnapshot: reordered })).toBe("UNCHANGED");
  });

  it("flags a methodology change", () => {
    const edited = { ...frozen, confluences: [{ name: "HTF bias", weight: 3 }] };
    expect(detectStrategyDrift({ hadStrategy: true, frozenSnapshot: frozen, currentSnapshot: edited })).toBe("CHANGED");
  });

  it("distinguishes a removed strategy and a run without one", () => {
    expect(detectStrategyDrift({ hadStrategy: true, frozenSnapshot: frozen, currentSnapshot: null })).toBe("STRATEGY_REMOVED");
    expect(detectStrategyDrift({ hadStrategy: false, frozenSnapshot: null, currentSnapshot: null })).toBe("NO_STRATEGY");
  });
});
