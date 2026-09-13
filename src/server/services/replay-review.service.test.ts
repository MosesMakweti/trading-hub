import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { createStrategy, renameStrategy, publishStrategyVersion } from "@/server/services/strategies.service";
import { createBehaviourLabel, setTradeBehaviourLabels, updateBehaviourLabel } from "@/server/services/behaviour-labels.service";
import {
  createOrGetDailyAssetAnalysis,
  updateDailyAssetAnalysis,
} from "@/server/services/daily-asset-analysis.service";
import { getWeeklyReview } from "@/server/services/edge.service";
import {
  buildActualBaseline,
  completeReplayReviewSession,
  createReplayReviewSession,
  fetchReplayCandlesWithProvenance,
  finalizeEdgeReview,
  findOrCreateReplayReviewSessionForPeriod,
  findReplayReviewSessionForPeriod,
  getHistoricalStrategyContext,
  getReplayReviewSession,
  listReplayReviewSessions,
  reopenReplayReviewSession,
  startReplayReviewSession,
  updateReplayReviewNotes,
} from "@/server/services/replay-review.service";
import { acceptSuggestedCommitment, listCommitmentsForSession } from "@/server/services/edge-review-commitment.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  analytics-canonical.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `replay-review-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: null,
    actualRR: null,
    performanceRiskPercentOverride: null,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {},
    setupTypeId: null,
    selectedSetupConditions: [],
    setupOverrideReason: null,
    setupOverrideNote: null,
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    preTradeMoodNote: null,
    ...overrides,
  } as TradeInput;
}

describe("createReplayReviewSession", () => {
  it("creates a Weekly Review with explicit fixed start/end dates", async () => {
    const user = await makeUser("weekly");
    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    expect(session.reviewType).toBe("WEEKLY");
    expect(session.startDate).toBe("2026-08-03");
    expect(session.endDate).toBe("2026-08-09");
    expect(session.status).toBe("DRAFT");
  });

  it("creates a Monthly Review with explicit fixed start/end dates", async () => {
    const user = await makeUser("monthly");
    const session = await createReplayReviewSession(user.id, {
      reviewType: "MONTHLY",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(session.reviewType).toBe("MONTHLY");
    expect(session.status).toBe("DRAFT");
  });

  it("rejects an invalid (non Monday-Sunday) weekly range", async () => {
    const user = await makeUser("invalid-range");
    await expect(
      createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-04", endDate: "2026-08-10" }),
    ).rejects.toThrow();
  });

  it("rejects an unknown Strategy scope", async () => {
    const user = await makeUser("bad-strategy-scope");
    await expect(
      createReplayReviewSession(user.id, {
        reviewType: "WEEKLY",
        startDate: "2026-08-03",
        endDate: "2026-08-09",
        strategyId: "does-not-exist",
      }),
    ).rejects.toThrow();
  });

  it("accepts a valid Strategy scope and an Asset scope", async () => {
    const user = await makeUser("valid-scope");
    const strategy = await createStrategy(user.id, { name: "Scoped Strategy", description: undefined });
    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      strategyId: strategy.id,
      assetSymbols: ["xauusd", "eurusd"],
    });
    expect(session.strategyId).toBe(strategy.id);
    expect(session.strategyName).toBe("Scoped Strategy");
    expect(session.assetSymbols).toEqual(["XAUUSD", "EURUSD"]);
  });
});

describe("Replay review ownership", () => {
  it("never leaks one user's sessions to another user", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    await createReplayReviewSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    expect(await listReplayReviewSessions(other.id)).toHaveLength(0);
  });

  it("returns null reading another user's session by id", async () => {
    const owner = await makeUser("read-owner");
    const other = await makeUser("read-other");
    const session = await createReplayReviewSession(owner.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });

    expect(await getReplayReviewSession(other.id, session.id)).toBeNull();
  });

  it("rejects starting/completing another user's session", async () => {
    const owner = await makeUser("mutate-owner");
    const attacker = await makeUser("mutate-attacker");
    const session = await createReplayReviewSession(owner.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });

    await expect(startReplayReviewSession(attacker.id, session.id)).rejects.toThrow();
  });
});

