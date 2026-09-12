import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade } from "@/server/services/trades.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { attachMedia, assertOwnsMediaTarget, listMedia } from "@/server/services/media.service";
import { createStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as setupTypesSvc from "@/server/services/strategy-setup-types.service";
import type { TradeInput } from "@/lib/validation/trades";

/**
 * Stage 5 — Trade Plan fast path + pre-trade psychology. Real integration
 * tests against the dev Postgres DB, same pattern as
 * trade-setup-validation.service.test.ts. The rich TradingView Screenshot
 * Trade Plan architecture itself (percentage validation, weighted R, plan
 * versioning) is already covered by domain/trade-plan/*.test.ts and
 * trade-plan.service.test.ts — these tests focus on what's new: the
 * pre-trade mood snapshot, before-trade screenshot ownership from the fast
 * path, pending/untriggered trades, and that none of this disturbs the
 * Stage 4 Setup Validation Shield.
 */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `trade-fast-path-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

describe("Pre-Trade Mood Snapshot (Stage 5)", () => {
  it("saves mood tags, intensity, and note independently on the trade", async () => {
    const user = await makeUser("mood-save");
    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({
        preTradeMoodTags: ["FOCUSED", "IMPATIENT"],
        preTradeMoodIntensity: 4,
        preTradeMoodNote: "Watching for the sweep before committing.",
      }),
    );
    expect(trade.preTradeMoodTags.slice().sort()).toEqual(["FOCUSED", "IMPATIENT"]);
    expect(trade.preTradeMoodIntensity).toBe(4);
    expect(trade.preTradeMoodNote).toBe("Watching for the sweep before committing.");
  });

  it("defaults to empty/null when no mood is recorded", async () => {
    const user = await makeUser("mood-default");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    expect(trade.preTradeMoodTags).toEqual([]);
    expect(trade.preTradeMoodIntensity).toBeNull();
    expect(trade.preTradeMoodNote).toBeNull();
  });

  it("does not leak one trade's mood snapshot into another trade for the same user", async () => {
    const user = await makeUser("mood-isolation");
    const tradeA = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({ preTradeMoodTags: ["CALM"], preTradeMoodIntensity: 2 }),
    );
    const tradeB = await createTrade(
      user.id,
      "2026-01-06",
      minimalTradeInput({ preTradeMoodTags: ["FOMO", "EXCITED"], preTradeMoodIntensity: 5 }),
    );

    const refetchedA = await prisma.trade.findUniqueOrThrow({ where: { id: tradeA.id } });
    const refetchedB = await prisma.trade.findUniqueOrThrow({ where: { id: tradeB.id } });

    expect(refetchedA.preTradeMoodTags).toEqual(["CALM"]);
    expect(refetchedA.preTradeMoodIntensity).toBe(2);
    expect(refetchedB.preTradeMoodTags.slice().sort()).toEqual(["EXCITED", "FOMO"]);
    expect(refetchedB.preTradeMoodIntensity).toBe(5);
  });
});

describe("Before-Trade screenshot ownership (Stage 5 fast path)", () => {
  it("attaches to the specific trade and is readable only by its owner", async () => {
    const owner = await makeUser("screenshot-owner");
    const other = await makeUser("screenshot-other");
    const trade = await createTrade(owner.id, "2026-01-05", minimalTradeInput());

    const item = await attachMedia({
      userId: owner.id,
      ownerType: "TRADE",
      ownerId: trade.id,
      category: "BEFORE",
      storageKey: `${owner.id}/before-${trade.id}.png`,
      fileName: "before.png",
      mimeType: "image/png",
      fileSize: 2048,
    });

    expect(await assertOwnsMediaTarget(owner.id, "TRADE", trade.id)).toBe(true);
    expect(await assertOwnsMediaTarget(other.id, "TRADE", trade.id)).toBe(false);

    const list = await listMedia(owner.id, "TRADE", trade.id);
    expect(list.map((i) => i.id)).toEqual([item.id]);
  });

  it("stays isolated to the specific trade — a sibling trade's gallery is empty", async () => {
    const user = await makeUser("screenshot-isolation");
    const tradeA = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    const tradeB = await createTrade(user.id, "2026-01-06", minimalTradeInput());

    await attachMedia({
      userId: user.id,
      ownerType: "TRADE",
      ownerId: tradeA.id,
      category: "BEFORE",
      storageKey: `${user.id}/before-${tradeA.id}.png`,
      fileName: "before-a.png",
      mimeType: "image/png",
      fileSize: 1024,
    });

    const listA = await listMedia(user.id, "TRADE", tradeA.id);
    const listB = await listMedia(user.id, "TRADE", tradeB.id);
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(0);
  });
});

describe("Pending / untriggered Trade Ideas (Stage 5 §9)", () => {
  it("a trade with a fully confirmed plan can exist with no actualEntry, still OPEN", async () => {
    const user = await makeUser("pending-idea");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput({ assetSymbol: "EURUSD" }));

    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: "15m",
      entry: 1.085,
      stopLoss: 1.08,
      targets: [
        { targetOrder: 1, label: "TP1", targetPrice: 1.09, plannedClosePercent: 30 },
        { targetOrder: 2, label: "TP2", targetPrice: 1.095, plannedClosePercent: 30 },
        { targetOrder: 3, label: "Final TP", targetPrice: 1.1, plannedClosePercent: 40 },
      ],
    });

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.actualEntry).toBeNull();
    expect(reloaded.status).toBe("OPEN");
    expect(reloaded.closedAt).toBeNull();
    expect(reloaded.reviewedAt).toBeNull();
    // Planned Realized R = 0.3*1 + 0.3*2 + 0.4*3 = 2.1R (see spec example).
    expect(reloaded.expectedRR?.toNumber()).toBeCloseTo(2.1, 4);
  });

  it("a trade with no plan at all is still a valid, saveable idea", async () => {
    const user = await makeUser("pending-no-plan");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    expect(trade.status).toBe("OPEN");
    expect(trade.plannedEntry).toBeNull();
    expect(trade.expectedRR).toBeNull();
  });
});

describe("Setup Validation Shield remains unaffected (Stage 4 + Stage 5 together)", () => {
  const confluence = (over: Record<string, unknown>) =>
    strategyChecklistItemSchema.parse({ name: "x", color: "GRAY", ...over });

  it("a trade can carry a validated Setup Type, a confirmed plan, and a mood snapshot together", async () => {
    const user = await makeUser("combined");
    const strategy = await createStrategy(user.id, { name: "Combined Strategy", description: undefined });
    const bullMandatory = await createChecklistItem(
      user.id,
      strategy.id,
      "CONFLUENCE",
      confluence({ name: "Bullish MSS", weight: 40, mandatory: true, directionApplicability: "BULLISH" }),
    );
    const setupType = await setupTypesSvc.createSetupType(user.id, strategy.id, { name: "Type A" });
    const [withScenarios] = await setupTypesSvc.listSetupTypesWithScenarios(user.id, strategy.id);
    const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
    await setupTypesSvc.addScenarioCondition(user.id, bullishScenario.id, { checklistItemId: bullMandatory.id });

    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({
        strategyId: strategy.id,
        direction: "LONG",
        setupTypeId: setupType.id,
        selectedSetupConditions: [bullMandatory.id],
        preTradeMoodTags: ["CONFIDENT", "PATIENT"],
        preTradeMoodIntensity: 3,
        preTradeMoodNote: "Textbook liquidity sweep.",
      }),
    );

    // Stage 4 shield — untouched by the new fields on the same save.
    expect(trade.setupScenarioId).toBe(bullishScenario.id);
    expect(trade.validationState).toBe("VALIDATED");

    // Stage 5 mood — persisted on the very same row.
    expect(trade.preTradeMoodTags.slice().sort()).toEqual(["CONFIDENT", "PATIENT"]);
    expect(trade.preTradeMoodIntensity).toBe(3);

    // The plan can still be confirmed afterwards, independently of both.
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: null,
      entry: 1900,
      stopLoss: 1890,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
    });
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.expectedRR?.toNumber()).toBeCloseTo(2, 4);
    // Still the same Stage 4 result — savePlan never touches setup validation.
    expect(reloaded.validationState).toBe("VALIDATED");
    expect(reloaded.preTradeMoodIntensity).toBe(3);
  });
});
