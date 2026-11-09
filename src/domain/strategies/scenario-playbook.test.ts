import { describe, expect, it } from "vitest";

import {
  pickScenarioForTrade,
  readExecutionPlan,
  readScenarioContext,
  scenarioFitsTrade,
} from "@/domain/strategies/scenario-playbook";

const s = (id: string, direction: "BULLISH" | "BEARISH" | "NEUTRAL", sortOrder: number) => ({ id, direction, sortOrder });

describe("scenarioFitsTrade", () => {
  it("matches bullish to long, bearish to short, and neutral to both", () => {
    expect(scenarioFitsTrade("BULLISH", "LONG")).toBe(true);
    expect(scenarioFitsTrade("BULLISH", "SHORT")).toBe(false);
    expect(scenarioFitsTrade("BEARISH", "SHORT")).toBe(true);
    expect(scenarioFitsTrade("BEARISH", "LONG")).toBe(false);
    expect(scenarioFitsTrade("NEUTRAL", "LONG")).toBe(true);
    expect(scenarioFitsTrade("NEUTRAL", "SHORT")).toBe(true);
  });
});

describe("pickScenarioForTrade", () => {
  it("resolves a classic two-scenario setup exactly as before", () => {
    const list = [s("bull", "BULLISH", 0), s("bear", "BEARISH", 1)];
    expect(pickScenarioForTrade(list, "LONG")?.id).toBe("bull");
    expect(pickScenarioForTrade(list, "SHORT")?.id).toBe("bear");
  });

  it("defaults to the first matching scenario by sort order, not array order", () => {
    const list = [s("bull-b", "BULLISH", 3), s("bull-a", "BULLISH", 1), s("bear", "BEARISH", 2)];
    expect(pickScenarioForTrade(list, "LONG")?.id).toBe("bull-a");
  });

  it("prefers an exact direction over a neutral one, and falls back to neutral", () => {
    const list = [s("neutral", "NEUTRAL", 0), s("bull", "BULLISH", 1)];
    expect(pickScenarioForTrade(list, "LONG")?.id).toBe("bull");
    expect(pickScenarioForTrade(list, "SHORT")?.id).toBe("neutral");
  });

  it("returns null when nothing fits", () => {
    expect(pickScenarioForTrade([s("bull", "BULLISH", 0)], "SHORT")).toBeNull();
    expect(pickScenarioForTrade([], "LONG")).toBeNull();
  });

  it("honours an explicit choice that fits, and never swaps one that doesn't", () => {
    const list = [s("bull-a", "BULLISH", 0), s("bull-b", "BULLISH", 1), s("bear", "BEARISH", 2)];
    expect(pickScenarioForTrade(list, "LONG", "bull-b")?.id).toBe("bull-b");
    expect(pickScenarioForTrade(list, "SHORT", "bull-b")).toBeNull();
    expect(pickScenarioForTrade(list, "LONG", "missing")).toBeNull();
  });
});

describe("readScenarioContext / readExecutionPlan", () => {
  it("treats null and missing as an empty object", () => {
    expect(readScenarioContext(null)).toEqual({});
    expect(readExecutionPlan(undefined)).toEqual({});
  });

  it("keeps valid fields and drops malformed ones instead of failing the read", () => {
    const ctx = readScenarioContext({ htfBias: "H4 bullish", liquidity: 42, custom: "nope" });
    expect(ctx).toEqual({ htfBias: "H4 bullish" });

    const plan = readExecutionPlan({
      entry: [{ id: "r1", text: "Wait for MSB", mandatory: true }],
      stopLoss: [{ id: "", text: "" }],
      minRiskReward: 2,
    });
    expect(plan).toEqual({ entry: [{ id: "r1", text: "Wait for MSB", mandatory: true }], minRiskReward: 2 });
  });

  it("reads a fully valid plan unchanged", () => {
    const raw = { noTrade: [{ id: "n1", text: "News within 30 min", mandatory: true }], minRiskReward: null };
    expect(readExecutionPlan(raw)).toEqual(raw);
  });
});