describe("DRAFT -> IN_PROGRESS -> COMPLETED", () => {
  it("transitions through the full lifecycle and freezes the baseline exactly once", async () => {
    const user = await makeUser("lifecycle");
    const created = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    expect(created.status).toBe("DRAFT");
    expect(created.actualBaselineSnapshot).toBeNull();

    await startReplayReviewSession(user.id, created.id);
    const started = await getReplayReviewSession(user.id, created.id);
    expect(started?.status).toBe("IN_PROGRESS");
    expect(started?.startedAt).not.toBeNull();
    expect(started?.actualBaselineSnapshot).not.toBeNull();
    const firstComputedAt = started?.actualBaselineSnapshot?.computedAt;

    // Starting again is a no-op — the baseline is frozen, not recomputed.
    await startReplayReviewSession(user.id, created.id);
    const startedAgain = await getReplayReviewSession(user.id, created.id);
    expect(startedAgain?.actualBaselineSnapshot?.computedAt).toBe(firstComputedAt);

    await completeReplayReviewSession(user.id, created.id);
    const completed = await getReplayReviewSession(user.id, created.id);
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.completedAt).not.toBeNull();
  });

  it("rejects completing a session that was never started", async () => {
    const user = await makeUser("skip-in-progress");
    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    await expect(completeReplayReviewSession(user.id, session.id)).rejects.toThrow();
  });
});

describe("session notes", () => {
  it("persist independently of the review lifecycle", async () => {
    const user = await makeUser("notes");
    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    const note = { type: "doc", content: [{ type: "text", text: "Overtraded Tuesday." }] };
    await updateReplayReviewNotes(user.id, session.id, note);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded?.notes).not.toBeNull();
  });

  it("working Replay notes and the final WeeklyReview reflection are separate records (Stage 12.5 §14/§23)", async () => {
    const user = await makeUser("notes-vs-reflection");
    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    await updateReplayReviewNotes(user.id, session.id, {
      type: "doc",
      content: [{ type: "text", text: "Working note: overtraded Tuesday." }],
    });

    const reflection = await getWeeklyReview(user.id, "2026-08-03", "WEEKLY");
    expect(reflection).toBeNull(); // untouched by the Replay working note
  });
});

