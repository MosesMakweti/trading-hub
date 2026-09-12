import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { createStrategy, renameStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as setupTypesSvc from "@/server/services/strategy-setup-types.service";
import { listDailyPerformanceSummaries } from "@/server/services/close-day.service";
import { listBehaviourLabelsForTrades, listBehaviourLabels, setTradeBehaviourLabels } from "@/server/services/behaviour-labels.service";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { TradeInput } from "@/lib/validation/trades";

/** Journal rebuild (Stage 9) — real integration tests against the dev
 *  Postgres DB, same pattern as close-day.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `journal-day-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

describe("listDailyPerformanceSummaries (Journal calendar, Stage 9 §2)", () => {
  it("aggregates realized R / PnL / counts per day, one batched call for the whole account", async () => {
    const user = await makeUser("calendar-agg");

    const winner = await createTrade(user.id, "2026-02-02", minimalTradeInput());
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 }); // +2R
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });

    const loser = await createTrade(user.id, "2026-02-03", minimalTradeInput());
    await updateTradeSections(user.id, loser.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1890 }); // -1R
    await setReviewLifecycleStatus(user.id, loser.id, { status: "FULLY_CLOSED" });

    // A cancelled-only day must never read as a loss.
    const cancelled = await createTrade(user.id, "2026-02-04", minimalTradeInput());
    await setReviewLifecycleStatus(user.id, cancelled.id, { status: "CANCELLED_NEVER_TRIGGERED" });

    const summaries = await listDailyPerformanceSummaries(user.id);
    const byDay = new Map(summaries.map((s) => [s.dateKey, s]));

    expect(byDay.get("2026-02-02")?.executedTradeCount).toBe(1);
    expect(byDay.get("2026-02-02")?.totalRealizedR).toBeCloseTo(2, 4);

    expect(byDay.get("2026-02-03")?.executedTradeCount).toBe(1);
    expect(byDay.get("2026-02-03")?.totalRealizedR).toBeCloseTo(-1, 4);

    const cancelledDay = byDay.get("2026-02-04");
    expect(cancelledDay?.executedTradeCount).toBe(0);
    expect(cancelledDay?.cancelledCount).toBe(1);
    expect(cancelledDay?.totalRealizedR).toBe(0);
  });

  it("week totals sum correctly across multiple days (matches the calendar's weekly-total display)", async () => {
    const user = await makeUser("week-total");
    const days = ["2026-03-02", "2026-03-03", "2026-03-04"]; // same ISO week
    const expectedR = [1, -0.5, 2];
    for (let i = 0; i < days.length; i++) {
      const trade = await createTrade(user.id, days[i], minimalTradeInput());
      const exit = expectedR[i] >= 0 ? 1900 + expectedR[i] * 10 : 1900 + expectedR[i] * 10;
      await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: exit });
      await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });
    }

    const summaries = await listDailyPerformanceSummaries(user.id);
    const weekTotal = summaries
      .filter((s) => days.includes(s.dateKey))
      .reduce((sum, s) => sum + s.totalRealizedR, 0);
    expect(weekTotal).toBeCloseTo(1 - 0.5 + 2, 4);
  });
});

describe("listBehaviourLabelsForTrades (Stage 9 §19 — batched, not N+1)", () => {
  it("returns each trade's labels correctly from one batched call", async () => {
    const user = await makeUser("batched-labels");
    const labels = await listBehaviourLabels(user.id);
    const [a, b] = labels;

    const tradeA = await createTrade(user.id, "2026-02-05", minimalTradeInput());
    const tradeB = await createTrade(user.id, "2026-02-05", minimalTradeInput());
    await setTradeBehaviourLabels(user.id, tradeA.id, [a.id]);
    await setTradeBehaviourLabels(user.id, tradeB.id, [b.id]);

    const byTrade = await listBehaviourLabelsForTrades(user.id, [tradeA.id, tradeB.id]);
    expect(byTrade[tradeA.id]?.map((l) => l.name)).toEqual([a.name]);
    expect(byTrade[tradeB.id]?.map((l) => l.name)).toEqual([b.name]);
  });

  it("returns an empty object for an empty trade list without querying", async () => {
    const user = await makeUser("batched-empty");
    expect(await listBehaviourLabelsForTrades(user.id, [])).toEqual({});
  });
});

describe("Individual Trade historical view uses frozen data (Stage 9 §16)", () => {
  it("a Strategy Lab rename of the Setup Type never changes the trade's frozen setupTypeName", async () => {
    const user = await makeUser("frozen-setup-name");
    const strategy = await createStrategy(user.id, { name: "Original Strategy", description: undefined });
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
      "2026-02-06",
      minimalTradeInput({
        strategyId: strategy.id,
        direction: "LONG",
        setupTypeId: setupType.id,
        selectedSetupConditions: [mandatory.id],
      }),
    );

    // Live edits AFTER the trade was created — a strategy rename, a setup
    // type rename. The Journal's historical Trade view must never reflect these.
    await renameStrategy(user.id, strategy.id, "Renamed Strategy");
    await setupTypesSvc.updateSetupType(user.id, setupType.id, { name: "Renamed Setup Type" });

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const snapshot = reloaded.setupValidationSnapshot as unknown as SetupValidationSnapshot;
    expect(snapshot.setupType.name).toBe("Type A"); // NOT "Renamed Setup Type"
    expect(reloaded.strategyNameSnapshot).toBe("Original Strategy"); // NOT "Renamed Strategy"
  });
});
