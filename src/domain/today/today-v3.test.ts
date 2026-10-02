import { describe, expect, it } from "vitest";

import { confirmationState, suggestLimit, suggestSessions, type StrategyLimitSource } from "@/domain/today/rule-suggestions";
import { computeDayUsage, evaluateLimitState } from "@/domain/today/limit-state";
import { buildEvidenceCandidates } from "@/domain/today/evidence-suggestions";
import {
  buildStatusWarnings,
  defaultPhase,
  deriveDayPhase,
  derivePhaseRail,
  loggedBeforeReadiness,
} from "@/domain/today/day-phase";

const s = (id: string, name: string, risk: number | null, trades: number | null): StrategyLimitSource => ({
  strategyId: id,
  strategyName: name,
  maxDailyRiskPercent: risk,
  maxTradesPerDay: trades,
});

describe("rule-suggestions — Strategy Lab limits become suggestions", () => {
  it("suggests a single strategy's limit", () => {
    expect(suggestLimit([s("a", "London Sweep", 1.5, 3)], "maxDailyRiskPercent")).toEqual({
      value: 1.5,
      sources: [{ strategyId: "a", strategyName: "London Sweep", value: 1.5 }],
      strictestFrom: ["London Sweep"],
    });
  });

  it("multiple strategies -> the strictest (lowest) wins, with every source listed", () => {
    const r = suggestLimit([s("a", "A", 2, 4), s("b", "B", 1, 2), s("c", "C", null, 5)], "maxDailyRiskPercent");
    expect(r?.value).toBe(1);
    expect(r?.strictestFrom).toEqual(["B"]);
    expect(r?.sources.map((x) => x.strategyName)).toEqual(["A", "B"]);
    expect(suggestLimit([s("a", "A", 2, 4), s("b", "B", 1, 2)], "maxTradesPerDay")?.value).toBe(2);
  });

  it("ties name every strictest strategy; duplicate strategy ids count once", () => {
    const r = suggestLimit([s("a", "A", 1, null), s("a", "A", 1, null), s("b", "B", 1, null)], "maxDailyRiskPercent");
    expect(r?.sources).toHaveLength(2);
    expect(r?.strictestFrom).toEqual(["A", "B"]);
  });

  it("no configured limit -> no suggestion", () => {
    expect(suggestLimit([s("a", "A", null, null)], "maxTradesPerDay")).toBeNull();
    expect(suggestLimit([], "maxTradesPerDay")).toBeNull();
  });

  it("a suggestion is never a confirmation", () => {
    expect(confirmationState(1.5, null)).toBe("SUGGESTED");
    expect(confirmationState(null, null)).toBe("NOT_SET");
  });

  it("confirmed values keep their own identity", () => {
    expect(confirmationState(1.5, 1.5)).toBe("CONFIRMED");
    expect(confirmationState(1.5, 2)).toBe("CONFIRMED_DIFFERENT");
    expect(confirmationState(null, 2)).toBe("CONFIRMED_MANUAL");
  });

  it("session suggestions skip names the day already has (case-insensitive) and never remove", () => {
    expect(suggestSessions([["London", "New York"], ["london", "Asia"]], ["NEW YORK"])).toEqual(["London", "Asia"]);
    expect(suggestSessions([], ["Custom"])).toEqual([]);
  });
});

describe("limit-state — soft limits, no blocking", () => {
  const trade = (entry: boolean, cancelled: boolean, risk: number | null) => ({
    hasActualEntry: entry,
    cancelled,
    performanceRiskPercent: risk,
  });

  it("only executed trades consume the count; ideas and cancelled ideas don't", () => {
    const u = computeDayUsage([trade(true, false, 1), trade(false, false, null), trade(false, true, null)]);
    expect(u).toEqual({ executedCount: 1, pendingIdeaCount: 1, riskUsedPercent: 1, riskComplete: true });
  });

  it("risk used sums frozen Performance snapshots and flags missing ones", () => {
    const u = computeDayUsage([trade(true, false, 0.5), trade(true, false, 0.25), trade(true, false, null)]);
    expect(u.riskUsedPercent).toBe(0.75);
    expect(u.riskComplete).toBe(false);
  });

  it("classifies within / at / over and when an override would be required", () => {
    expect(evaluateLimitState({ executedCount: 1, riskUsedPercent: 1 }, { riskLimitPercent: 1.5, maxTrades: 3 })).toEqual({
      risk: "WITHIN",
      trades: "WITHIN",
      overrideRequiredForNewTrade: false,
    });
    expect(evaluateLimitState({ executedCount: 3, riskUsedPercent: 1.5 }, { riskLimitPercent: 1.5, maxTrades: 3 })).toEqual({
      risk: "AT_LIMIT",
      trades: "AT_LIMIT",
      overrideRequiredForNewTrade: true,
    });
    const over = evaluateLimitState({ executedCount: 4, riskUsedPercent: 2 }, { riskLimitPercent: 1.5, maxTrades: 3 });
    expect(over.risk).toBe("OVER");
    expect(over.trades).toBe("OVER");
  });

  it("no confirmed limits -> NO_LIMIT, never a fabricated boundary", () => {
    expect(evaluateLimitState({ executedCount: 9, riskUsedPercent: 9 }, { riskLimitPercent: null, maxTrades: null })).toEqual({
      risk: "NO_LIMIT",
      trades: "NO_LIMIT",
      overrideRequiredForNewTrade: false,
    });
  });
});