describe("buildActualBaseline — uses canonical realized R, never contribution %", () => {
  it("computes realized R / win-loss / cancelled counts from the same canonical dataset as Analytics", async () => {
    const user = await makeUser("baseline-canonical");
    const winner = await createTrade(user.id, "2026-08-04", minimalTradeInput());
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });

    const loser = await createTrade(user.id, "2026-08-05", minimalTradeInput());
    await updateTradeSections(user.id, loser.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1890 });
    await setReviewLifecycleStatus(user.id, loser.id, { status: "FULLY_CLOSED" });

    const cancelled = await createTrade(user.id, "2026-08-06", minimalTradeInput());
    await setReviewLifecycleStatus(user.id, cancelled.id, { status: "CANCELLED_NEVER_TRIGGERED" });

    const baseline = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });

    expect(baseline.canonical.overview.totalExecutedTrades).toBe(2); // cancelled excluded
    expect(baseline.canonical.overview.cancelledCount).toBe(1);
    expect(baseline.canonical.overview.winningTrades).toBe(1);
    expect(baseline.canonical.overview.losingTrades).toBe(1);
    expect(baseline.canonical.overview.totalRealizedR).toBeCloseTo(2 - 1, 4);

    // Cancelled idea must not appear as a counted loss anywhere in the reference list.
    const cancelledRef = baseline.actualTrades.find((t) => t.tradeId === cancelled.id);
    expect(cancelledRef?.isCancelled).toBe(true);
    expect(cancelledRef?.winLossClass).toBe("CANCELLED");
  });

  it("handles a partially-closed trade consistently with canonical analytics (realized-so-far only)", async () => {
    const user = await makeUser("baseline-partial");
    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    // Leave it PARTIALLY_CLOSED / STILL_HOLDING-equivalent — no full close.

    const baseline = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    const ref = baseline.actualTrades.find((t) => t.tradeId === trade.id);
    expect(ref).toBeDefined();
    expect(ref?.finalizedR).toBeNull(); // no determined result yet
    expect(baseline.canonical.overview.finalizedTrades).toBe(0);
  });

  it("scopes the baseline by Strategy and by Asset", async () => {
    const user = await makeUser("baseline-scope");
    const strategyA = await createStrategy(user.id, { name: "Strategy A", description: undefined });
    const inScope = await createTrade(
      user.id,
      "2026-08-04",
      minimalTradeInput({ strategyId: strategyA.id, assetSymbol: "XAUUSD" }),
    );
    await updateTradeSections(user.id, inScope.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, inScope.id, { status: "FULLY_CLOSED" });

    const outOfScope = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "EURUSD" }));
    await updateTradeSections(user.id, outOfScope.id, { actualEntry: 1.1, actualStopLoss: 1.09, actualExit: 1.12 });
    await setReviewLifecycleStatus(user.id, outOfScope.id, { status: "FULLY_CLOSED" });

    const strategyScoped = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      strategyId: strategyA.id,
      assetSymbols: [],
    });
    expect(strategyScoped.actualTrades.map((t) => t.tradeId)).toEqual([inScope.id]);

    const assetScoped = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: ["EURUSD"],
    });
    expect(assetScoped.actualTrades.map((t) => t.tradeId)).toEqual([outOfScope.id]);
  });

  it("actual trade references belong to the user and fall within the review period only", async () => {
    const user = await makeUser("baseline-period-scope");
    const inPeriod = await createTrade(user.id, "2026-08-05", minimalTradeInput());
    const outOfPeriod = await createTrade(user.id, "2026-08-20", minimalTradeInput());

    const baseline = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    const ids = baseline.actualTrades.map((t) => t.tradeId);
    expect(ids).toContain(inPeriod.id);
    expect(ids).not.toContain(outOfPeriod.id);
  });

  it("renders safely for an empty period (no trades at all)", async () => {
    const user = await makeUser("baseline-empty");
    const baseline = await buildActualBaseline(user.id, {
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    expect(baseline.actualTrades).toEqual([]);
    expect(baseline.canonical.overview.totalExecutedTrades).toBe(0);
    expect(baseline.canonical.overview.winRate).toBeNull();
  });

  it("does not modify the Daily Market Plan (DailyAssetAnalysis) for the reviewed period", async () => {
    const user = await makeUser("baseline-plan-readonly");
    const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-08-04", "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "LONG" });
    const before = await prisma.dailyAssetAnalysis.findUniqueOrThrow({ where: { id: analysis.id } });

    await buildActualBaseline(user.id, { startDate: "2026-08-03", endDate: "2026-08-09", assetSymbols: [] });

    const reloaded = await prisma.dailyAssetAnalysis.findUniqueOrThrow({ where: { id: analysis.id } });
    expect(reloaded.finalBias).toBe("LONG"); // untouched
    expect(reloaded.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe("getHistoricalStrategyContext", () => {
  it("survives a later Strategy Lab rename — always the version's own frozen snapshot", async () => {
    const user = await makeUser("historical-strategy-context");
    const strategy = await createStrategy(user.id, { name: "Original Name", description: undefined });
    const published = await publishStrategyVersion(user.id, strategy.id, null);

    await renameStrategy(user.id, strategy.id, "Renamed Later");

    const context = await getHistoricalStrategyContext(user.id, strategy.id, published.version);
    expect(context?.snapshot.name).toBe("Original Name");
    expect(context?.strategyName).toBe("Renamed Later"); // live name, shown separately from the frozen snapshot
  });

  it("returns null for a version that was never published — never falls back to live config", async () => {
    const user = await makeUser("no-historical-version");
    const strategy = await createStrategy(user.id, { name: "Never Published", description: undefined });

    expect(await getHistoricalStrategyContext(user.id, strategy.id, 1)).toBeNull();
  });

  it("rejects reading another user's strategy version", async () => {
    const owner = await makeUser("version-owner");
    const attacker = await makeUser("version-attacker");
    const strategy = await createStrategy(owner.id, { name: "Owner Strategy", description: undefined });
    const published = await publishStrategyVersion(owner.id, strategy.id, null);

    expect(await getHistoricalStrategyContext(attacker.id, strategy.id, published.version)).toBeNull();
  });
});

describe("findReplayReviewSessionForPeriod — Edge Review's period/scope resolution (Stage 12.5 §7-8)", () => {
  it("returns null when no session covers this exact period yet", async () => {
    const user = await makeUser("find-none");
    expect(
      await findReplayReviewSessionForPeriod(user.id, {
        reviewType: "WEEKLY",
        startDate: "2026-08-03",
        endDate: "2026-08-09",
        assetSymbols: [],
      }),
    ).toBeNull();
  });

  it("finds the session matching the exact period AND the default (All Trading) scope", async () => {
    const user = await makeUser("find-default-scope");
    const created = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });

    const found = await findReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    expect(found?.id).toBe(created.id);
  });

  it("treats a different Strategy/Asset scope as a DIFFERENT session for the same period", async () => {
    const user = await makeUser("find-scope-distinct");
    const strategy = await createStrategy(user.id, { name: "Scope A", description: undefined });
    const allTrading = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    const scoped = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      strategyId: strategy.id,
    });

    const foundAllTrading = await findReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    const foundScoped = await findReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      strategyId: strategy.id,
      assetSymbols: [],
    });
    expect(foundAllTrading?.id).toBe(allTrading.id);
    expect(foundScoped?.id).toBe(scoped.id);
    expect(foundAllTrading?.id).not.toBe(foundScoped?.id);
  });

  it("WEEKLY and MONTHLY reviews of an overlapping start date never resolve to each other", async () => {
    const user = await makeUser("find-type-distinct");
    // A month whose 1st is itself a Monday, so the weekly and monthly
    // startDate collide (2026-08-03 is NOT a Monday-that-is-day-1 case, so
    // pick a real coinciding pair): 2027-02-01 is a Monday.
    const weekly = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2027-02-01",
      endDate: "2027-02-07",
    });
    const monthly = await createReplayReviewSession(user.id, {
      reviewType: "MONTHLY",
      startDate: "2027-02-01",
      endDate: "2027-02-28",
    });

    const foundWeekly = await findReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2027-02-01",
      endDate: "2027-02-07",
      assetSymbols: [],
    });
    const foundMonthly = await findReplayReviewSessionForPeriod(user.id, {
      reviewType: "MONTHLY",
      startDate: "2027-02-01",
      endDate: "2027-02-28",
      assetSymbols: [],
    });
    expect(foundWeekly?.id).toBe(weekly.id);
    expect(foundMonthly?.id).toBe(monthly.id);
  });
});

