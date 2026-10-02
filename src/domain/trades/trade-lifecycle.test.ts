import { describe, expect, it } from "vitest";

import { deriveTradeLifecycle, exitedPercentFrom, listGroupFor, type TradeLifecycleFacts } from "@/domain/trades/trade-lifecycle";
import { evaluateNewTradeOverride } from "@/domain/today/limit-state";
import { compatibilityFields, ideaDefaults, suggestedPlanTargets } from "@/domain/today/idea-inheritance";

const base: TradeLifecycleFacts = {
  cancelled: false,
  hasConfirmedPlan: false,
  planLocked: false,
  hasActualEntry: false,
  exitedPercent: null,
  hasLegacyResult: false,
  settled: false,
  reviewed: false,
  tradingReady: true,
};

describe("trade-lifecycle — derived display state", () => {
  it("IDEA → plan stage, waiting for plan", () => {
    const l = deriveTradeLifecycle(base);
    expect(l).toMatchObject({ state: "IDEA", primaryStage: "plan", waitingFor: "Waiting for plan", openPercent: null });
    expect(l.stages.execution.available).toBe(true); // planless execution is legal once ready
    expect(l.stages.review.available).toBe(false);
  });

  it("PLANNED → execution when ready; plan when not ready (taking a trade is gated)", () => {
    expect(deriveTradeLifecycle({ ...base, hasConfirmedPlan: true })).toMatchObject({ state: "PLANNED", primaryStage: "execution" });
    const notReady = deriveTradeLifecycle({ ...base, hasConfirmedPlan: true, tradingReady: false });
    expect(notReady).toMatchObject({ state: "PLANNED", primaryStage: "plan", waitingFor: "Waiting for readiness before entry" });
    expect(notReady.stages.execution).toMatchObject({ available: false, lockedReason: "Confirm readiness in Prepare to take this trade" });
  });

  it("an entered position stays manageable even when readiness is not confirmed", () => {
    const l = deriveTradeLifecycle({ ...base, hasActualEntry: true, tradingReady: false });
    expect(l).toMatchObject({ state: "OPEN", primaryStage: "execution", openPercent: 100 });
    expect(l.stages.execution.available).toBe(true);
  });

  it("partial exits → PARTIALLY_CLOSED with the open remainder", () => {
    const l = deriveTradeLifecycle({ ...base, hasActualEntry: true, exitedPercent: 60 });
    expect(l).toMatchObject({ state: "PARTIALLY_CLOSED", openPercent: 40, waitingFor: "40% still open — waiting for exit" });
  });

  it("fully exited → REVIEW_NEEDED; settled + reviewed → REVIEWED", () => {
    expect(deriveTradeLifecycle({ ...base, hasActualEntry: true, exitedPercent: 100, settled: true })).toMatchObject({
      state: "REVIEW_NEEDED",
      primaryStage: "review",
      waitingFor: "Trade closed — review required",
    });
    expect(deriveTradeLifecycle({ ...base, hasActualEntry: true, exitedPercent: 100 })).toMatchObject({
      state: "REVIEW_NEEDED",
      waitingFor: "Closed — initial stop needed before Performance can settle",
    });
    expect(deriveTradeLifecycle({ ...base, hasActualEntry: true, settled: true, reviewed: true }).state).toBe("REVIEWED");
  });

  it("CANCELLED before entry; a legacy imported result counts as closed", () => {
    const c = deriveTradeLifecycle({ ...base, cancelled: true });
    expect(c).toMatchObject({ state: "CANCELLED", primaryStage: "idea" });
    expect(c.stages.execution.available).toBe(false);
    expect(deriveTradeLifecycle({ ...base, hasLegacyResult: true }).state).toBe("REVIEW_NEEDED");
  });

  it("exitedPercentFrom prefers partial exits, else a single actual exit", () => {
    expect(exitedPercentFrom([{ percentClosed: 50 }, { percentClosed: 30 }, { percentClosed: null }], null)).toBe(80);
    expect(exitedPercentFrom([], 1.1)).toBe(100);
    expect(exitedPercentFrom([], null)).toBeNull();
  });

  it("groups carried positions separately from today's trades", () => {
    expect(listGroupFor("OPEN", true)).toBe("CARRIED");
    expect(listGroupFor("PLANNED", false)).toBe("IDEAS");
    expect(listGroupFor("REVIEW_NEEDED", false)).toBe("ACTIVE");
    expect(listGroupFor("CANCELLED", false)).toBe("DONE");
  });
});

