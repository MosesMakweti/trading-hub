import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createMt5Import, deleteMt5Import } from "@/server/services/mt5-import.service";
import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import { buildHigherTimeframeView } from "@/domain/market-data/visible-candles";
import type { Candle } from "@/domain/market-data/candle";
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
  advanceReplayClock,
  buildActualBaseline,
  completeReplayReviewSession,
  createReplayReviewSession,
  fetchReplayCandlesWithProvenance,
  finalizeEdgeReview,
  findOrCreateReplayReviewSessionForPeriod,
  findReplayReviewSessionForPeriod,
  getHistoricalStrategyContext,
  getReplayReviewSession,
  listMt5DataSourceOptions,
  listReplayReviewSessions,
  reopenReplayReviewSession,
  resetMarketDataSourceSelection,
  selectMt5DataSource,
  startReplayReviewSession,
  updateReplayProgress,
  updateReplayReviewNotes,
} from "@/server/services/replay-review.service";
import { acceptSuggestedCommitment, listCommitmentsForSession } from "@/server/services/edge-review-commitment.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  analytics-canonical.service.test.ts. */

// Stage 21.3B — a real in-memory R2 (read+write), needed only by the MT5
// Imported provider-dispatch tests below; every other describe block in
// this file never touches R2 at all. Same pattern as
// mt5-imported-provider.test.ts.
const mt5Store = new Map<string, string>();
const mt5SendMock = vi.fn(async (command: unknown) => {
  if (command instanceof PutObjectCommand) {
    mt5Store.set(command.input.Key!, command.input.Body as string);
    return {};
  }
  if (command instanceof GetObjectCommand) {
    const body = mt5Store.get(command.input.Key!);
    if (body === undefined) throw new NoSuchKey({ message: "not found", $metadata: {} });
    return { Body: { transformToString: async () => body } };
  }
  return {};
});
vi.mock("@/lib/r2", () => ({
  getR2: vi.fn(() => ({ client: { send: mt5SendMock }, bucket: "test-bucket" })),
}));

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

    // Strict no-future-candle delivery (Prompt 5) — provenance is only ever
    // recorded once REAL candles are revealed (Prompt 6 §20 fix), so
    // establishing it here goes through `advanceReplayClock`, not the
    // now-read-only `fetchReplayCandlesWithProvenance`.
    const first = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 60_000);
    expect(first.ok).toBe(true);

    const afterFirst = await getReplayReviewSession(user.id, session.id);
    const provenance = afterFirst!.marketDataProvenance!;
    expect(provenance.EURUSD.providerId).toBe("fixture");
    const frozenAt = provenance.EURUSD.frozenAt;
    expect(frozenAt).toBeTruthy();

    // A second advance for a DIFFERENT day range on the same asset must
    // merge segments, never overwrite the original freeze timestamp.
    const second = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + DAY_MS + 60_000);
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

    await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 60_000);
    // The authoritative boundary is a single session-wide pointer (time is
    // time, independent of asset — see `changeAsset`'s own doc comment in
    // replay-clock.ts), already at MONDAY+60s from the EURUSD advance
    // above — XAUUSD's OWN candles up to that SAME already-authorized
    // boundary are read-only history, exactly like a real asset switch in
    // the client (the fetch effect's read-only sweep, never
    // `advanceReplayClock`, since nothing new needs authorizing).
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