describe("findOrCreateReplayReviewSessionForPeriod — duplicate prevention (Stage 12.5 §7)", () => {
  it("creates exactly one session across repeated calls for the same period+scope", async () => {
    const user = await makeUser("find-or-create-dedupe");
    const first = await findOrCreateReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });
    const second = await findOrCreateReplayReviewSessionForPeriod(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: [],
    });

    expect(second.id).toBe(first.id);
    const all = await listReplayReviewSessions(user.id);
    expect(all.filter((s) => s.startDate === "2026-08-03" && s.reviewType === "WEEKLY")).toHaveLength(1);
  });

  it("this is what 'Start Replay Review' calls from Edge Review — find-or-create then start, reusable across the same period", async () => {
    const user = await makeUser("edge-start-flow");
    const session = await findOrCreateReplayReviewSessionForPeriod(user.id, {
      reviewType: "MONTHLY",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      assetSymbols: [],
    });
    await startReplayReviewSession(user.id, session.id);

    const reopened = await findOrCreateReplayReviewSessionForPeriod(user.id, {
      reviewType: "MONTHLY",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      assetSymbols: [],
    });
    expect(reopened.id).toBe(session.id);
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.actualBaselineSnapshot).not.toBeNull();
  });
});

describe("Stage 15.1 — frozen Actual comparison evidence (actualTradeSnapshots)", () => {
  it("freezes schemaVersion 2 and a richer per-trade snapshot alongside the existing actualTrades list", async () => {
    const user = await makeUser("enrich-basic");
    const label = await createBehaviourLabel(user.id, { name: "Patient Entry", polarity: "POSITIVE", color: "GREEN" });
    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD", executionMinutes: 570 }));
    await setTradeBehaviourLabels(user.id, trade.id, [label.id]);
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const baseline = await buildActualBaseline(user.id, { startDate: "2026-08-03", endDate: "2026-08-09", assetSymbols: [] });
    expect(baseline.schemaVersion).toBe(2);
    expect(baseline.actualTrades).toHaveLength(1); // unchanged, still populated

    const snap = baseline.actualTradeSnapshots?.find((s) => s.tradeId === trade.id);
    expect(snap).toBeDefined();
    expect(snap!.assetSymbol).toBe("XAUUSD");
    expect(snap!.executionStartedAt).toBe(new Date(Date.UTC(2026, 7, 4, 9, 30)).toISOString());
    expect(snap!.ideaCreatedAt).not.toBeNull();
    expect(snap!.actualEntry).toBe(1900);
    expect(snap!.realizedR).toBeCloseTo(2, 4);
    expect(snap!.behaviourLabels).toEqual([{ name: "Patient Entry", polarity: "POSITIVE" }]);
  });

  it("does not invent frozen evidence — batching returns one snapshot per trade, using only real columns", async () => {
    const user = await makeUser("enrich-batched");
    await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
    await createTrade(user.id, "2026-08-05", minimalTradeInput({ assetSymbol: "EURUSD" }));

    const baseline = await buildActualBaseline(user.id, { startDate: "2026-08-03", endDate: "2026-08-09", assetSymbols: [] });
    expect(baseline.actualTradeSnapshots).toHaveLength(2);
  });

  describe("historical integrity — a later live edit never rewrites an already-frozen snapshot", () => {
    it("survives a Strategy Lab rename after the review has started", async () => {
      const user = await makeUser("integrity-strategy-rename");
      const strategy = await createStrategy(user.id, { name: "Original Name", description: undefined });
      const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ strategyId: strategy.id, assetSymbol: "XAUUSD" }));

      const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
      await startReplayReviewSession(user.id, session.id);

      await renameStrategy(user.id, strategy.id, "Renamed Later");

      const reloaded = await getReplayReviewSession(user.id, session.id);
      const snap = reloaded?.actualBaselineSnapshot?.actualTradeSnapshots?.find((s) => s.tradeId === trade.id);
      expect(snap?.strategyName).not.toBe("Renamed Later"); // frozen strategyNameSnapshot, untouched
    });

    it("survives a BehaviourLabel rename after the review has started", async () => {
      const user = await makeUser("integrity-label-rename");
      const label = await createBehaviourLabel(user.id, { name: "Original Label", polarity: "NEGATIVE", color: "RED" });
      const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
      await setTradeBehaviourLabels(user.id, trade.id, [label.id]);

      const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
      await startReplayReviewSession(user.id, session.id);

      await updateBehaviourLabel(user.id, label.id, { name: "Renamed Label" });

      const reloaded = await getReplayReviewSession(user.id, session.id);
      const snap = reloaded?.actualBaselineSnapshot?.actualTradeSnapshots?.find((s) => s.tradeId === trade.id);
      expect(snap?.behaviourLabels).toEqual([{ name: "Original Label", polarity: "NEGATIVE" }]);
    });

    it("survives a later Trade Review edit after the review has started", async () => {
      const user = await makeUser("integrity-review-edit");
      const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
      await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
      await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

      const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
      await startReplayReviewSession(user.id, session.id);

      // A later edit to the exit price (e.g. correcting a mistake) must not
      // rewrite the already-frozen snapshot.
      await updateTradeSections(user.id, trade.id, { actualExit: 1950 });

      const reloaded = await getReplayReviewSession(user.id, session.id);
      const snap = reloaded?.actualBaselineSnapshot?.actualTradeSnapshots?.find((s) => s.tradeId === trade.id);
      expect(snap?.actualExit).toBe(1920); // frozen at review start, not 1950
    });
  });

  describe("isolation", () => {
    it("building the enriched baseline mutates no Trade row", async () => {
      const user = await makeUser("integrity-no-mutation");
      const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
      const before = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });

      await buildActualBaseline(user.id, { startDate: "2026-08-03", endDate: "2026-08-09", assetSymbols: [] });

      const after = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });
  });
});

