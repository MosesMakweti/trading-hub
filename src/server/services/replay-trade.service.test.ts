import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade } from "@/server/services/trades.service";
import { createStrategy, publishStrategyVersion, renameStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { listSetupTypesWithScenarios, addScenarioCondition, createSetupType } from "@/server/services/strategy-setup-types.service";
import { completeReplayReviewSession, createReplayReviewSession, reopenReplayReviewSession, startReplayReviewSession } from "@/server/services/replay-review.service";
import {
  advanceReplayTradeExecution,
  cancelReplayTradePendingOrder,
  closeReplayTradePartialManually,
  closeReplayTradeRemainingManually,
  createReplayDecision,
  deleteReplayTrade,
  getReplayTrade,
  listReplayTrades,
  moveReplayTradeStopLoss,
  resolveReplayTradeAmbiguity,
} from "@/server/services/replay-trade.service";
import type { Candle } from "@/domain/market-data/candle";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  replay-review.service.test.ts. Pure execution-logic edge cases (R math,
 *  idempotency, OHLC ambiguity) are already exhaustively covered by
 *  domain/replay-execution/engine.test.ts; these tests focus on what's
 *  unique to the persistence layer — ownership, isolation from real Trade
 *  data, historical Strategy snapshot freezing, and DB round-trips. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `replay-trade-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function inProgressSession(userId: string) {
  const session = await createReplayReviewSession(userId, {
    reviewType: "WEEKLY",
    startDate: "2026-08-03",
    endDate: "2026-08-09",
  });
  await startReplayReviewSession(userId, session.id);
  return session;
}

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

const T0 = new Date("2026-08-04T14:00:00.000Z").getTime();

function candle(minutesOffset: number, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: T0 + minutesOffset * 60_000, open: o, high: h, low: l, close: c, volume: null };
}

describe("createReplayDecision — TAKEN / SKIPPED", () => {
  it("belongs only to its ReplayReviewSession — isolated from a second session", async () => {
    const user = await makeUser("isolation");
    const sessionA = await inProgressSession(user.id);
    const sessionB = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await startReplayReviewSession(user.id, sessionB.id);

    await createReplayDecision(user.id, sessionA.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "SKIPPED",
      selectedConditionIds: [],
    });

    expect(await listReplayTrades(user.id, sessionA.id)).toHaveLength(1);
    expect(await listReplayTrades(user.id, sessionB.id)).toHaveLength(0);
  });

  it("rejects creating a replay decision on a DRAFT (not yet started) session", async () => {
    const user = await makeUser("draft-guard");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await expect(
      createReplayDecision(user.id, session.id, {
        historicalTimestamp: T0,
        assetSymbol: "XAUUSD",
        direction: "LONG",
        decisionType: "SKIPPED",
        selectedConditionIds: [],
      }),
    ).rejects.toThrow();
  });

  it("SKIPPED has no simulated order and no PnL", async () => {
    const user = await makeUser("skipped");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "SHORT",
      decisionType: "SKIPPED",
      selectedConditionIds: [],
    });
    expect(trade.decisionType).toBe("SKIPPED");
    expect(trade.lifecycle).toBe("PLANNED");
    expect(trade.simulatedEntry).toBeNull();
    expect(trade.realizedReplayR).toBe(0);
  });

  it("MISSED is never auto-created by any decision-creation path", async () => {
    const user = await makeUser("no-missed");
    const session = await inProgressSession(user.id);
    await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "SKIPPED",
      selectedConditionIds: [],
    });
    const rows = await prisma.replayTrade.findMany({ where: { sessionId: session.id } });
    expect(rows.every((r) => r.decisionType !== "MISSED")).toBe(true);
  });

  it("TAKEN market order fills immediately at the given entry — LONG", async () => {
    const user = await makeUser("taken-market-long");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
    expect(trade.lifecycle).toBe("OPEN");
    expect(trade.simulatedEntry).toBe(1900);
    expect(trade.plannedStopLoss).toBe(1890);
    expect(trade.targets).toHaveLength(1);
  });

  it("TAKEN market order fills immediately — SHORT", async () => {
    const user = await makeUser("taken-market-short");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "SHORT",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1910,
      targets: [{ price: 1880, percentToClose: 100 }],
    });
    expect(trade.lifecycle).toBe("OPEN");
    expect(trade.simulatedEntry).toBe(1900);
  });

  it("never creates, references, or mutates a real Trade row", async () => {
    const user = await makeUser("no-real-trade-mutation");
    const session = await inProgressSession(user.id);

    const before = await prisma.trade.count({ where: { userId: user.id } });
    await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "SKIPPED",
      selectedConditionIds: [],
    });
    const after = await prisma.trade.count({ where: { userId: user.id } });
    expect(after).toBe(before);

    const realTrade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
    const reloadedRealTrade = await prisma.trade.findUniqueOrThrow({ where: { id: realTrade.id } });
    expect(reloadedRealTrade.actualRR).toBeNull();
  });

  it("rejects reading/mutating another user's replay trade", async () => {
    const owner = await makeUser("rt-owner");
    const attacker = await makeUser("rt-attacker");
    const session = await inProgressSession(owner.id);
    const trade = await createReplayDecision(owner.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    expect(await getReplayTrade(attacker.id, trade.id)).toBeNull();
    await expect(moveReplayTradeStopLoss(attacker.id, trade.id, 1895, T0 + 60_000)).rejects.toThrow();
    await expect(closeReplayTradeRemainingManually(attacker.id, trade.id, 1905, T0 + 60_000)).rejects.toThrow();
    await expect(deleteReplayTrade(attacker.id, trade.id)).rejects.toThrow();
  });
});

describe("advanceReplayTradeExecution — deterministic candle processing", () => {
  async function openTrade(userId: string, sessionId: string) {
    return createReplayDecision(userId, sessionId, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [
        { price: 1910, percentToClose: 30 },
        { price: 1920, percentToClose: 30 },
        { price: 1930, percentToClose: 40 },
      ],
    });
  }

  it("closes at the stop loss and computes realized R = -1", async () => {
    const user = await makeUser("advance-sl");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    const updated = await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1902, 1888, 1889)]);
    expect(updated.lifecycle).toBe("CLOSED");
    expect(updated.closeReason).toBe("STOP_LOSS");
    expect(updated.realizedReplayR).toBeCloseTo(-1, 4);
    expect(updated.simulatedExit).toBe(1890);
  });

  it("processes the exact spec example: 30%@1R + 30%@2R + 40%@3R = 2.10R", async () => {
    const user = await makeUser("advance-multi-target");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    const updated = await advanceReplayTradeExecution(user.id, trade.id, [
      candle(1, 1900, 1911, 1899, 1910),
      candle(2, 1910, 1921, 1909, 1920),
      candle(3, 1920, 1931, 1919, 1930),
    ]);
    expect(updated.lifecycle).toBe("CLOSED");
    expect(updated.closeReason).toBe("TARGET");
    expect(updated.realizedReplayR).toBeCloseTo(2.1, 4);
    expect(updated.partialExits).toHaveLength(3);
    expect(updated.partialExits.every((p) => p.source === "TARGET_HIT")).toBe(true);
  });

  it("is idempotent — processing the same candles twice never double-fills or double-closes", async () => {
    const user = await makeUser("advance-idempotent");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);
    const candles = [candle(1, 1900, 1902, 1888, 1889)];

    const first = await advanceReplayTradeExecution(user.id, trade.id, candles);
    const second = await advanceReplayTradeExecution(user.id, trade.id, candles);

    expect(first.realizedReplayR).toBeCloseTo(-1, 4);
    expect(second.realizedReplayR).toBeCloseTo(-1, 4); // unchanged, not doubled
    const events = await prisma.replayTradeExecutionEvent.findMany({ where: { replayTradeId: trade.id, eventType: "FULL_CLOSE" } });
    expect(events).toHaveLength(1); // exactly one FULL_CLOSE event, not two
  });

  it("resumes correctly after a simulated reload (re-fetch + re-advance from persisted state)", async () => {
    const user = await makeUser("advance-resume");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1911, 1899, 1910)]);
    const reloaded = await getReplayTrade(user.id, trade.id);
    expect(reloaded?.lifecycle).toBe("PARTIALLY_CLOSED");
    expect(reloaded?.remainingPercent).toBeCloseTo(70, 4);

    // "Reload" — fresh fetch, then continue advancing from where the DB says we are.
    const final = await advanceReplayTradeExecution(user.id, trade.id, [
      candle(2, 1910, 1921, 1909, 1920),
      candle(3, 1920, 1931, 1919, 1930),
    ]);
    expect(final.lifecycle).toBe("CLOSED");
    expect(final.realizedReplayR).toBeCloseTo(2.1, 4);
  });

  it("is a no-op for SKIPPED decisions", async () => {
    const user = await makeUser("advance-skipped-noop");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "SKIPPED",
      selectedConditionIds: [],
    });
    const updated = await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1950, 1850, 1900)]);
    expect(updated.lifecycle).toBe("PLANNED");
    expect(updated.realizedReplayR).toBe(0);
  });

  it("ambiguous SL+target candle halts processing until manually resolved", async () => {
    const user = await makeUser("advance-ambiguous");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    const halted = await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1911, 1888, 1905)]);
    expect(halted.pendingAmbiguity).not.toBeNull();
    expect(halted.lifecycle).toBe("OPEN"); // never auto-resolved toward the profitable outcome

    const resolved = await resolveReplayTradeAmbiguity(user.id, trade.id, "SL_FIRST");
    expect(resolved.pendingAmbiguity).toBeNull();
    expect(resolved.lifecycle).toBe("CLOSED");
    expect(resolved.closeReason).toBe("STOP_LOSS");
    expect(resolved.realizedReplayR).toBeCloseTo(-1, 4);
  });
});

describe("manual management actions", () => {
  async function openTrade(userId: string, sessionId: string) {
    return createReplayDecision(userId, sessionId, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
  }

  it("moving the stop loss never redefines the original 1R basis", async () => {
    const user = await makeUser("move-sl");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    const moved = await moveReplayTradeStopLoss(user.id, trade.id, 1895, T0 + 60_000);
    expect(moved.currentStopLoss).toBe(1895);
    expect(moved.plannedStopLoss).toBe(1890); // original 1R basis untouched

    const closed = await closeReplayTradeRemainingManually(user.id, trade.id, 1895, T0 + 120_000);
    // Exit AT the moved (breakeven-ish) stop is still -0.5R against the
    // ORIGINAL 10-point risk (1900 -> 1890), not 0R — moving the stop to
    // 1895 never redefines what 1R means.
    expect(closed.realizedReplayR).toBeCloseTo(-0.5, 4);
  });

  it("breakeven-with-preserved-partials: a partial win followed by a breakeven remainder keeps the partial gain", async () => {
    const user = await makeUser("breakeven-preserved");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 50 }],
    });

    const afterPartial = await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1921, 1899, 1920)]);
    expect(afterPartial.realizedReplayR).toBeCloseTo(1, 4); // 50% * 2R
    expect(afterPartial.lifecycle).toBe("PARTIALLY_CLOSED");

    const closedBE = await closeReplayTradeRemainingManually(user.id, trade.id, 1900, T0 + 120_000);
    expect(closedBE.lifecycle).toBe("CLOSED");
    expect(closedBE.realizedReplayR).toBeCloseTo(1, 4); // partial gain preserved, remainder contributes 0
  });

  it("manual partial close then manual full close", async () => {
    const user = await makeUser("manual-partial-full");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);

    const partial = await closeReplayTradePartialManually(user.id, trade.id, 50, 1910, T0 + 60_000);
    expect(partial.remainingPercent).toBeCloseTo(50, 4);
    expect(partial.partialExits[0].source).toBe("MANUAL");

    const full = await closeReplayTradeRemainingManually(user.id, trade.id, 1900, T0 + 120_000);
    expect(full.lifecycle).toBe("CLOSED");
    expect(full.remainingPercent).toBe(0);
  });

  it("cancels a pending order without ever filling it", async () => {
    const user = await makeUser("cancel-pending");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "PENDING",
      entryPrice: 1895,
      initialStopLoss: 1885,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
    expect(trade.lifecycle).toBe("PENDING");

    const cancelled = await cancelReplayTradePendingOrder(user.id, trade.id, T0 + 60_000);
    expect(cancelled.lifecycle).toBe("CANCELLED");

    // A pending order price never reached must never fill after cancellation.
    const stillCancelled = await advanceReplayTradeExecution(user.id, trade.id, [candle(2, 1895, 1900, 1893, 1899)]);
    expect(stillCancelled.lifecycle).toBe("CANCELLED");
    expect(stillCancelled.simulatedEntry).toBeNull();
  });

  it("a pending order never fills before price actually reaches the entry", async () => {
    const user = await makeUser("pending-no-early-fill");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "PENDING",
      entryPrice: 1895,
      initialStopLoss: 1885,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    const untouched = await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1905, 1898, 1902)]);
    expect(untouched.lifecycle).toBe("PENDING");
    expect(untouched.simulatedEntry).toBeNull();

    const filled = await advanceReplayTradeExecution(user.id, trade.id, [candle(2, 1898, 1899, 1893, 1896)]);
    expect(filled.lifecycle).toBe("OPEN");
    expect(filled.simulatedEntry).toBe(1895);
  });

  it("rejects a management action timestamped before the trade's fill time", async () => {
    const user = await makeUser("action-before-fill");
    const session = await inProgressSession(user.id);
    const trade = await openTrade(user.id, session.id);
    await expect(moveReplayTradeStopLoss(user.id, trade.id, 1895, T0 - 60_000)).rejects.toThrow();
  });
});

describe("historical StrategyVersion resolution + frozen validation snapshot (Stage 14 §3-7)", () => {
  async function fixture(label: string) {
    const user = await makeUser(label);
    const strategy = await createStrategy(user.id, { name: `Strategy ${label}`, description: undefined });
    const item = await createChecklistItem(user.id, strategy.id, "CONFLUENCE", {
      name: "Liquidity Sweep",
      color: "GRAY",
      mandatory: true,
      directionApplicability: "BOTH",
      enabled: true,
    });
    const setupType = await createSetupType(user.id, strategy.id, { name: "Setup A" });
    const [withScenarios] = await listSetupTypesWithScenarios(user.id, strategy.id);
    const bullish = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
    await addScenarioCondition(user.id, bullish.id, { checklistItemId: item.id });

    const published = await publishStrategyVersion(user.id, strategy.id, null);
    // Backdate so later assertions can place `atTime` unambiguously after it.
    await prisma.strategyVersion.update({
      where: { strategyId_version: { strategyId: strategy.id, version: published.version } },
      data: { createdAt: new Date(T0 - 24 * 60 * 60_000) },
    });
    return { userId: user.id, strategyId: strategy.id, setupTypeId: setupType.id, itemId: item.id };
  }

  it("resolves the historically valid version and validates the setup against it", async () => {
    const { userId, strategyId, itemId } = await fixture("resolve");
    const session = await inProgressSession(userId);

    const trade = await createReplayDecision(userId, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      strategyId,
      setupTypeName: "Setup A",
      selectedConditionIds: [itemId],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    expect(trade.strategyVersionSnapshot).toBe(1);
    expect(trade.validationState).toBe("VALIDATED");
  });

  it("a later Strategy Lab rename/re-publish never alters an already-created decision's frozen snapshot", async () => {
    const { userId, strategyId, itemId } = await fixture("frozen-snapshot");
    const session = await inProgressSession(userId);
    const trade = await createReplayDecision(userId, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      strategyId,
      setupTypeName: "Setup A",
      selectedConditionIds: [itemId],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    await renameStrategy(userId, strategyId, "Renamed Later");
    await publishStrategyVersion(userId, strategyId, "v2 after rename");

    const reloaded = await getReplayTrade(userId, trade.id);
    expect(reloaded?.strategyNameSnapshot).not.toBe("Renamed Later");
    expect(reloaded?.strategyVersionSnapshot).toBe(1);
    expect(reloaded?.validationState).toBe("VALIDATED");
  });

  it("no historically valid version → safe rejection, never a silent fallback to live config", async () => {
    const user = await makeUser("no-historical-version");
    const strategy = await createStrategy(user.id, { name: "Never Published", description: undefined });
    const session = await inProgressSession(user.id);

    await expect(
      createReplayDecision(user.id, session.id, {
        historicalTimestamp: T0,
        assetSymbol: "XAUUSD",
        direction: "LONG",
        decisionType: "TAKEN",
        strategyId: strategy.id,
        setupTypeName: "Setup A",
        selectedConditionIds: [],
        orderType: "MARKET",
        entryPrice: 1900,
        initialStopLoss: 1890,
        targets: [],
      }),
    ).rejects.toThrow(/historical/i);
  });
});

describe("isolation from real performance data", () => {
  it("multiple ReplayTrades in one session are fully isolated from each other", async () => {
    const user = await makeUser("multi-isolation");
    const session = await inProgressSession(user.id);
    const a = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
    const b = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0 + 3_600_000,
      assetSymbol: "EURUSD",
      direction: "SHORT",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1.1,
      initialStopLoss: 1.11,
      targets: [{ price: 1.08, percentToClose: 100 }],
    });

    await advanceReplayTradeExecution(user.id, a.id, [candle(1, 1900, 1902, 1888, 1889)]); // A stops out
    const reloadedA = await getReplayTrade(user.id, a.id);
    const reloadedB = await getReplayTrade(user.id, b.id);
    expect(reloadedA?.lifecycle).toBe("CLOSED");
    expect(reloadedB?.lifecycle).toBe("OPEN"); // untouched by A's execution
    expect(reloadedB?.realizedReplayR).toBe(0);
  });

  it("Replay execution never touches TradeAccountAllocation, Performance Account, or canonical Analytics", async () => {
    const user = await makeUser("no-perf-mutation");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    const beforeAllocations = await prisma.tradeAccountAllocation.count({ where: { trade: { userId: user.id } } });
    await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1925, 1899, 1920)]);
    const afterAllocations = await prisma.tradeAccountAllocation.count({ where: { trade: { userId: user.id } } });
    expect(afterAllocations).toBe(beforeAllocations);

    const tradeCount = await prisma.trade.count({ where: { userId: user.id } });
    expect(tradeCount).toBe(0);
  });
});

describe("deleteReplayTrade", () => {
  it("cascades to targets, partial exits, and execution events", async () => {
    const user = await makeUser("delete-cascade");
    const session = await inProgressSession(user.id);
    const trade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
    await advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1925, 1899, 1920)]);

    await deleteReplayTrade(user.id, trade.id);
    expect(await prisma.replayTradePlannedTarget.findMany({ where: { replayTradeId: trade.id } })).toHaveLength(0);
    expect(await prisma.replayTradePartialExit.findMany({ where: { replayTradeId: trade.id } })).toHaveLength(0);
    expect(await prisma.replayTradeExecutionEvent.findMany({ where: { replayTradeId: trade.id } })).toHaveLength(0);
  });
});

describe("Stage 15.2 §26 — COMPLETED session immutability", () => {
  async function completedSessionWithOpenTrade(userId: string) {
    const session = await inProgressSession(userId);
    const trade = await createReplayDecision(userId, session.id, {
      historicalTimestamp: T0,
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });
    await completeReplayReviewSession(userId, session.id);
    return { session, trade };
  }

  it("rejects every ReplayTrade mutation once the session is COMPLETED", async () => {
    const user = await makeUser("completed-guard");
    const { trade } = await completedSessionWithOpenTrade(user.id);

    await expect(advanceReplayTradeExecution(user.id, trade.id, [candle(1, 1900, 1902, 1888, 1889)])).rejects.toThrow(/completed/i);
    await expect(moveReplayTradeStopLoss(user.id, trade.id, 1895, T0 + 60_000)).rejects.toThrow(/completed/i);
    await expect(closeReplayTradePartialManually(user.id, trade.id, 50, 1910, T0 + 60_000)).rejects.toThrow(/completed/i);
    await expect(closeReplayTradeRemainingManually(user.id, trade.id, 1905, T0 + 60_000)).rejects.toThrow(/completed/i);
    await expect(deleteReplayTrade(user.id, trade.id)).rejects.toThrow(/completed/i);
  });

  it("rejects creating a new ReplayTrade once the session is COMPLETED", async () => {
    const user = await makeUser("completed-guard-create");
    const { session } = await completedSessionWithOpenTrade(user.id);

    await expect(
      createReplayDecision(user.id, session.id, {
        historicalTimestamp: T0,
        assetSymbol: "EURUSD",
        direction: "LONG",
        decisionType: "SKIPPED",
        selectedConditionIds: [],
      }),
    ).rejects.toThrow();
  });

  it("reopening the session (an explicit, controlled action) restores mutability", async () => {
    const user = await makeUser("reopen");
    const { session, trade } = await completedSessionWithOpenTrade(user.id);

    await expect(moveReplayTradeStopLoss(user.id, trade.id, 1895, T0 + 60_000)).rejects.toThrow(/completed/i);

    await reopenReplayReviewSession(user.id, session.id);
    const moved = await moveReplayTradeStopLoss(user.id, trade.id, 1895, T0 + 60_000);
    expect(moved.currentStopLoss).toBe(1895);
  });

  it("rejects reopening a session that isn't COMPLETED", async () => {
    const user = await makeUser("reopen-not-completed");
    const session = await inProgressSession(user.id);
    await expect(reopenReplayReviewSession(user.id, session.id)).rejects.toThrow();
  });

  it("does not touch the frozen Actual baseline when completing/reopening", async () => {
    const user = await makeUser("reopen-baseline-unchanged");
    const { session } = await completedSessionWithOpenTrade(user.id);
    const before = await prisma.replayReviewSession.findUniqueOrThrow({ where: { id: session.id } });

    await reopenReplayReviewSession(user.id, session.id);

    const after = await prisma.replayReviewSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.actualBaselineSnapshot).toEqual(before.actualBaselineSnapshot);
  });
});