describe("Strict no-future-candle delivery (Prompt 5) — server visibility boundary", () => {
  const DAY_MS = 86_400_000;
  const MIN = 60_000;
  const MONDAY = Date.UTC(2026, 7, 3);

  async function makeSession(userId: string) {
    return createReplayReviewSession(userId, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
  }

  it("advanceReplayClock reveals exactly the closed candles up to the requested boundary — nothing beyond it, even though Fixture happily has data for the whole rest of the period", async () => {
    const user = await makeUser("strict-vis-basic-advance");
    const session = await makeSession(user.id);

    const result = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Closed-candle rule: a candle opening AT the boundary itself has NOT
    // closed yet (its close is boundary+1min), so it must be excluded —
    // only candles whose OWN close time is <= boundary come back.
    expect(result.candles.every((c) => c.timestamp + MIN <= MONDAY + 5 * MIN)).toBe(true);
    expect(result.candles.some((c) => c.timestamp === MONDAY + 5 * MIN)).toBe(false); // still-forming, excluded
    expect(result.candles.some((c) => c.timestamp === MONDAY + 4 * MIN)).toBe(true); // fully closed, included
    expect(result.currentTime).toBe(MONDAY + 5 * MIN);
  });

  it("the exact allowed boundary instant is included correctly (candle closing AT the boundary is visible)", async () => {
    const user = await makeUser("strict-vis-exact-boundary");
    const session = await makeSession(user.id);
    const result = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + MIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The 00:00 candle's close time is exactly 00:01 (MONDAY + MIN) — closes AT the boundary, must be visible.
    expect(result.candles.some((c) => c.timestamp === MONDAY)).toBe(true);
  });

  it("an absurd future request is clipped to the review period end, never served beyond it", async () => {
    const user = await makeUser("strict-vis-absurd-future");
    const session = await makeSession(user.id);
    const farFuture = MONDAY + 500 * DAY_MS; // decades past the review period
    const result = await advanceReplayClock(user.id, session.id, "EURUSD", farFuture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const periodEnd = Date.UTC(2026, 7, 9) + DAY_MS - 1;
    expect(result.currentTime).toBe(periodEnd);
    expect(result.candles.every((c) => c.timestamp <= periodEnd)).toBe(true);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint!.currentTime).toBe(periodEnd); // persisted boundary also clipped, never the raw far-future request
  });

  it("the read-only getReplayCandles path NEVER extends the boundary, regardless of how far ahead `to` asks — a caller cannot bypass the boundary just by requesting a wide range", async () => {
    const user = await makeUser("strict-vis-readonly-never-advances");
    const session = await makeSession(user.id);
    // Never called advanceReplayClock — nothing has been authorized.
    const attempt = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 6 * DAY_MS);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    // periodStart itself has no fully-closed candle yet (nothing precedes it) — zero candles, not "whatever fits in the huge requested range."
    expect(attempt.candles).toHaveLength(0);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint).toBeNull(); // still never advanced
  });

  it("review-period end is enforced even when the caller (or a malicious direct call) asks for a timestamp far beyond it", async () => {
    const user = await makeUser("strict-vis-period-end-enforced");
    const session = await makeSession(user.id);
    const periodEnd = Date.UTC(2026, 7, 9) + DAY_MS - 1;
    const result = await advanceReplayClock(user.id, session.id, "EURUSD", periodEnd + 30 * DAY_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentTime).toBe(periodEnd);
    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint!.currentTime).toBeLessThanOrEqual(periodEnd);
  });

  it("updateReplayProgress cannot be used to sneak the authoritative boundary forward — it is clamped to whatever advanceReplayClock has already validated", async () => {
    const user = await makeUser("strict-vis-progress-cannot-advance");
    const session = await makeSession(user.id);
    // Nothing has ever been advanced — replayCurrentTime is still null server-side.
    await updateReplayProgress(user.id, session.id, { currentTime: MONDAY + 6 * DAY_MS, asset: "EURUSD", timeframe: "1m" });

    const reloaded = await getReplayReviewSession(user.id, session.id);
    // Clamped down to periodStart (the only authoritative value that existed) — never the attacker-supplied far-future instant.
    expect(reloaded!.replayResumePoint!.currentTime).toBe(MONDAY);

    // And a subsequent read-only fetch still reveals nothing, proving the
    // direct updateReplayProgress call never actually opened up the boundary.
    const attempt = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 6 * DAY_MS);
    expect(attempt.ok).toBe(true);
    if (attempt.ok) expect(attempt.candles).toHaveLength(0);
  });

  it("updateReplayProgress CAN move the checkpoint backward within already-authorized territory (a legitimate retreat/pause)", async () => {
    const user = await makeUser("strict-vis-progress-can-retreat");
    const session = await makeSession(user.id);
    await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 10 * MIN);

    await updateReplayProgress(user.id, session.id, { currentTime: MONDAY + 2 * MIN, asset: "EURUSD", timeframe: "1m" });
    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint!.currentTime).toBe(MONDAY + 2 * MIN);
  });

  it("Replay controls — initialize, then advance repeatedly ('N candles'), each call only ever extending forward and never re-revealing what a previous call already returned as duplicate leakage risk", async () => {
    const user = await makeUser("strict-vis-controls-sequence");
    const session = await makeSession(user.id);

    const first = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + MIN); // initialize
    expect(first.ok).toBe(true);
    const second = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 3 * MIN); // advance N candles
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      // The second call's candles are the NEW delta only — no overlap with the first call's timestamps.
      const firstTimestamps = new Set(first.candles.map((c) => c.timestamp));
      expect(second.candles.every((c) => !firstTimestamps.has(c.timestamp))).toBe(true);
      expect(second.candles.every((c) => c.timestamp >= MONDAY + MIN)).toBe(true);
    }

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint!.currentTime).toBe(MONDAY + 3 * MIN);
  });

  it("timeframe switch never leaks a future higher-timeframe candle — M1→M15 aggregation, computed client-side over the SAME already-safe base data, cannot expose the 10:15-10:30 bucket at replayTime 10:15 (§13/§14)", async () => {
    const user = await makeUser("strict-vis-timeframe-safety");
    const session = await makeSession(user.id);
    // Advance to exactly 10:15 — the 10:00-10:15 M15 bucket is fully closed
    // (15 real M1 bars), the 10:15-10:30 bucket must never even be
    // constructible from what the server hands back.
    const boundary = MONDAY + 10 * 60 * MIN + 15 * MIN;
    const result = await advanceReplayClock(user.id, session.id, "EURUSD", boundary);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reuse the exact same domain aggregation the client uses — this is
    // the real pipeline, not a hypothetical: the server never aggregates
    // itself (§14's own architecture decision), it only ever hands back
    // base candles already safe to aggregate from.
    const view = buildHigherTimeframeView(result.candles, boundary, "1m", "15m");
    const leakedBucket = view.closed.find((c) => c.timestamp === MONDAY + 10 * 60 * MIN + 15 * MIN);
    expect(leakedBucket).toBeUndefined(); // the 10:15-10:30 bucket must not exist at all
    const safeBucket = view.closed.find((c) => c.timestamp === MONDAY + 10 * 60 * MIN);
    expect(safeBucket).toBeDefined(); // the 10:00-10:15 bucket IS legitimately closed
    expect(view.partial).toBeNull(); // no base data exists yet for ANY later bucket — not even a partial one
  });

  it("source independence — the SAME strict boundary applies identically whether the resolved provider is Fixture or MT5 Imported (§17, provider-agnostic layer)", async () => {
    const mt5User = await makeUser("strict-vis-source-independence-mt5");
    const cs = Array.from({ length: 60 * 24 * 7 }, (_, i) => ({ timestamp: MONDAY + i * MIN, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null }));
    const imp = await createMt5Import(mt5User.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    const mt5Session = await makeSession(mt5User.id);
    expect((await selectMt5DataSource(mt5User.id, mt5Session.id, "EURUSD", imp.id, "1m")).ok).toBe(true);

    const fixtureUser = await makeUser("strict-vis-source-independence-fixture");
    const fixtureSession = await makeSession(fixtureUser.id);

    const boundary = MONDAY + 5 * MIN;
    const mt5Result = await advanceReplayClock(mt5User.id, mt5Session.id, "EURUSD", boundary);
    const fixtureResult = await advanceReplayClock(fixtureUser.id, fixtureSession.id, "EURUSD", boundary);
    expect(mt5Result.ok).toBe(true);
    expect(fixtureResult.ok).toBe(true);
    if (mt5Result.ok && fixtureResult.ok) {
      // Same closed-candle rule, same boundary, same result shape for BOTH sources.
      expect(mt5Result.candles.every((c) => c.timestamp + MIN <= boundary)).toBe(true);
      expect(fixtureResult.candles.every((c) => c.timestamp + MIN <= boundary)).toBe(true);
      expect(mt5Result.candles.some((c) => c.timestamp === boundary)).toBe(false);
      expect(fixtureResult.candles.some((c) => c.timestamp === boundary)).toBe(false);
      expect(mt5Result.provenance[0]?.providerId).toBe("mt5-imported");
      expect(fixtureResult.provenance[0]?.providerId).toBe("fixture");
    }
  });

  it("hardening (Prompt 6 §5/§6) — an advance landing entirely inside a real intraday gap moves the boundary through it with zero candles, never hangs, never fabricates data", async () => {
    const user = await makeUser("strict-vis-intraday-gap");
    const session = await makeSession(user.id);
    // A full week of M1 data (so `selectMt5DataSource`'s full-period
    // coverage check passes) with a real gap embedded Monday morning:
    // 09:30, 09:31, 09:32, then nothing until 09:38.
    const cs: { timestamp: number; open: number; high: number; low: number; close: number; volume: null }[] = [];
    for (let m = 0; m < 60 * 24 * 7; m++) {
      const minuteOfMonday = m; // 0 = MONDAY 00:00
      if (minuteOfMonday >= 9 * 60 + 33 && minuteOfMonday <= 9 * 60 + 37) continue; // the gap
      cs.push({ timestamp: MONDAY + m * MIN, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null });
    }
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    expect((await selectMt5DataSource(user.id, session.id, "EURUSD", imp.id, "1m")).ok).toBe(true);

    // Advance to a boundary that lands INSIDE the gap (09:35) — the last
    // real candle before the gap (09:32) is revealed; nothing from the
    // dead 09:33-09:37 zone exists at all, never hangs, never invents one.
    const insideGap = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + (9 * 60 + 35) * MIN);
    expect(insideGap.ok).toBe(true);
    if (insideGap.ok) {
      expect(insideGap.candles.length).toBeGreaterThan(0);
      const latest = Math.max(...insideGap.candles.map((c) => c.timestamp));
      expect(latest).toBe(MONDAY + (9 * 60 + 32) * MIN); // the last real candle before the gap
      expect(insideGap.candles.some((c) => c.timestamp >= MONDAY + (9 * 60 + 33) * MIN)).toBe(false); // nothing from inside the gap
    }

    // Advance PAST the gap, all the way to 09:39 — the 09:38 candle (closes
    // 09:39) must now be revealed, without ever having fabricated anything
    // for the dead 09:33-09:37 minutes.
    const pastGap = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + (9 * 60 + 39) * MIN);
    expect(pastGap.ok).toBe(true);
    if (pastGap.ok) {
      expect(pastGap.candles.some((c) => c.timestamp === MONDAY + (9 * 60 + 38) * MIN)).toBe(true);
      expect(pastGap.candles.every((c) => cs.some((real) => real.timestamp === c.timestamp))).toBe(true); // every returned candle is REAL, never fabricated
    }

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.replayResumePoint!.currentTime).toBe(MONDAY + (9 * 60 + 39) * MIN); // boundary moved through the gap cleanly
  });

  it("hardening (Prompt 6 §4) — Friday-close-to-Monday-open (a real weekend gap) is traversed the same way: boundary moves, zero fabricated candles, next real candle appears once the boundary passes it", async () => {
    const user = await makeUser("strict-vis-weekend-gap");
    const fridayClose = Date.UTC(2026, 7, 7, 23, 59); // Friday Aug 7 2026, 23:59 UTC
    const mondayOpen = Date.UTC(2026, 7, 10, 0, 0); // Monday Aug 10 2026, 00:00 UTC
    const monthlyPeriodStart = Date.UTC(2026, 7, 1);
    const monthlyPeriodEnd = Date.UTC(2026, 7, 31, 23, 59); // last real candle of the month, bracketing periodEnd
    // Sparse but legitimate: `selectMt5DataSource`'s coverage check only
    // needs the dataset's own first/last candle to bracket the review
    // period — it doesn't require dense minute-by-minute data for the
    // whole month, only for the specific gap under test here.
    const cs = [
      { timestamp: monthlyPeriodStart, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null },
      { timestamp: fridayClose, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null },
      { timestamp: mondayOpen, open: 1.05, high: 1.15, low: 0.95, close: 1.1, volume: null },
      { timestamp: monthlyPeriodEnd, open: 1.05, high: 1.15, low: 0.95, close: 1.1, volume: null },
    ];
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    const wideSession = await createReplayReviewSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    expect((await selectMt5DataSource(user.id, wideSession.id, "EURUSD", imp.id, "1m")).ok).toBe(true);

    const beforeGap = await advanceReplayClock(user.id, wideSession.id, "EURUSD", fridayClose + MIN);
    expect(beforeGap.ok).toBe(true);
    if (beforeGap.ok) expect(beforeGap.candles.some((c) => c.timestamp === fridayClose)).toBe(true);

    // A single advance request spanning the whole weekend gap — no manual
    // "step through the weekend" round trips required.
    const afterGap = await advanceReplayClock(user.id, wideSession.id, "EURUSD", mondayOpen + MIN);
    expect(afterGap.ok).toBe(true);
    if (afterGap.ok) {
      expect(afterGap.candles).toHaveLength(1);
      expect(afterGap.candles[0].timestamp).toBe(mondayOpen);
    }
  });

  it("hardening (Prompt 6 §27) — a pinned MT5 dataset that no longer exists fails explicitly, never falls back to another import or automatic resolution", async () => {
    const user = await makeUser("strict-vis-dataset-deleted");
    const session = await makeSession(user.id);
    const periodEndBracket = Date.UTC(2026, 7, 9, 23, 59); // brackets the WEEKLY Aug3-9 period's own end
    const cs = [
      { timestamp: MONDAY, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null },
      { timestamp: periodEndBracket, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: null },
    ];
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    expect((await selectMt5DataSource(user.id, session.id, "EURUSD", imp.id, "1m")).ok).toBe(true);

    // Simulate the dataset disappearing out from under an already-pinned
    // session (never exposed in the UI, but the service layer must not
    // silently paper over it if it somehow happens).
    await deleteMt5Import(user.id, imp.id);

    const result = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + MIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE"); // never a silent fallback to another provider/import
  });

  it("hardening (Prompt 7 §10) — concurrent checkpoint-style calls never corrupt or regress the persisted authoritative boundary, regardless of resolution order", async () => {
    const user = await makeUser("strict-vis-concurrent-checkpoint");
    const session = await makeSession(user.id);

    // Two "forward" advances racing for the SAME target — this is exactly
    // what a Play-tick-finishing and a near-simultaneous manual click can
    // produce client-side. Both must converge on the same correct boundary.
    const target = MONDAY + 10 * MIN;
    const [a, b] = await Promise.all([
      advanceReplayClock(user.id, session.id, "EURUSD", target),
      advanceReplayClock(user.id, session.id, "EURUSD", target),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.currentTime).toBe(target);
      expect(b.currentTime).toBe(target);
    }
    const afterForwardRace = await getReplayReviewSession(user.id, session.id);
    expect(afterForwardRace!.replayResumePoint!.currentTime).toBe(target);

    // A concurrent BACKWARD checkpoint (updateReplayProgress — e.g. a
    // genuine retreat, or a stale unmount cleanup) racing a forward
    // advance is a DIFFERENT case from two forward advances above:
    // `updateReplayProgress` moving the resume point backward is
    // INTENTIONAL, correct behavior (§18 — "CAN move the checkpoint
    // backward within already-authorized territory"), so the race's
    // outcome legitimately depends on resolution order — the invariant
    // under test here is NOT "forward always wins" but "the result is
    // always exactly one of the two legitimately-requested values, never
    // a torn/corrupted third value," AND that a subsequent read-only fetch
    // never reveals more than whatever ended up persisted.
    const furtherTarget = MONDAY + 20 * MIN;
    const backwardTarget = MONDAY + 2 * MIN;
    const [advanceResult] = await Promise.all([
      advanceReplayClock(user.id, session.id, "EURUSD", furtherTarget),
      updateReplayProgress(user.id, session.id, { currentTime: backwardTarget, asset: "EURUSD", timeframe: "1m" }),
    ]);
    expect(advanceResult.ok).toBe(true);
    const afterMixedRace = await getReplayReviewSession(user.id, session.id);
    const persisted = afterMixedRace!.replayResumePoint!.currentTime;
    expect([furtherTarget, backwardTarget]).toContain(persisted); // never a corrupted third value

    // Whichever value won, a read-only fetch NEVER reveals beyond it —
    // the core no-future-candle invariant holds regardless of which
    // legitimate outcome the race produced.
    const readOnly = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, furtherTarget + 5 * MIN);
    expect(readOnly.ok).toBe(true);
    if (readOnly.ok) expect(readOnly.candles.every((c) => c.timestamp + MIN <= persisted)).toBe(true);

    // And forward progress is never permanently blocked by a backward race
    // — a fresh advance still correctly reaches (or re-reaches) the target.
    const reAdvance = await advanceReplayClock(user.id, session.id, "EURUSD", furtherTarget);
    expect(reAdvance.ok).toBe(true);
    if (reAdvance.ok) expect(reAdvance.currentTime).toBe(furtherTarget);
  });

  it("hardening (Prompt 7 §5) — multi-asset: EURUSD pinned to Import A and XAUUSD pinned to Import B in the SAME session, neither ever reads the other's dataset, both survive a fresh reload", async () => {
    const user = await makeUser("multi-asset-mt5-pinning");
    const session = await makeSession(user.id);

    const eurCandles = Array.from({ length: 60 * 24 * 7 }, (_, i) => ({ timestamp: MONDAY + i * MIN, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: null }));
    const xauCandles = Array.from({ length: 60 * 24 * 7 }, (_, i) => ({ timestamp: MONDAY + i * MIN, open: 3700, high: 3705, low: 3695, close: 3702, volume: null }));
    const importA = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: eurCandles,
      quality: analyzeMarketDataQuality(eurCandles, "1m", eurCandles[0].timestamp, eurCandles[eurCandles.length - 1].timestamp),
      status: "READY",
    });
    const importB = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: xauCandles,
      quality: analyzeMarketDataQuality(xauCandles, "1m", xauCandles[0].timestamp, xauCandles[xauCandles.length - 1].timestamp),
      status: "READY",
    });

    expect((await selectMt5DataSource(user.id, session.id, "EURUSD", importA.id, "1m")).ok).toBe(true);
    expect((await selectMt5DataSource(user.id, session.id, "XAUUSD", importB.id, "1m")).ok).toBe(true);

    const eurResult = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN);
    expect(eurResult.ok).toBe(true);
    if (eurResult.ok) {
      expect(eurResult.candles.every((c) => c.open === 1.1)).toBe(true);
      expect(eurResult.provenance[0]?.datasetId).toBe(importA.id);
    }

    // Switching to XAUUSD at the SAME shared boundary (time is a single
    // session-wide pointer, independent of asset) is a READ of
    // already-authorized history for a NEW asset, exactly like a real
    // client asset-switch — not a further "advance" (nothing new to
    // authorize time-wise), so it goes through the read-only path.
    const xauResult = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MONDAY, MONDAY + 5 * MIN);
    expect(xauResult.ok).toBe(true);
    if (xauResult.ok) {
      expect(xauResult.candles.every((c) => c.open === 3700)).toBe(true);
      expect(xauResult.provenance[0]?.datasetId).toBe(importB.id);
    }

    // Reload: fresh DB read, both per-asset associations survive independently.
    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.marketDataProvenance!.EURUSD.datasetId).toBe(importA.id);
    expect(reloaded!.marketDataProvenance!.EURUSD.providerId).toBe("mt5-imported");
    expect(reloaded!.marketDataProvenance!.XAUUSD.datasetId).toBe(importB.id);
    expect(reloaded!.marketDataProvenance!.XAUUSD.providerId).toBe("mt5-imported");

    // Switching back to EURUSD after reload still reads ONLY Import A.
    const eurAgain = await fetchReplayCandlesWithProvenance(user.id, session.id, "EURUSD", MONDAY, MONDAY + 5 * MIN);
    expect(eurAgain.ok).toBe(true);
    if (eurAgain.ok) {
      expect(eurAgain.candles.every((c) => c.open === 1.1)).toBe(true);
      expect(eurAgain.provenance[0]?.datasetId).toBe(importA.id);
    }
  });

  it("hardening (Prompt 7 §7) — a provider that fails mid-Play (a transient error on one advance) never corrupts the authoritative boundary; retry from the same position succeeds", async () => {
    const user = await makeUser("provider-transient-failure");
    const session = await makeSession(user.id);

    // First advance succeeds normally (Fixture, always available).
    const first = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN);
    expect(first.ok).toBe(true);
    const afterFirst = await getReplayReviewSession(user.id, session.id);
    const boundaryAfterFirst = afterFirst!.replayResumePoint!.currentTime;

    // Simulate a transient provider failure by requesting an unsupported
    // symbol for the SECOND advance — the function must refuse cleanly,
    // WITHOUT having already committed a partial/incorrect boundary move
    // (the atomic write only ever happens after provider resolution
    // succeeds — see `advanceReplayClock`'s own ordering).
    const failed = await advanceReplayClock(user.id, session.id, "NOT_A_REAL_SYMBOL", MONDAY + 10 * MIN);
    expect(failed.ok).toBe(false);

    const afterFailure = await getReplayReviewSession(user.id, session.id);
    // The boundary is COMPLETELY unaffected by the failed attempt — still
    // exactly where the last successful advance left it, never partially
    // moved toward the failed request's target.
    expect(afterFailure!.replayResumePoint!.currentTime).toBe(boundaryAfterFirst);

    // Retry (a real request, same session/asset) continues from the SAME position.
    const retry = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 10 * MIN);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.currentTime).toBe(MONDAY + 10 * MIN);
  });

  it("hardening (Prompt 7 §8) — an MT5 dataset read failure (simulated R2 outage) never falls back to another dataset/provider; retry after recovery uses the SAME pinned dataset", async () => {
    const user = await makeUser("mt5-r2-outage");
    const session = await makeSession(user.id);
    const cs = Array.from({ length: 60 * 24 * 7 }, (_, i) => ({ timestamp: MONDAY + i * MIN, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: null }));
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD.a",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    expect((await selectMt5DataSource(user.id, session.id, "EURUSD", imp.id, "1m")).ok).toBe(true);

    // Simulate an R2 outage for exactly one call.
    mt5SendMock.mockImplementationOnce(async () => {
      throw new Error("simulated R2 outage");
    });
    await expect(advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN)).rejects.toThrow(/simulated R2 outage/);

    // The pin itself is untouched by the failed read — no fallback was ever
    // attempted, and the boundary never moved during the failed call.
    const afterOutage = await getReplayReviewSession(user.id, session.id);
    // The PENDING selection entry from `selectMt5DataSource` (segments:
    // []) is unaffected — it predates any fetch attempt — but it must
    // stay UNCONSUMED (empty segments): the failed fetch recorded nothing.
    expect(afterOutage!.marketDataProvenance!.EURUSD.datasetId).toBe(imp.id);
    expect(afterOutage!.marketDataProvenance!.EURUSD.segments).toHaveLength(0);
    expect(afterOutage!.replayResumePoint).toBeNull();

    // "Recovery": the mock's one-shot failure is consumed; a retry now succeeds using the SAME dataset.
    const retry = await advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.provenance[0]?.datasetId).toBe(imp.id);
  });

  it("hardening (Prompt 7 §6) — realistic provider latency: rapid concurrent advance requests still converge on the correct maximum boundary, never lost/out-of-order", async () => {
    const user = await makeUser("latency-simulation");
    const session = await makeSession(user.id);

    // Simulate realistic network/provider latency (100/300/750ms) by racing
    // three concurrent advances with different artificial delays baked into
    // their target computation order — Promise.all resolves in COMPLETION
    // order, not call order, exactly like a real slow network would.
    async function delayed<T>(ms: number, fn: () => Promise<T>): Promise<T> {
      await new Promise((r) => setTimeout(r, ms));
      return fn();
    }
    const [a, b, c] = await Promise.all([
      delayed(100, () => advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 5 * MIN)),
      delayed(750, () => advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 15 * MIN)),
      delayed(300, () => advanceReplayClock(user.id, session.id, "EURUSD", MONDAY + 10 * MIN)),
    ]);
    expect(a.ok && b.ok && c.ok).toBe(true);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    // Regardless of which request's network delay made it resolve last,
    // the persisted boundary is the correct MAXIMUM of all three requested
    // targets — never a smaller, "later-arriving-but-earlier-target" value.
    expect(reloaded!.replayResumePoint!.currentTime).toBe(MONDAY + 15 * MIN);
  }, 10_000);
});