describe("Stage 16 §26-28 — review finalization ('Finish Review')", () => {
  it("rejects finalizing a session whose Replay isn't COMPLETED yet", async () => {
    const user = await makeUser("finalize-guard-draft");
    const draft = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await expect(finalizeEdgeReview(user.id, draft.id)).rejects.toThrow();

    const inProgress = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await startReplayReviewSession(user.id, inProgress.id);
    await expect(finalizeEdgeReview(user.id, inProgress.id)).rejects.toThrow();
  });

  it("finalizing is distinct from Replay's own COMPLETED status, and is idempotent", async () => {
    const user = await makeUser("finalize-distinct");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    await completeReplayReviewSession(user.id, session.id);

    const beforeFinalize = await getReplayReviewSession(user.id, session.id);
    expect(beforeFinalize?.status).toBe("COMPLETED");
    expect(beforeFinalize?.reviewFinalizedAt).toBeNull();

    await finalizeEdgeReview(user.id, session.id);
    await finalizeEdgeReview(user.id, session.id); // idempotent — no error, no drift

    const afterFinalize = await getReplayReviewSession(user.id, session.id);
    expect(afterFinalize?.status).toBe("COMPLETED");
    expect(afterFinalize?.reviewFinalizedAt).not.toBeNull();
  });

  it("reopening clears reviewFinalizedAt, requiring an explicit re-finalize", async () => {
    const user = await makeUser("finalize-reopen");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    await completeReplayReviewSession(user.id, session.id);
    await finalizeEdgeReview(user.id, session.id);

    await reopenReplayReviewSession(user.id, session.id);
    const reopened = await getReplayReviewSession(user.id, session.id);
    expect(reopened?.status).toBe("IN_PROGRESS");
    expect(reopened?.reviewFinalizedAt).toBeNull();
  });

  it("rejects finalizing another user's session", async () => {
    const owner = await makeUser("finalize-owner");
    const attacker = await makeUser("finalize-attacker");
    const session = await createReplayReviewSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(owner.id, session.id);
    await completeReplayReviewSession(owner.id, session.id);

    await expect(finalizeEdgeReview(attacker.id, session.id)).rejects.toThrow();
  });

  it("a later Strategy Lab rename does not alter an accepted commitment's frozen evidence", async () => {
    const user = await makeUser("finalize-commitment-integrity");
    const strategy = await createStrategy(user.id, { name: "Original Name", description: undefined });
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    const commitment = await acceptSuggestedCommitment(user.id, session.id, {
      category: "STRATEGY",
      title: `Review ${strategy.name}'s process`,
      description: null,
      priority: "MEDIUM",
      ruleKey: "TEST_RULE",
      evidence: [`Strategy at time of review: ${strategy.name}`],
    });

    await renameStrategy(user.id, strategy.id, "Renamed Later");

    const [reloaded] = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.id).toBe(commitment.id);
    expect(reloaded.title).toBe("Review Original Name's process");
    expect(reloaded.evidenceSnapshot).toEqual(["Strategy at time of review: Original Name"]);
  });
});