describe("evaluateNewTradeOverride — soft limits with accountability", () => {
  const usage = { executedCount: 3, riskUsedPercent: 1, riskComplete: true };

  it("requires an override for trade N+1 past the confirmed max", () => {
    const r = evaluateNewTradeOverride(usage, { maxTrades: 3, riskLimitPercent: null }, 1);
    expect(r.required).toBe(true);
    expect(r.kinds).toEqual(["MAX_TRADES"]);
    expect(r.messages[0]).toBe("This would be trade 4 of your confirmed maximum 3.");
  });

  it("requires an override when projected risk exceeds the confirmed daily limit", () => {
    const r = evaluateNewTradeOverride({ ...usage, executedCount: 1 }, { maxTrades: null, riskLimitPercent: 1.5 }, 1);
    expect(r.kinds).toEqual(["DAILY_RISK"]);
    expect(r.context).toMatchObject({ riskUsedPercent: 1, projectedRiskPercent: 1, riskLimitPercent: 1.5 });
  });

  it("no override when within limits, when limits are unconfirmed, or when risk isn't reliably known", () => {
    expect(evaluateNewTradeOverride({ ...usage, executedCount: 1 }, { maxTrades: 3, riskLimitPercent: 3 }, 1).required).toBe(false);
    expect(evaluateNewTradeOverride(usage, { maxTrades: null, riskLimitPercent: null }, 5).required).toBe(false);
    expect(
      evaluateNewTradeOverride({ ...usage, executedCount: 0, riskComplete: false }, { maxTrades: null, riskLimitPercent: 0.5 }, 1).required,
    ).toBe(false);
  });
});

describe("idea-inheritance — prefill, never a silent decision", () => {
  const day = { activeSessions: ["London"], sessionWindows: [], nowMinutes: 600 };

  it("prefills asset, strategy, direction from a LONG/SHORT final bias, and an unambiguous session", () => {
    expect(
      ideaDefaults({ assetSymbol: "XAUUSD", activeStrategyId: "s1", finalBias: "SHORT", htfBias: null }, day),
    ).toEqual({ assetSymbol: "XAUUSD", strategyId: "s1", direction: "SHORT", directionFromFinalBias: true, session: "London" });
  });

  it("NEUTRAL or missing final bias leaves direction unselected — no default Long", () => {
    expect(ideaDefaults({ assetSymbol: "X", activeStrategyId: null, finalBias: "NEUTRAL", htfBias: null }, day).direction).toBeNull();
    expect(ideaDefaults({ assetSymbol: "X", activeStrategyId: null, finalBias: null, htfBias: null }, day).direction).toBeNull();
    expect(ideaDefaults(null, { ...day, activeSessions: ["London", "NY"] })).toMatchObject({ direction: null, session: null, assetSymbol: "" });
  });

  it("compatibility values: HTF from the asset read, else the direction's side; provisional clock time", () => {
    expect(compatibilityFields({ direction: "LONG", assetHtfBias: "BEARISH", nowMinutes: 615.4 })).toEqual({
      higherTimeframeBias: "BEARISH",
      biasConfidencePercent: 50,
      executionMinutes: 615,
    });
    expect(compatibilityFields({ direction: "SHORT", assetHtfBias: "NEUTRAL", nowMinutes: 2000 })).toMatchObject({
      higherTimeframeBias: "BEARISH",
      executionMinutes: 1439,
    });
  });

  it("strategy partial TPs become suggested rows with blank prices", () => {
    expect(
      suggestedPlanTargets([
        { trigger: "1R", percentToClose: 50, reason: "pay yourself" },
        { trigger: null, percentToClose: 30, reason: null },
      ]),
    ).toEqual([
      { label: "TP1", plannedClosePercent: 50, managementInstruction: "1R — pay yourself" },
      { label: "TP2", plannedClosePercent: 30, managementInstruction: null },
    ]);
  });
});
