import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { attachMedia, assertOwnsMediaTarget, listMedia } from "@/server/services/media.service";
import { createStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as setupTypesSvc from "@/server/services/strategy-setup-types.service";
import { setReviewLifecycleStatus, getTradeReviewData } from "@/server/services/trade-review.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Trade Review overhaul (Stage 7) — real integration tests against the dev
 *  Postgres DB, same pattern as trade-idea-fast-path.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `trade-review-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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
  };
}

describe("Trade lifecycle status (Stage 7 §1)", () => {
  it("accepts all four states and stores a cancellation reason only for CANCELLED_NEVER_TRIGGERED", async () => {
    const user = await makeUser("lifecycle-states");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());

    for (const status of ["FULLY_CLOSED", "PARTIALLY_CLOSED", "STILL_HOLDING"] as const) {
      await setReviewLifecycleStatus(user.id, trade.id, { status });
      const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
      expect(row.reviewLifecycleStatus).toBe(status);
      expect(row.cancellationReason).toBeNull();
    }

    await setReviewLifecycleStatus(user.id, trade.id, {
      status: "CANCELLED_NEVER_TRIGGERED",
      cancellationReason: "News event invalidated the setup.",
    });
    const cancelled = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(cancelled.reviewLifecycleStatus).toBe("CANCELLED_NEVER_TRIGGERED");
    expect(cancelled.cancellationReason).toBe("News event invalidated the setup.");

    // Switching away clears the stale reason.
    await setReviewLifecycleStatus(user.id, trade.id, { status: "STILL_HOLDING" });
    const reopened = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reopened.cancellationReason).toBeNull();
  });
});

describe("Cancelled / never-triggered Trade Ideas (Stage 7 §11)", () => {
  it("never computes a fake realized R or PnL, and preserves the plan/pre-trade evidence", async () => {
    const user = await makeUser("cancelled-idea");
    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({ preTradeMoodTags: ["PATIENT"], preTradeMoodIntensity: 4 }),
    );
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: null,
      entry: 1900,
      stopLoss: 1890,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
    });
    await setReviewLifecycleStatus(user.id, trade.id, {
      status: "CANCELLED_NEVER_TRIGGERED",
      cancellationReason: "Never triggered — price ran away.",
    });

    const data = await getTradeReviewData(user.id, trade.id);
    expect(data.reviewLifecycleStatus).toBe("CANCELLED_NEVER_TRIGGERED");
    expect(data.performance.realizedR).toBeNull();
    expect(data.performance.pnl).toBeNull();
    expect(data.performance.settled).toBe(false);
    expect(data.plannedVsActual.actual.entry).toBeNull();
    expect(data.plannedVsActual.actual.realizedRSoFar).toBeNull();
    // The plan is still fully preserved even though the idea never executed.
    expect(data.plannedVsActual.planned.entry).toBe(1900);
    expect(data.plannedVsActual.planned.realizedR).toBeCloseTo(2, 4);

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.preTradeMoodTags).toEqual(["PATIENT"]);
    expect(row.actualRR).toBeNull();
  });
});

describe("Realized R progress through the real actual-execution flow (Stage 7 §3/§12)", () => {
  it("a still-holding trade has a partial realized R with an open remainder, and Trade.actualRR stays null", async () => {
    const user = await makeUser("still-holding");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    await upsertPartialExit(user.id, trade.id, {
      exitOrder: 1,
      exitPrice: 1910,
      percentClosed: 50,
      exitedAt: new Date("2026-01-05T14:00:00Z"),
    });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "STILL_HOLDING" });

    const data = await getTradeReviewData(user.id, trade.id);
    expect(data.plannedVsActual.actual.isFullyClosed).toBe(false);
    expect(data.plannedVsActual.actual.remainingProportionPercent).toBe(50);
    expect(data.plannedVsActual.actual.realizedRSoFar).toBeCloseTo(0.5, 4); // 50% * 1R
    expect(data.performance.settled).toBe(false);

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.actualRR).toBeNull();
  });

  it("a fully closed trade (via two partials) gets an automatic realized R, PnL, and Trade.actualRR — never typed manually", async () => {
    const user = await makeUser("fully-closed");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    await upsertPartialExit(user.id, trade.id, {
      exitOrder: 1,
      exitPrice: 1910, // +1R
      percentClosed: 50,
      exitedAt: new Date("2026-01-05T14:00:00Z"),
    });
    await upsertPartialExit(user.id, trade.id, {
      exitOrder: 2,
      exitPrice: 1920, // +2R
      percentClosed: 50,
      exitedAt: new Date("2026-01-05T15:00:00Z"),
    });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const data = await getTradeReviewData(user.id, trade.id);
    expect(data.plannedVsActual.actual.isFullyClosed).toBe(true);
    expect(data.plannedVsActual.actual.realizedRSoFar).toBeCloseTo(1.5, 4); // 0.5*1 + 0.5*2
    expect(data.performance.settled).toBe(true);
    expect(data.performance.realizedR).toBeCloseTo(1.5, 4);
    expect(data.performance.pnl).not.toBeNull();

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.actualRR?.toNumber()).toBeCloseTo(1.5, 4);
  });
});

describe("After-trade screenshot ownership (Stage 7 §6)", () => {
  it("attaches to the specific trade under the AFTER category and stays isolated per trade/user", async () => {
    const owner = await makeUser("after-owner");
    const other = await makeUser("after-other");
    const trade = await createTrade(owner.id, "2026-01-05", minimalTradeInput());
    const sibling = await createTrade(owner.id, "2026-01-06", minimalTradeInput());

    const item = await attachMedia({
      userId: owner.id,
      ownerType: "TRADE",
      ownerId: trade.id,
      category: "AFTER",
      storageKey: `${owner.id}/after-${trade.id}.png`,
      fileName: "after.png",
      mimeType: "image/png",
      fileSize: 2048,
      timeframe: "4H",
    });

    expect(await assertOwnsMediaTarget(owner.id, "TRADE", trade.id)).toBe(true);
    expect(await assertOwnsMediaTarget(other.id, "TRADE", trade.id)).toBe(false);

    const list = await listMedia(owner.id, "TRADE", trade.id);
    expect(list.map((i) => i.id)).toEqual([item.id]);
    expect(list[0].timeframe).toBe("4H");

    expect(await listMedia(owner.id, "TRADE", sibling.id)).toHaveLength(0);
  });
});

describe("Reflection fields isolated per trade (Stage 7 §7)", () => {
  it("whatCouldImprove on Trade A never leaks into Trade B", async () => {
    const user = await makeUser("reflection-isolation");
    const tradeA = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    const tradeB = await createTrade(user.id, "2026-01-06", minimalTradeInput());

    await updateTradeSections(user.id, tradeA.id, { whatCouldImprove: "Wait for the retest next time." });
    await updateTradeSections(user.id, tradeB.id, { whatCouldImprove: "Size down on news days." });

    const a = await prisma.trade.findUniqueOrThrow({ where: { id: tradeA.id } });
    const b = await prisma.trade.findUniqueOrThrow({ where: { id: tradeB.id } });
    expect(a.whatCouldImprove).toBe("Wait for the retest next time.");
    expect(b.whatCouldImprove).toBe("Size down on news days.");
  });
});

describe("Stage 4/5 snapshots remain unchanged by Stage 7 actions (Stage 7 §13)", () => {
  it("setup validation snapshot and the plan's latest version are untouched by lifecycle/partial-exit/label edits", async () => {
    const user = await makeUser("snapshots-unchanged");
    const strategy = await createStrategy(user.id, { name: "Snapshot Strategy", description: undefined });
    const mandatory = await createChecklistItem(
      user.id,
      strategy.id,
      "CONFLUENCE",
      strategyChecklistItemSchema.parse({
        name: "Bullish MSS",
        color: "GRAY",
        weight: 50,
        mandatory: true,
        directionApplicability: "BULLISH",
      }),
    );
    const setupType = await setupTypesSvc.createSetupType(user.id, strategy.id, { name: "Type A" });
    const [withScenarios] = await setupTypesSvc.listSetupTypesWithScenarios(user.id, strategy.id);
    const bullish = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
    await setupTypesSvc.addScenarioCondition(user.id, bullish.id, { checklistItemId: mandatory.id });

    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({
        strategyId: strategy.id,
        direction: "LONG",
        setupTypeId: setupType.id,
        selectedSetupConditions: [mandatory.id],
      }),
    );
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: null,
      entry: 1900,
      stopLoss: 1890,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
    });
    // Lock it (actual entry) so the setup snapshot is in its permanent, frozen state.
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900 });

    const before = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const planBefore = await prisma.tradePlanVersion.findFirst({
      where: { tradeId: trade.id },
      orderBy: { versionNumber: "desc" },
    });

    // A battery of Stage 7 actions that must never touch either snapshot.
    await setReviewLifecycleStatus(user.id, trade.id, { status: "STILL_HOLDING" });
    await upsertPartialExit(user.id, trade.id, {
      exitOrder: 1,
      exitPrice: 1910,
      percentClosed: 50,
      exitedAt: new Date(),
    });
    await updateTradeSections(user.id, trade.id, { whatCouldImprove: "Trail the stop sooner." });

    const after = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const planAfter = await prisma.tradePlanVersion.findFirst({
      where: { tradeId: trade.id },
      orderBy: { versionNumber: "desc" },
    });

    expect(after.setupValidationSnapshot).toEqual(before.setupValidationSnapshot);
    expect(after.validationState).toBe(before.validationState);
    expect(planAfter?.id).toBe(planBefore?.id); // no new version was created
    expect(planAfter?.entry?.toString()).toBe(planBefore?.entry?.toString());
  });
});