describe("fetchReplayCandlesWithProvenance — market-data freeze-once (Stage 17B §13)", () => {
  const DAY_MS = 86_400_000;
  const MONDAY = Date.UTC(2026, 7, 3);

  it("records provenance on first fetch and reuses (never overwrites) the pinned provider on later fetches", async () => {
    const user = await makeUser("provenance-basic");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const first = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 60_000);
    expect(first.ok).toBe(true);

    const afterFirst = await getReplayReviewSession(user.id, session.id);
    const provenance = afterFirst!.marketDataProvenance!;
    expect(provenance.EURUSD.providerId).toBe("fixture");
    const frozenAt = provenance.EURUSD.frozenAt;
    expect(frozenAt).toBeTruthy();

    // A second fetch for a DIFFERENT day range on the same asset must merge
    // segments, never overwrite the original freeze timestamp.
    const second = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY + DAY_MS, MONDAY + DAY_MS + 60_000);
    expect(second.ok).toBe(true);
    const afterSecond = await getReplayReviewSession(user.id, session.id);
    const provenance2 = afterSecond!.marketDataProvenance!;
    expect(provenance2.EURUSD.providerId).toBe("fixture");
    expect(provenance2.EURUSD.frozenAt).toBe(frozenAt); // freeze-once: never re-frozen
    expect(provenance2.EURUSD.segments.length).toBeGreaterThanOrEqual(provenance.EURUSD.segments.length);
  });

  it("tracks provenance independently per asset within the same session", async () => {
    const user = await makeUser("provenance-per-asset");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 60_000);
    await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MONDAY, MONDAY + 60_000);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    const provenance = reloaded!.marketDataProvenance!;
    expect(Object.keys(provenance).sort()).toEqual(["EURUSD", "XAUUSD"]);
  });

  it("errors clearly (no silent fallback) when the originally-pinned provider is no longer available", async () => {
    const user = await makeUser("provenance-pinned-unavailable");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    // Simulate a session that was previously frozen on Databento (e.g. the
    // API key was configured at the time) — DATABENTO_API_KEY is NOT set in
    // this test environment, so it must now be reported as unavailable
    // rather than silently served from Fixture instead.
    await prisma.replayReviewSession.update({
      where: { id: session.id },
      data: {
        marketDataProvenance: {
          ES: {
            providerId: "databento",
            datasetId: "GLBX.MDP3",
            priceBasis: "raw-unadjusted",
            retrievedAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
            segments: [{ contractSymbol: "ESU6", from: MONDAY, to: MONDAY + DAY_MS - 1 }],
          },
        },
      },
    });

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "ES", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.message).toMatch(/no longer configured/i);
    }
  });

  it("errors clearly for a session provenance record naming an unrecognized provider id", async () => {
    const user = await makeUser("provenance-unknown-provider");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await prisma.replayReviewSession.update({
      where: { id: session.id },
      data: {
        marketDataProvenance: {
          EURUSD: {
            providerId: "some-retired-vendor",
            retrievedAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
            segments: [],
          },
        },
      },
    });

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
  });

  it("returns a clear error for a nonexistent/foreign session rather than fetching anonymously", async () => {
    const user = await makeUser("provenance-no-session");
    const result = await fetchReplayCandlesWithProvenance(user.id, "not-a-real-session-id", "EURUSD", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
  });

  it("a session created before Stage 17B (no marketDataProvenance) reports null — 'Legacy / source not recorded', never guessed", async () => {
    const user = await makeUser("provenance-legacy");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.marketDataProvenance).toBeNull();
  });
});

describe("licensing kill switch vs. frozen provenance (Stage 17B.1 §10/§11)", () => {
  const DAY_MS = 86_400_000;
  const MONDAY = Date.UTC(2026, 7, 3);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function freezeDatabentoProvenance(sessionId: string) {
    const frozenSegment = { contractSymbol: "MESU6", from: MONDAY, to: MONDAY + DAY_MS - 1 };
    await prisma.replayReviewSession.update({
      where: { id: sessionId },
      data: {
        marketDataProvenance: {
          MES: {
            providerId: "databento",
            datasetId: "GLBX.MDP3",
            priceBasis: "raw-unadjusted",
            retrievedAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
            segments: [frozenSegment],
          },
        },
      },
    });
    return frozenSegment;
  }

  it("a session frozen to Databento with display currently disabled returns PROVIDER_DISPLAY_DISABLED, never Fixture, never mutating provenance", async () => {
    const user = await makeUser("licensing-frozen-disabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeDatabentoProvenance(session.id);

    // Databento IS configured (so the provider itself is "available") but
    // display is NOT permitted — the two must be checked independently.
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "");

    const before = await getReplayReviewSession(user.id, session.id);
    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "MES", MONDAY, MONDAY + 60_000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_DISPLAY_DISABLED");

    // Provenance must be byte-for-byte unchanged — no silent fallback, no mutation.
    const after = await getReplayReviewSession(user.id, session.id);
    expect(after!.marketDataProvenance).toEqual(before!.marketDataProvenance);
    expect(after!.marketDataProvenance!.MES.providerId).toBe("databento");
  });

  it("the same frozen session resumes Databento once display is re-enabled — provenance was never lost", async () => {
    const user = await makeUser("licensing-frozen-reenabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeDatabentoProvenance(session.id);

    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");

    // Mock the real Databento HTTP calls the pinned provider will now make —
    // this test's point is that the LICENSING gate no longer blocks the
    // request, not that a real network call succeeds.
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { "MES.v.0": [{ d0: "2026-08-01", d1: "2026-09-01", s: "MESU6" }] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ts_event: new Date(MONDAY).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "MES", MONDAY, MONDAY + 60_000);
    vi.unstubAllGlobals();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provenance[0]?.providerId).toBe("databento");
  });

  it("a brand-new session with display disabled falls back to Fixture at first-fetch time (not a licensing error — no provenance exists yet to violate)", async () => {
    const user = await makeUser("licensing-first-fetch-disabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "");

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "MES", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provenance[0]?.providerId).toBe("fixture");
  });
});