describe("evidence-suggestions — candidates, not observations", () => {
  it("seeds BULLISH/BEARISH confluences and skips BOTH", () => {
    expect(
      buildEvidenceCandidates(
        [
          { name: "Sweep of sell-side liquidity", directionApplicability: "BULLISH" },
          { name: "Bearish breaker", directionApplicability: "BEARISH" },
          { name: "FVG", directionApplicability: "BOTH" },
        ],
        [],
      ),
    ).toEqual([
      { label: "Sweep of sell-side liquidity", direction: "BULLISH" },
      { label: "Bearish breaker", direction: "BEARISH" },
    ]);
  });

  it("never duplicates existing evidence or itself (case/whitespace-insensitive)", () => {
    const out = buildEvidenceCandidates(
      [
        { name: "  Liquidity  sweep ", directionApplicability: "BULLISH" },
        { name: "liquidity sweep", directionApplicability: "BULLISH" },
        { name: "Liquidity sweep", directionApplicability: "BEARISH" },
        { name: "MSS", directionApplicability: "BULLISH" },
      ],
      [{ label: "mss", direction: "BULLISH" }],
    );
    expect(out).toEqual([
      { label: "Liquidity sweep", direction: "BULLISH" },
      { label: "Liquidity sweep", direction: "BEARISH" },
    ]);
  });

  it("running it twice adds nothing the second time", () => {
    const sources = [{ name: "A", directionApplicability: "BULLISH" as const }];
    const first = buildEvidenceCandidates(sources, []);
    expect(buildEvidenceCandidates(sources, first)).toEqual([]);
  });
});

describe("day-phase — Plan before readiness, trading gated", () => {
  const base = { archived: false, ready: false, planSet: false, tradeCount: 0 };

  it("derives the phase from facts", () => {
    expect(deriveDayPhase(base)).toBe("PREPARING");
    expect(deriveDayPhase({ ...base, ready: true })).toBe("PLANNING");
    expect(deriveDayPhase({ ...base, ready: true, planSet: true })).toBe("TRADING");
    expect(deriveDayPhase({ ...base, ready: true, tradeCount: 1 })).toBe("TRADING");
    expect(deriveDayPhase({ ...base, archived: true })).toBe("CLOSED");
  });

  it("the rail never locks Plan; it locks Trade until ready", () => {
    const notReady = derivePhaseRail({ ...base, tradesNeedingAttention: 0 });
    expect(notReady.find((p) => p.key === "plan")?.locked).toBe(false);
    expect(notReady.find((p) => p.key === "trade")?.locked).toBe(true);
    const ready = derivePhaseRail({ ...base, ready: true, tradesNeedingAttention: 2 });
    expect(ready.find((p) => p.key === "trade")).toMatchObject({ locked: false, attention: true });
    expect(ready.find((p) => p.key === "prepare")?.done).toBe(true);
  });

  it("an archived day is never locked", () => {
    const rail = derivePhaseRail({ ...base, archived: true, tradesNeedingAttention: 0 });
    expect(rail.every((p) => !p.locked)).toBe(true);
  });

  it("opens Plan first on a fresh day, then Prepare, then Trade", () => {
    expect(defaultPhase(base)).toBe("plan");
    expect(defaultPhase({ ...base, planSet: true })).toBe("prepare");
    expect(defaultPhase({ ...base, ready: true, planSet: true })).toBe("trade");
    expect(defaultPhase({ ...base, archived: true })).toBe("close");
  });

  it("warnings are ordered by severity and absent on archived days", () => {
    const w = buildStatusWarnings({
      archived: false,
      ready: false,
      mandatoryRemaining: 2,
      risk: "OVER",
      trades: "AT_LIMIT",
      reviewPendingCount: 1,
      loggedBeforeReadyCount: 1,
    });
    expect(w.map((x) => x.code)).toEqual([
      "RISK_LIMIT_EXCEEDED",
      "MAX_TRADES_REACHED",
      "ROUTINE_INCOMPLETE",
      "REVIEW_PENDING",
      "LOGGED_BEFORE_READY",
    ]);
    expect(w[2].message).toBe("2 mandatory routine items left");
    expect(
      buildStatusWarnings({
        archived: true,
        ready: false,
        mandatoryRemaining: 2,
        risk: "OVER",
        trades: "OVER",
        reviewPendingCount: 3,
        loggedBeforeReadyCount: 1,
      }),
    ).toEqual([]);
  });

  it("carried open positions raise a warning ahead of informational notices", () => {
    const w = buildStatusWarnings({
      archived: false,
      ready: true,
      mandatoryRemaining: 0,
      risk: "WITHIN",
      trades: "WITHIN",
      reviewPendingCount: 1,
      loggedBeforeReadyCount: 0,
      carriedOpenCount: 2,
    });
    expect(w.map((x) => x.code)).toEqual(["CARRIED_OPEN", "REVIEW_PENDING"]);
    expect(w[0].message).toBe("2 open positions carried from an earlier day");
  });

  it("logged-before-readiness compares createdAt with routineReadyAt", () => {
    expect(loggedBeforeReadiness("2026-10-02T07:00:00Z", null)).toBe(true);
    expect(loggedBeforeReadiness("2026-10-02T07:00:00Z", "2026-10-02T07:30:00Z")).toBe(true);
    expect(loggedBeforeReadiness("2026-10-02T08:00:00Z", "2026-10-02T07:30:00Z")).toBe(false);
  });
});