describe("fetchReplayCandlesWithProvenance — MT5 Imported provider dispatch (Stage 21.3B)", () => {
  const MIN = 60_000;
  const MT5_MONDAY = Date.UTC(2026, 0, 5); // a Monday, independent of the DAY_MS/MONDAY constants other blocks use

  beforeEach(() => {
    mt5SendMock.mockClear();
    mt5Store.clear();
  });

  function mt5Candles(startMs: number, count: number): Candle[] {
    return Array.from({ length: count }, (_, i) => ({ timestamp: startMs + i * MIN, open: 4200, high: 4201, low: 4199, close: 4200.5, volume: null }));
  }

  async function makeMt5Import(userId: string) {
    const cs = mt5Candles(MT5_MONDAY, 60);
    return createMt5Import(userId, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
  }

  it("a session explicitly frozen to mt5-imported resolves real imported candles through the full Edge Review Replay path", async () => {
    const user = await makeUser("mt5-dispatch-frozen");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-01-05", endDate: "2026-01-11" });
    await makeMt5Import(user.id);

    // Simulates a session that already picked MT5 Imported as its Data
    // Source for XAUUSD (the freeze-once record a future selector UI would
    // write) — same technique the other frozen-provenance tests above use.
    await prisma.replayReviewSession.update({
      where: { id: session.id },
      data: {
        marketDataProvenance: {
          XAUUSD: { providerId: "mt5-imported", retrievedAt: new Date().toISOString(), frozenAt: new Date().toISOString(), segments: [] },
        },
      },
    });

    // Strict no-future-candle delivery (Prompt 5) — `fetchReplayCandlesWithProvenance`
    // is now READ-ONLY and reveals nothing for a session that has never
    // advanced; `advanceReplayClock` is what actually resolves+fetches+
    // reveals for the first time.
    const result = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + 10 * MIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candles.length).toBeGreaterThan(0);
      expect(result.provenance[0]?.providerId).toBe("mt5-imported");
    }
  });

  it("another user cannot read this user's MT5-sourced replay data even with a session frozen to mt5-imported (§7 ownership)", async () => {
    const owner = await makeUser("mt5-dispatch-owner");
    const attacker = await makeUser("mt5-dispatch-attacker");
    await makeMt5Import(owner.id);

    // The attacker has their OWN session (never the owner's), frozen to
    // mt5-imported for the same symbol — fetchReplayCandlesWithProvenance
    // constructs the provider scoped to the AUTHENTICATED caller's userId
    // (never the session owner from some other record), so this must find
    // nothing, not the owner's imported data.
    const attackerSession = await createReplayReviewSession(attacker.id, { reviewType: "WEEKLY", startDate: "2026-01-05", endDate: "2026-01-11" });
    await prisma.replayReviewSession.update({
      where: { id: attackerSession.id },
      data: {
        marketDataProvenance: {
          XAUUSD: { providerId: "mt5-imported", retrievedAt: new Date().toISOString(), frozenAt: new Date().toISOString(), segments: [] },
        },
      },
    });

    const result = await fetchReplayCandlesWithProvenance(attacker.id, attackerSession.id, "XAUUSD", MT5_MONDAY, MT5_MONDAY + 10 * MIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
  });

  it("a fresh (never-frozen) session for a symbol with an MT5 import does NOT automatically route to it (§5 — no unexpected override)", async () => {
    const user = await makeUser("mt5-dispatch-no-auto");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-01-05", endDate: "2026-01-11" });
    await makeMt5Import(user.id); // an MT5 import exists for this user+symbol...

    // ...but nothing ever selected it as this session's Data Source, so the
    // FIRST advance must still go through ordinary resolveMarketDataProvider
    // (Fixture, in this test environment — no Databento/Twelve Data keys
    // configured) — never silently prefer MT5 just because it exists.
    const result = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + MIN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provenance[0]?.providerId).toBe("fixture");

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.marketDataProvenance!.XAUUSD.providerId).toBe("fixture");
  });

  it("mt5-imported is never refused by the display-permission gate (private user data, no licensing flag needed)", async () => {
    const user = await makeUser("mt5-dispatch-permitted");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-01-05", endDate: "2026-01-11" });
    await makeMt5Import(user.id);
    await prisma.replayReviewSession.update({
      where: { id: session.id },
      data: {
        marketDataProvenance: {
          XAUUSD: { providerId: "mt5-imported", retrievedAt: new Date().toISOString(), frozenAt: new Date().toISOString(), segments: [] },
        },
      },
    });

    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MT5_MONDAY, MT5_MONDAY + MIN);
    expect(result.ok).toBe(true); // never PROVIDER_DISPLAY_DISABLED, unlike Databento/Twelve Data without their flags
  });
});