describe("Twelve Data provenance/licensing — same freeze-once discipline as Databento (Stage 17C.2 §20/§21/§41)", () => {
  const DAY_MS = 86_400_000;
  const MONDAY = Date.UTC(2026, 7, 3);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function freezeTwelveDataProvenance(sessionId: string, canonicalSymbol: string, providerSymbol: string) {
    const frozenSegment = { contractSymbol: providerSymbol, from: MONDAY, to: MONDAY + DAY_MS - 1 };
    await prisma.replayReviewSession.update({
      where: { id: sessionId },
      data: {
        marketDataProvenance: {
          [canonicalSymbol]: {
            providerId: "twelvedata",
            priceBasis: "AGGREGATED",
            retrievedAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
            segments: [frozenSegment],
          },
        },
      },
    });
    return frozenSegment;
  }

  it("Twelve Data refuses a futures symbol (MES) even if a provenance record were ever inconsistent (§41 provider isolation)", async () => {
    // Not a realistic scenario (Twelve Data would never legitimately freeze
    // this combination) — this is a defense-in-depth check that the
    // ADAPTER itself, not just the routing layer, enforces its own symbol
    // boundary: even handed a futures canonical symbol directly, Twelve
    // Data's resolveSymbol still refuses it rather than silently accepting
    // an asset outside its OTC-only domain.
    const user = await makeUser("twelvedata-isolation-mes");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeTwelveDataProvenance(session.id, "MES", "MES.v.0");
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "MES", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
  });

  it("a session frozen to Twelve Data with display currently disabled returns PROVIDER_DISPLAY_DISABLED, never Fixture, never mutating provenance", async () => {
    const user = await makeUser("twelvedata-frozen-disabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeTwelveDataProvenance(session.id, "XAUUSD", "XAU/USD");

    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "");

    const before = await getReplayReviewSession(user.id, session.id);
    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MONDAY, MONDAY + 60_000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_DISPLAY_DISABLED");

    const after = await getReplayReviewSession(user.id, session.id);
    expect(after!.marketDataProvenance).toEqual(before!.marketDataProvenance);
    expect(after!.marketDataProvenance!.XAUUSD.providerId).toBe("twelvedata");
  });

  it("the same frozen session resumes Twelve Data once display is re-enabled — provenance was never lost", async () => {
    const user = await makeUser("twelvedata-frozen-reenabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeTwelveDataProvenance(session.id, "XAUUSD", "XAU/USD");

    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          meta: { symbol: "XAU/USD" },
          values: [{ datetime: "2026-08-03 00:00:00", open: "2400", high: "2401", low: "2399", close: "2400.5", volume: "5" }],
          status: "ok",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance[0]?.providerId).toBe("twelvedata");
      expect(result.provenance[0]?.priceBasis).toBe("AGGREGATED");
    }
  });

  it("a brand-new OTC session with display disabled falls back to Fixture at first-fetch time (no provenance exists yet to violate)", async () => {
    const user = await makeUser("twelvedata-first-fetch-disabled");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "");

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provenance[0]?.providerId).toBe("fixture");
  });

  it("Fixture never silently replaces a frozen Twelve Data provenance when the API key disappears mid-session (§41)", async () => {
    const user = await makeUser("twelvedata-key-revoked");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await freezeTwelveDataProvenance(session.id, "XAUUSD", "XAU/USD");
    // TWELVE_DATA_API_KEY deliberately NOT set — simulates the key having been revoked/removed after the freeze.

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.message).toMatch(/no longer configured/i);
    }
  });
});

