import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { createTrade, updateTrade } from "@/server/services/trades.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration coverage for direction-aware confluence scoring through the
 *  actual save path (createTrade / updateTrade + the frozen strategy snapshot). */

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `cf-dir-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    },
  });
}

const confluence = (over: Record<string, unknown>) =>
  strategyChecklistItemSchema.parse({ name: "x", color: "GRAY", ...over });

function tradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: 2,
    actualRR: null,
    performanceClosingPnlGross: 0,
    performanceClosingPnlNet: 0,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no",
      riskManaged: "yes",
      followedExitPlan: "yes",
      alignedWithBias: "yes",
      influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no",
      outcomeWillInfluenceNext: "no",
      monitoringObsession: 10,
    },
    ...overrides,
  } as TradeInput;
}

describe("direction-aware confluence scoring (save path)", () => {
  let userId: string;
  let strategyId: string;

  beforeAll(async () => {
    const user = await makeUser("save");
    userId = user.id;
    const strategy = await createStrategy(userId, { name: "Dir Strategy", description: undefined });
    strategyId = strategy.id;

    await createChecklistItem(
      userId,
      strategyId,
      "CONFLUENCE",
      confluence({ name: "Bull MSB", weight: 40, directionApplicability: "BULLISH" }),
    );
    await createChecklistItem(
      userId,
      strategyId,
      "CONFLUENCE",
      confluence({ name: "Bear MSB", weight: 40, directionApplicability: "BEARISH" }),
    );
    await createChecklistItem(
      userId,
      strategyId,
      "CONFLUENCE",
      confluence({ name: "Key level", weight: 20, directionApplicability: "BOTH" }),
    );
    await createChecklistItem(
      userId,
      strategyId,
      "CONFLUENCE",
      confluence({
        name: "Bearish must-have",
        weight: 0,
        mandatory: true,
        directionApplicability: "BEARISH",
      }),
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("scores a LONG trade only against BULLISH + BOTH weight (bearish 40 + mandatory excluded)", async () => {
    const trade = await createTrade(
      userId,
      "2026-02-02",
      tradeInput({
        strategyId,
        direction: "LONG",
        selectedConfluences: ["Bull MSB", "Key level"],
      }),
    );
    // eligible weight = 40 + 20 = 60, all selected → 100.
    expect(trade.setupScore).toBe(100);
    expect(trade.setupValid).toBe(true); // bearish mandatory is ineligible for a long

    const snap = trade.strategyExecutionSnapshot as unknown as {
      confluences: { name: string; directionApplicability?: string }[];
    };
    const byName = Object.fromEntries(
      snap.confluences.map((c) => [c.name, c.directionApplicability]),
    );
    expect(byName["Bull MSB"]).toBe("BULLISH");
    expect(byName["Bear MSB"]).toBe("BEARISH");
    expect(byName["Key level"]).toBe("BOTH");
  });

  it("does not let a stale bearish selection drag a LONG score or shrink the denominator", async () => {
    const trade = await createTrade(
      userId,
      "2026-02-03",
      tradeInput({
        strategyId,
        direction: "LONG",
        selectedConfluences: ["Bear MSB", "Key level"],
      }),
    );
    // Bear MSB ineligible → denominator stays 60, only Key level (20) counts → 33.
    expect(trade.setupScore).toBe(33);
  });

  it("scores a SHORT trade against BEARISH + BOTH and enforces the bearish mandatory", async () => {
    const invalid = await createTrade(
      userId,
      "2026-02-04",
      tradeInput({
        strategyId,
        direction: "SHORT",
        selectedConfluences: ["Bear MSB"],
      }),
    );
    expect(invalid.setupValid).toBe(false); // "Bearish must-have" missing
    expect(invalid.setupScore).toBe(67); // 40 / 60

    const valid = await createTrade(
      userId,
      "2026-02-05",
      tradeInput({
        strategyId,
        direction: "SHORT",
        selectedConfluences: ["Bear MSB", "Key level", "Bearish must-have"],
      }),
    );
    expect(valid.setupValid).toBe(true);
    expect(valid.setupScore).toBe(100);
  });

  it("keeps a trade's frozen snapshot + score even if a strategy edit later changes direction", async () => {
    const trade = await createTrade(
      userId,
      "2026-02-06",
      tradeInput({ strategyId, direction: "LONG", selectedConfluences: ["Bull MSB", "Key level"] }),
    );
    expect(trade.setupScore).toBe(100);

    // Flip the strategy's "Bull MSB" to BEARISH after the fact.
    await prisma.strategyChecklistItem.updateMany({
      where: { strategyId, name: "Bull MSB" },
      data: { directionApplicability: "BEARISH" },
    });

    // An unrelated edit (same strategy) must not re-score against the new config.
    const edited = await updateTrade(
      userId,
      trade.id,
      tradeInput({
        strategyId,
        direction: "LONG",
        selectedConfluences: ["Bull MSB", "Key level"],
        executionMinutes: 601,
      }),
    );
    expect(edited.setupScore).toBe(100);
    const snap = edited.strategyExecutionSnapshot as unknown as {
      confluences: { name: string; directionApplicability?: string }[];
    };
    expect(snap.confluences.find((c) => c.name === "Bull MSB")?.directionApplicability).toBe(
      "BULLISH",
    );

    // Restore for any later test ordering.
    await prisma.strategyChecklistItem.updateMany({
      where: { strategyId, name: "Bull MSB" },
      data: { directionApplicability: "BULLISH" },
    });
  });
});
