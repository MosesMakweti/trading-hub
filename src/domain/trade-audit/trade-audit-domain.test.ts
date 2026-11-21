import { describe, expect, it } from "vitest";

import { auditDays, auditScopeKey, auditWeekFor, defaultAuditWeekStart, inScope, isInWeek } from "@/domain/trade-audit/week";
import { changedFields, detectAssessmentChanges, detectFinalizedDrift, tradeFingerprint } from "@/domain/trade-audit/fingerprint";
import { buildWeeklySummary } from "@/domain/trade-audit/summary";
import type { PreparationScheduleVersion } from "@/domain/discipline/preparation-schedule";
import type { AuditTradeDTO } from "@/types/trade-audit";

function version(weekdays: number[], effectiveFrom = "2026-01-01"): PreparationScheduleVersion {
  return {
    id: `v-${weekdays.join("")}`,
    effectiveFrom,
    timezone: "Europe/London",
    targetMinutes: 8 * 60,
    weekdays,
    rules: { cutoffAfterTargetMinutes: 60, cutoffCapLocalMinutes: 12 * 60 } as PreparationScheduleVersion["rules"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function trade(overrides: Partial<AuditTradeDTO> = {}): AuditTradeDTO {
  return {
    id: "t1",
    tradeNumber: 7,
    dateKey: "2026-11-16",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyId: "s1",
    strategyName: "London Sweep",
    setupName: null,
    session: "London",
    timeframe: "15m",
    entryTime: "09:30",
    closedAt: null,
    plannedEntry: 2400,
    plannedStopLoss: 2390,
    plannedTarget: 2430,
    actualEntry: 2401,
    actualStopLoss: 2390,
    actualExit: 2425,
    positionSize: null,
    risk: "1.00%",
    plannedR: 3,
    realizedR: 2.2,
    pnl: 220,
    outcome: "WIN",
    reasonForTrade: null,
    executionNotes: null,
    systemFlags: [],
    images: [],
    ...overrides,
  };
}

describe("week boundaries", () => {
  it("resolves any day to its Monday–Sunday week", () => {
    expect(auditWeekFor("2026-11-19")).toEqual({ weekStart: "2026-11-16", weekEnd: "2026-11-22" });
    expect(auditWeekFor("2026-11-22")).toEqual({ weekStart: "2026-11-16", weekEnd: "2026-11-22" }); // Sunday stays in its week
    expect(auditWeekFor("2026-11-23")).toEqual({ weekStart: "2026-11-23", weekEnd: "2026-11-29" });
  });

  it("handles a week spanning a month and a year boundary", () => {
    expect(auditWeekFor("2026-12-31")).toEqual({ weekStart: "2026-12-28", weekEnd: "2027-01-03" });
    expect(isInWeek(auditWeekFor("2026-12-31"), "2027-01-02")).toBe(true);
    expect(isInWeek(auditWeekFor("2026-12-31"), "2027-01-04")).toBe(false);
    expect(isInWeek(auditWeekFor("2026-12-31"), "not-a-date")).toBe(false);
  });

  it("defaults to the most recently COMPLETED week (weekend → this week, weekday → last week)", () => {
    const monFri = [version([1, 2, 3, 4, 5])];
    expect(defaultAuditWeekStart("2026-11-21", monFri)).toBe("2026-11-16"); // Saturday
    expect(defaultAuditWeekStart("2026-11-22", monFri)).toBe("2026-11-16"); // Sunday
    expect(defaultAuditWeekStart("2026-11-20", monFri)).toBe("2026-11-09"); // Friday — still trading
    expect(defaultAuditWeekStart("2026-11-17", monFri)).toBe("2026-11-09"); // Tuesday
  });

  it("respects a trader whose week ends earlier (Mon–Thu): Friday already reviews this week", () => {
    expect(defaultAuditWeekStart("2026-11-20", [version([1, 2, 3, 4])])).toBe("2026-11-16");
  });

  it("falls back to Mon–Fri when the trader has no schedule", () => {
    expect(defaultAuditWeekStart("2026-11-21", [])).toBe("2026-11-16");
    expect(auditDays("2026-11-16", [], [], []).map((d) => d.dateKey)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  });
});

describe("audit days follow the trader's calendar", () => {
  it("shows only scheduled days, but never hides a day with activity", () => {
    const days = auditDays("2026-11-16", [version([2, 3, 4])], [], ["2026-11-21"]);
    expect(days.map((d) => [d.dateKey, d.schedule])).toEqual([
      ["2026-11-17", "SCHEDULED"],
      ["2026-11-18", "SCHEDULED"],
      ["2026-11-19", "SCHEDULED"],
      ["2026-11-21", "UNSCHEDULED"], // a Saturday trade still appears
    ]);
  });

  it("keeps a DAY_OFF visible (labelled) rather than dropping it", () => {
    const days = auditDays(
      "2026-11-16",
      [version([1, 2, 3, 4, 5])],
      [{ dateKey: "2026-11-18", kind: "DAY_OFF", createdAt: new Date("2026-11-10T00:00:00Z") }],
      [],
    );
    expect(days.find((d) => d.dateKey === "2026-11-18")?.schedule).toBe("DAY_OFF");
    expect(days).toHaveLength(5);
  });
});

describe("scope", () => {
  it("normalizes the scope key so asset order/case never creates a second audit", () => {
    expect(auditScopeKey(null, [])).toBe("*|*");
    expect(auditScopeKey("s1", ["eurusd", "XAUUSD", "EURUSD "])).toBe("s1|EURUSD,XAUUSD");
    expect(auditScopeKey("s1", ["XAUUSD", "EURUSD"])).toBe(auditScopeKey("s1", ["eurusd", "xauusd"]));
  });

  it("filters trades by strategy and instrument", () => {
    expect(inScope({ strategyId: null, assetSymbols: [] }, { strategyId: "x", assetSymbol: "GBPUSD" })).toBe(true);
    expect(inScope({ strategyId: "s1", assetSymbols: [] }, { strategyId: "s2", assetSymbol: "XAUUSD" })).toBe(false);
    expect(inScope({ strategyId: null, assetSymbols: ["XAUUSD"] }, { strategyId: null, assetSymbol: "xauusd" })).toBe(true);
    expect(inScope({ strategyId: null, assetSymbols: ["XAUUSD"] }, { strategyId: null, assetSymbol: "EURUSD" })).toBe(false);
  });
});

describe("change detection", () => {
  it("ignores cosmetic edits but flags decision-relevant ones", () => {
    const fp = tradeFingerprint(trade());
    expect(changedFields(fp, trade({ executionNotes: "edited later", images: [] }))).toEqual([]);
    expect(changedFields(fp, trade({ actualExit: 2410, realizedR: 0.8, pnl: 80 }))).toEqual(["exit", "result (R)", "P&L"]);
  });

  it("classifies edited, moved and removed trades for an in-progress audit", () => {
    const fp = tradeFingerprint(trade());
    const base = { tradeId: "t1", dateKey: "2026-11-16", tradeFingerprint: fp, snapshotLabel: "#7 XAUUSD long" };
    expect(detectAssessmentChanges([base], new Map([["t1", trade()]])).size).toBe(0);
    expect(detectAssessmentChanges([base], new Map([["t1", trade({ actualEntry: 2405 })]])).get("2026-11-16")?.[0].kind).toBe("EDITED");
    const moved = detectAssessmentChanges([base], new Map([["t1", trade({ dateKey: "2026-11-17" })]]));
    expect(moved.get("2026-11-17")?.[0]).toMatchObject({ kind: "MOVED", fields: ["date"] });
    expect(detectAssessmentChanges([base], new Map()).get("2026-11-16")?.[0].kind).toBe("REMOVED");
  });

  it("reports drift against a finalized snapshot, including trades added afterwards", () => {
    const drift = detectFinalizedDrift([trade()], [trade({ pnl: 999 }), trade({ id: "t2", tradeNumber: 8 })]);
    expect(drift.get("2026-11-16")?.map((c) => c.kind).sort()).toEqual(["ADDED", "EDITED"]);
  });
});

describe("weekly summary — decision quality over profit", () => {
  it("puts a profitable rule-break in 'bad process, good outcome' and a losing valid trade in 'good process, bad outcome'", () => {
    const summary = buildWeeklySummary({
      trades: [
        { id: "win-invalid", outcome: "WIN", realizedR: 2, pnl: 200, systemFlagCount: 1 },
        { id: "loss-valid", outcome: "LOSS", realizedR: -1, pnl: -100, systemFlagCount: 0 },
        { id: "win-valid", outcome: "WIN", realizedR: 3, pnl: 300, systemFlagCount: 0 },
        { id: "open", outcome: "PENDING", realizedR: null, pnl: null, systemFlagCount: 0 },
      ],
      assessments: [
        { tradeId: "win-invalid", verdict: "INVALID", invalidReasons: ["EARLY_ENTRY"], executionIssues: [], executionQuality: 2, weaknesses: ["IMPATIENCE"] },
        { tradeId: "loss-valid", verdict: "VALID", invalidReasons: [], executionIssues: ["PREMATURE_EXIT"], executionQuality: 4, weaknesses: [] },
        { tradeId: "win-valid", verdict: "VALID", invalidReasons: [], executionIssues: [], executionQuality: 5, weaknesses: [] },
      ],
      misses: [{ missReason: "HESITATION", weaknesses: ["IMPATIENCE"], retrospective: true }],
      days: [{ status: "COMPLETED" }, { status: "IN_PROGRESS" }, { status: "NOT_STARTED" }],
    });

    expect(summary.matrix.badProcessGoodOutcome).toEqual({ count: 1, r: 2 });
    expect(summary.matrix.goodProcessBadOutcome).toEqual({ count: 1, r: -1 });
    expect(summary.matrix.goodProcessGoodOutcome).toEqual({ count: 1, r: 3 });
    expect(summary.judged).toEqual({ valid: 2, invalid: 1, unsure: 0, unassessed: 1 });
    expect(summary.ruleViolations).toBe(1);
    expect(summary.systemFlaggedTrades).toBe(1);
    expect(summary.trades).toMatchObject({ executed: 4, wins: 2, losses: 1, pending: 1, netR: 4 });
    expect(summary.missed).toMatchObject({ total: 1, retrospective: 1, live: 0 });
    expect(summary.weaknesses[0]).toMatchObject({ key: "IMPATIENCE", count: 2, repeated: true });
    expect(summary.days).toEqual({ total: 3, completed: 1, inProgress: 1 });
    expect(summary.drafts.decisionSummary).toContain("broke the rules");
    expect(summary.drafts.biggestWeakness).toContain("Impatience");
    expect(summary.drafts.recurringPatterns).toContain("Impatience ×2");
  });

  it("produces honest empty drafts when nothing has been judged", () => {
    const summary = buildWeeklySummary({ trades: [], assessments: [], misses: [], days: [] });
    expect(summary.drafts.executionSummary).toBe("No trades were executed this week.");
    expect(summary.drafts.strongestArea).toContain("Not enough");
    expect(summary.trades.netPnl).toBeNull();
  });
});