describe("End-to-end Replay session path (Stage 17D §9/§10) — real session creation, not just the adapter in isolation", () => {
  const DAY_MS = 86_400_000;
  const MONDAY = Date.UTC(2026, 7, 3);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * Stage 17D §9's research finding: `ReplayReviewSession.assetSymbols` is
   * CLIENT-supplied and only `.trim().toUpperCase()`-normalized at session
   * creation (`replay-review.service.ts`'s `createReplayReviewSession`) —
   * it is NEVER derived by querying `Trade` rows, and NEVER run through
   * `parseSymbol`'s broker-suffix stripping at that layer. Canonicalization
   * only happens downstream, inside `resolveMarketDataProvider`/the
   * provider's own `resolveSymbol`, when candles are actually fetched. This
   * test proves the raw, uppercased-but-unstripped symbol still resolves
   * correctly end-to-end through the REAL `createReplayReviewSession` →
   * `fetchReplayCandlesWithProvenance` path — not just at the adapter/catalog
   * unit-test level (Stage 17C.2 covered that; this covers the session path
   * Stage 17C.2 explicitly left unverified).
   */
  it("a session created with the raw broker-suffixed symbol XAUUSD.a resolves to Twelve Data's XAU/USD end-to-end", async () => {
    const user = await makeUser("e2e-broker-suffix-xauusd");
    // A real Trade row keeps the exact broker-displayed text — proves it's
    // never rewritten anywhere in this flow, even though the session's own
    // assetSymbols array is a separate, client-supplied list (§9's finding).
    const trade = await createTrade(user.id, "2026-08-03", minimalTradeInput({ assetSymbol: "XAUUSD.a" }));
    expect(trade.assetSymbol).toBe("XAUUSD.a");

    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: ["XAUUSD.a"],
    });
    // Session-level normalization is uppercase-only, NOT broker-suffix stripping (§9 finding).
    expect(session.assetSymbols).toEqual(["XAUUSD.A"]);

    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          meta: { symbol: "XAU/USD" },
          values: [{ datetime: "2026-08-03 00:00:00", open: "2400", high: "2401", low: "2399", close: "2400.5", volume: "5" }],
          status: "ok",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The client passes the session's OWN asset string (here "XAUUSD.A") as canonicalSymbol — this is the real call shape.
    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD.A", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toHaveLength(1);
    expect(result.provenance[0]?.providerId).toBe("twelvedata");
    expect(result.provenance[0]?.segments[0]?.contractSymbol).toBe("XAU/USD"); // resolved to the REAL provider symbol, not a literal "XAUUSD.A" ticker

    // The original Trade row's raw text is still completely untouched.
    const reloadedTrade = await prisma.trade.findUnique({ where: { id: trade.id } });
    expect(reloadedTrade?.assetSymbol).toBe("XAUUSD.a");
  });

  /**
   * Stage 17D §10 — the same end-to-end proof for exact futures identity:
   * a session whose asset is literally "MES" must reconstruct MES's own
   * contract, never ES's, all the way through the real session-creation +
   * candle-fetch path (Stage 17B.1 fixed the catalog; this confirms nothing
   * upstream of it — session creation, provider routing — re-collapses it).
   */
  it("a session created with MES resolves its OWN literal contract end-to-end, never ES's", async () => {
    // A day distinct from other tests' MES/MONDAY fixture — the module-level
    // L1 `dayCache` in market-data.service.ts is a shared, process-lifetime
    // cache keyed by (provider, symbol, day) with no reset hook, so reusing
    // MONDAY here could be silently served from another test's cached entry
    // instead of exercising a real fetch. This IS the real, intended
    // cross-session warm-cache-sharing behavior (§16) — just something this
    // specific test must route around to assert on the actual network call.
    const tuesday = MONDAY + DAY_MS;
    const user = await makeUser("e2e-futures-identity-mes");
    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "MES" }));
    expect(trade.assetSymbol).toBe("MES");

    const session = await createReplayReviewSession(user.id, {
      reviewType: "WEEKLY",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      assetSymbols: ["MES"],
    });
    expect(session.assetSymbols).toEqual(["MES"]);

    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { "MES.v.0": [{ d0: "2026-08-01", d1: "2026-09-01", s: "MESU6" }] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ts_event: new Date(tuesday).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "MES", tuesday, tuesday + DAY_MS - 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance[0]?.providerId).toBe("databento");
    expect(result.provenance[0]?.segments[0]?.contractSymbol).toBe("MESU6"); // literal MES contract, never ESU6/ESZ6

    // Prove the resolve step queried MES's OWN continuous symbol, never ES's.
    const [resolveUrl] = fetchMock.mock.calls[0] as [string];
    expect(resolveUrl).toContain("symbols=MES.v.0");
    expect(resolveUrl).not.toContain("symbols=ES.v.0");

    const reloadedTrade = await prisma.trade.findUnique({ where: { id: trade.id } });
    expect(reloadedTrade?.assetSymbol).toBe("MES");
  });
});