describe("Edge Review Replay Data Source — selectMt5DataSource/resetMarketDataSourceSelection/listMt5DataSourceOptions (§14-19)", () => {
  const MIN = 60_000;
  const MT5_MONDAY = Date.UTC(2026, 0, 5); // Monday — matches the WEEKLY session period below

  beforeEach(() => {
    mt5SendMock.mockClear();
    mt5Store.clear();
  });

  function mt5Candles(startMs: number, count: number): Candle[] {
    return Array.from({ length: count }, (_, i) => ({ timestamp: startMs + i * MIN, open: 4200, high: 4201, low: 4199, close: 4200.5, volume: null }));
  }

  /** Covers the FULL Jan 5–11 2026 WEEKLY period (10,080 one-minute bars) so
   *  the coverage check in `selectMt5DataSource` passes without every test
   *  needing to reason about exact minute counts. */
  async function makeFullWeekMt5Import(userId: string, opts: { canonicalSymbol?: string; nativeTimeframe?: "1m" | "5m" } = {}) {
    const cs = mt5Candles(MT5_MONDAY, 60 * 24 * 7);
    return createMt5Import(userId, {
      sourceSymbol: (opts.canonicalSymbol ?? "XAUUSD") + ".a",
      canonicalSymbol: opts.canonicalSymbol ?? "XAUUSD",
      nativeTimeframe: opts.nativeTimeframe ?? "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, opts.nativeTimeframe ?? "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
  }

  async function makeWeeklySession(userId: string) {
    return createReplayReviewSession(userId, { reviewType: "WEEKLY", startDate: "2026-01-05", endDate: "2026-01-11" });
  }

  it("selecting a dataset persists the EXACT MarketDataImport id, and a later fetch uses only that import — never the provider's merge-all behavior (the user's own top priority for this feature)", async () => {
    const user = await makeUser("select-exact-dataset");
    const session = await makeWeeklySession(user.id);
    // Two OVERLAPPING imports for the same (user, symbol, timeframe) — the
    // provider's default mode would merge both; explicit selection must
    // pin to exactly the FIRST one and never pick up the second's data.
    const first = await makeFullWeekMt5Import(user.id);
    const second = await makeFullWeekMt5Import(user.id);
    expect(first.id).not.toBe(second.id);

    const selected = await selectMt5DataSource(user.id, session.id, "XAUUSD", first.id, "1m");
    expect(selected.ok).toBe(true);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.marketDataProvenance!.XAUUSD.providerId).toBe("mt5-imported");
    expect(reloaded!.marketDataProvenance!.XAUUSD.datasetId).toBe(first.id);

    // Strict no-future-candle delivery (Prompt 5) — revealing NEW data for a
    // session goes through `advanceReplayClock`, never the now-read-only
    // `fetchReplayCandlesWithProvenance`.
    const result = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + 5 * MIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance[0]?.datasetId).toBe(first.id);
      expect(result.provenance[0]?.segments).toEqual([{ contractSymbol: first.id, from: MT5_MONDAY, to: MT5_MONDAY + 5 * MIN }]);
    }

    // A SECOND advance (later chunk) still resolves through the pinned
    // import only — this is §15's actual requirement: dataset identity
    // survives subsequent requests, never silently reverting to merge-all.
    const second_result = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + 15 * MIN);
    expect(second_result.ok).toBe(true);
    if (second_result.ok) expect(second_result.provenance[0]?.datasetId).toBe(first.id);

    const finalRow = await getReplayReviewSession(user.id, session.id);
    expect(finalRow!.marketDataProvenance!.XAUUSD.datasetId).toBe(first.id);
  });

  it("cannot select another user's import (ownership boundary, §7/§23)", async () => {
    const owner = await makeUser("select-owner");
    const attacker = await makeUser("select-attacker");
    const imp = await makeFullWeekMt5Import(owner.id);
    const attackerSession = await makeWeeklySession(attacker.id);

    const result = await selectMt5DataSource(attacker.id, attackerSession.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(false);
  });

  it("refuses a dataset for a different symbol", async () => {
    const user = await makeUser("select-symbol-mismatch");
    const session = await makeWeeklySession(user.id);
    const imp = await makeFullWeekMt5Import(user.id, { canonicalSymbol: "EURUSD" });

    const result = await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(false);
  });

  it("refuses a dataset that doesn't cover the full review period (§19 — never a partial-coverage selection)", async () => {
    const user = await makeUser("select-partial-coverage");
    const session = await makeWeeklySession(user.id);
    // Only covers Monday, not the whole Jan 5-11 WEEKLY period.
    const cs = mt5Candles(MT5_MONDAY, 60);
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });

    const result = await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/full review period/i);
  });

  it("hardening §14 — dataset starts too late (misses the Monday morning of the review period) is refused", async () => {
    const user = await makeUser("boundary-starts-late");
    const session = await makeWeeklySession(user.id);
    // Starts Tuesday instead of Monday — misses the first day of the WEEKLY period.
    const cs = mt5Candles(MT5_MONDAY + 24 * 60 * MIN, 60 * 24 * 6);
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    const result = await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(false);
  });

  it("hardening §14 — dataset ends too early (misses the Sunday of the review period) is refused", async () => {
    const user = await makeUser("boundary-ends-early");
    const session = await makeWeeklySession(user.id);
    // Covers Monday through Saturday only — misses Sunday, the last day of the WEEKLY period.
    const cs = mt5Candles(MT5_MONDAY, 60 * 24 * 6);
    const imp = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp),
      status: "READY",
    });
    const result = await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(false);
  });

  it("hardening §14 — a dataset whose coverage EXACTLY matches the review period boundary (last M1 bar starts 23:59 Sunday) is accepted, not off-by-one refused", async () => {
    const user = await makeUser("boundary-exact-match");
    const session = await makeWeeklySession(user.id);
    // Exactly 7*24*60 = 10,080 one-minute bars, Monday 00:00 through Sunday
    // 23:59 inclusive — the precise boundary case the timeframe-duration fix
    // (below) exists for.
    const imp = await makeFullWeekMt5Import(user.id);
    const result = await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");
    expect(result.ok).toBe(true);
  });

  it("an unconsumed selection can be changed freely, but is locked once candles have been served (§16 — 'Locked for this replay')", async () => {
    const user = await makeUser("select-lock-lifecycle");
    const session = await makeWeeklySession(user.id);
    const first = await makeFullWeekMt5Import(user.id);
    const second = await makeFullWeekMt5Import(user.id);

    expect((await selectMt5DataSource(user.id, session.id, "XAUUSD", first.id, "1m")).ok).toBe(true);
    // Still unconsumed (zero segments) — switching to a different dataset is allowed.
    expect((await selectMt5DataSource(user.id, session.id, "XAUUSD", second.id, "1m")).ok).toBe(true);

    // Consume it — a real candle advance/reveal (Prompt 6 §20 — provenance
    // is only recorded once REAL candles become visible, so this must
    // genuinely advance, not just read-only fetch a range that reveals
    // nothing yet).
    const fetched = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + MIN);
    expect(fetched.ok).toBe(true);

    // Now locked — neither switching to a new dataset nor resetting to automatic is allowed.
    const reselect = await selectMt5DataSource(user.id, session.id, "XAUUSD", first.id, "1m");
    expect(reselect.ok).toBe(false);
    if (!reselect.ok) expect(reselect.error).toMatch(/locked/i);
    const reset = await resetMarketDataSourceSelection(user.id, session.id, "XAUUSD");
    expect(reset.ok).toBe(false);
  });

  it("resetMarketDataSourceSelection reverts an unconsumed MT5 selection back to automatic resolution", async () => {
    const user = await makeUser("reset-to-automatic");
    const session = await makeWeeklySession(user.id);
    const imp = await makeFullWeekMt5Import(user.id);
    await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m");

    const reset = await resetMarketDataSourceSelection(user.id, session.id, "XAUUSD");
    expect(reset.ok).toBe(true);

    const reloaded = await getReplayReviewSession(user.id, session.id);
    expect(reloaded!.marketDataProvenance?.XAUUSD).toBeUndefined();

    // Falls through to ordinary automatic resolution (Fixture in this test env).
    const result = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MT5_MONDAY, MT5_MONDAY + MIN);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provenance[0]?.providerId).toBe("fixture");
  });

  it("listMt5DataSourceOptions lists ALL the user's imports, compatible ones first, with clear incompatibility reasons — never hidden (§5/§6)", async () => {
    const user = await makeUser("list-options");
    const session = await makeWeeklySession(user.id);
    const compatible = await makeFullWeekMt5Import(user.id);
    const wrongSymbol = await makeFullWeekMt5Import(user.id, { canonicalSymbol: "EURUSD" });
    const wrongTimeframe = await makeFullWeekMt5Import(user.id, { nativeTimeframe: "5m" });

    const result = await listMt5DataSourceOptions(user.id, session.id, "XAUUSD", "1m");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byId = new Map(result.options.map((o) => [o.id, o]));
    expect(byId.get(compatible.id)?.compatible).toBe(true);
    expect(byId.get(wrongSymbol.id)?.compatible).toBe(false);
    expect(byId.get(wrongSymbol.id)?.incompatibilityReasons.join(" ")).toMatch(/symbol/i);
    expect(byId.get(wrongTimeframe.id)?.compatible).toBe(false);
    expect(byId.get(wrongTimeframe.id)?.incompatibilityReasons.join(" ")).toMatch(/timeframe/i);
    // Compatible sorts first.
    expect(result.options[0]?.id).toBe(compatible.id);
  });

  it("listMt5DataSourceOptions never lists another user's imports", async () => {
    const owner = await makeUser("list-owner");
    const other = await makeUser("list-other");
    await makeFullWeekMt5Import(owner.id);
    const otherSession = await makeWeeklySession(other.id);

    const result = await listMt5DataSourceOptions(other.id, otherSession.id, "XAUUSD", "1m");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options).toHaveLength(0);
  });

  it("hardening §8 — two datasets with OBSERVABLY DIFFERENT candle values: selecting one returns ONLY its values, repeatedly; a separate session selecting the other returns ONLY that one's values", async () => {
    const user = await makeUser("observable-dataset-values");

    // Dataset A: a flat 4200-ish price series. Dataset B: a flat 4400-ish
    // price series — same symbol/timeframe/date range (full week), but
    // trivially distinguishable by eye, not just by database id.
    const datasetA = await makeFullWeekMt5Import(user.id); // uses mt5Candles() -> open/close ~4200
    const bCandles = Array.from({ length: 60 * 24 * 7 }, (_, i) => ({
      timestamp: MT5_MONDAY + i * MIN,
      open: 4400,
      high: 4401,
      low: 4399,
      close: 4400.5,
      volume: null,
    }));
    const datasetB = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: bCandles,
      quality: analyzeMarketDataQuality(bCandles, "1m", bCandles[0].timestamp, bCandles[bCandles.length - 1].timestamp),
      status: "READY",
    });

    // Session 1 selects Dataset A explicitly. Each `advanceReplayClock`
    // call reveals a bit more (Prompt 5 — the only way NEW data ever
    // reaches a caller now), repeatedly proving only A's values ever come back.
    const sessionA = await makeWeeklySession(user.id);
    expect((await selectMt5DataSource(user.id, sessionA.id, "XAUUSD", datasetA.id, "1m")).ok).toBe(true);
    for (let i = 1; i <= 3; i++) {
      const result = await advanceReplayClock(user.id, sessionA.id, "XAUUSD", MT5_MONDAY + i * 10 * MIN);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candles.every((c) => c.open === 4200)).toBe(true);
        expect(result.candles.some((c) => c.open === 4400)).toBe(false);
        expect(result.provenance[0]?.datasetId).toBe(datasetA.id);
      }
    }

    // A SEPARATE session selects Dataset B explicitly — must return ONLY B's values.
    const sessionB = await makeWeeklySession(user.id);
    expect((await selectMt5DataSource(user.id, sessionB.id, "XAUUSD", datasetB.id, "1m")).ok).toBe(true);
    const resultB = await advanceReplayClock(user.id, sessionB.id, "XAUUSD", MT5_MONDAY + 5 * MIN);
    expect(resultB.ok).toBe(true);
    if (resultB.ok) {
      expect(resultB.candles.every((c) => c.open === 4400)).toBe(true);
      expect(resultB.candles.some((c) => c.open === 4200)).toBe(false);
      expect(resultB.provenance[0]?.datasetId).toBe(datasetB.id);
    }
  });

  it("hardening §18 — reload/persistence: re-deriving state from fresh DB reads only (no shared in-memory cache) still resolves the exact pinned dataset", async () => {
    const user = await makeUser("reload-persistence");
    const imp = await makeFullWeekMt5Import(user.id);
    const session = await makeWeeklySession(user.id);

    expect((await selectMt5DataSource(user.id, session.id, "XAUUSD", imp.id, "1m")).ok).toBe(true);
    const firstFetch = await advanceReplayClock(user.id, session.id, "XAUUSD", MT5_MONDAY + MIN);
    expect(firstFetch.ok).toBe(true);

    // Simulate "reload the page": read the session FRESH from Postgres,
    // exactly as a new server-rendered request would, then fetch again —
    // nothing here is React state or held in a closure across these two
    // "requests."
    const reloadedSession = await getReplayReviewSession(user.id, session.id);
    expect(reloadedSession!.marketDataProvenance!.XAUUSD.providerId).toBe("mt5-imported");
    expect(reloadedSession!.marketDataProvenance!.XAUUSD.datasetId).toBe(imp.id);

    // A read-only re-fetch of already-authorized history (e.g. rebuilding
    // chart state after that reload) must still resolve the exact pinned
    // dataset, without needing to advance further.
    const secondFetch = await fetchReplayCandlesWithProvenance(user.id, session.id, "XAUUSD", MT5_MONDAY, MT5_MONDAY + MIN);
    expect(secondFetch.ok).toBe(true);
    if (secondFetch.ok) expect(secondFetch.provenance[0]?.datasetId).toBe(imp.id);
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

    // The client passes the session's OWN asset string (here "XAUUSD.A") as
    // canonicalSymbol — this is the real call shape. Strict no-future-candle
    // delivery (Prompt 5) — a fresh session must first ADVANCE to reveal
    // anything at all; `fetchReplayCandlesWithProvenance` alone would
    // return nothing for a session that has never progressed.
    const result = await advanceReplayClock(user.id, session.id, "XAUUSD.A", MONDAY + 60_000);
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
      // Strict no-future-candle delivery (Prompt 5) — a brand-new session's
      // first `advanceReplayClock` call fetches from the review period's
      // OWN start (Monday), not just the caller's requested instant
      // (Tuesday) — see that function's own doc comment on why the
      // look-back always includes whatever's already authoritative. Monday
      // itself has no real candles in this fixture, so its day-fetch
      // legitimately returns empty.
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ts_event: new Date(tuesday).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Strict no-future-candle delivery (Prompt 5) — a fresh session must
    // ADVANCE to reveal anything at all.
    const result = await advanceReplayClock(user.id, session.id, "MES", tuesday + DAY_MS - 1);
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
