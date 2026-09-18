import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  addDirectionalEvidenceItem,
  archiveDailyAssetAnalysis,
  createOrGetDailyAssetAnalysis,
  deleteDirectionalEvidenceItem,
  getDailyMarketContextForAsset,
  getFinalBiasForAsset,
  listDailyAssetAnalyses,
  reorderDailyAssetAnalyses,
  reorderDirectionalEvidenceItems,
  toDailyAssetAnalysisDTO,
  updateDailyAssetAnalysis,
  updateDirectionalEvidenceItem,
} from "@/server/services/daily-asset-analysis.service";
import { assertOwnsMediaTarget } from "@/server/services/media.service";
import { createTrade } from "@/server/services/trades.service";
import { tradeSchema, type TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  trades.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `daily-asset-analysis-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const DATE_A = "2026-02-10";
const DATE_B = "2026-02-11";

describe("daily-asset-analysis.service — Stage 2", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  it("find-or-creates one analysis per (day, asset) — no duplicates", async () => {
    const user = await makeUser("idempotent");
    userIds.push(user.id);

    const first = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "xauusd");
    const second = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");

    expect(second.id).toBe(first.id);
    expect(first.assetSymbol).toBe("XAUUSD"); // normalized upper-case

    const list = await listDailyAssetAnalyses(user.id, DATE_A);
    expect(list).toHaveLength(1);
  });

  it("keeps two different assets on the same day as separate analyses", async () => {
    const user = await makeUser("isolation");
    userIds.push(user.id);

    const gold = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    const eurusd = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "EURUSD");

    expect(gold.id).not.toBe(eurusd.id);

    await updateDailyAssetAnalysis(user.id, gold.id, { finalBias: "LONG" });
    await updateDailyAssetAnalysis(user.id, eurusd.id, { finalBias: "SHORT" });

    const list = await listDailyAssetAnalyses(user.id, DATE_A);
    const goldAfter = list.find((a) => a.id === gold.id);
    const eurusdAfter = list.find((a) => a.id === eurusd.id);
    expect(goldAfter?.finalBias).toBe("LONG");
    expect(eurusdAfter?.finalBias).toBe("SHORT");
  });

  it("scopes analyses correctly by trading day — the same asset on two different days is two rows", async () => {
    const user = await makeUser("day-scope");
    userIds.push(user.id);

    const dayA = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "NAS100");
    const dayB = await createOrGetDailyAssetAnalysis(user.id, DATE_B, "NAS100");

    expect(dayA.id).not.toBe(dayB.id);
    expect(await listDailyAssetAnalyses(user.id, DATE_A)).toHaveLength(1);
    expect(await listDailyAssetAnalyses(user.id, DATE_B)).toHaveLength(1);
  });

  it("never leaks one user's analyses to another user, even for the same date/asset", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    userIds.push(owner.id, other.id);

    await createOrGetDailyAssetAnalysis(owner.id, DATE_A, "GBPUSD");

    expect(await listDailyAssetAnalyses(other.id, DATE_A)).toHaveLength(0);
  });

  it("persists independent technical/session/fundamental biases without forcing agreement, plus a differently-voted final bias", async () => {
    const user = await makeUser("bias-philosophy");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, {
      htfBias: "BULLISH",
      sessionBias: "BULLISH",
      fundamentalBias: "BEARISH",
      finalBias: "NEUTRAL",
    });

    const [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    expect(row.htfBias).toBe("BULLISH");
    expect(row.sessionBias).toBe("BULLISH");
    expect(row.fundamentalBias).toBe("BEARISH");
    expect(row.finalBias).toBe("NEUTRAL"); // a valid, first-class conclusion — not derived from the above
  });

  it("rejects updating another user's analysis", async () => {
    const owner = await makeUser("update-owner");
    const attacker = await makeUser("update-attacker");
    userIds.push(owner.id, attacker.id);

    const analysis = await createOrGetDailyAssetAnalysis(owner.id, DATE_A, "USDJPY");
    await expect(
      updateDailyAssetAnalysis(attacker.id, analysis.id, { finalBias: "LONG" }),
    ).rejects.toThrow();
  });

  it("soft-deletes on archive — hidden from listing, but the row survives", async () => {
    const user = await makeUser("archive");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "US30");
    await archiveDailyAssetAnalysis(user.id, analysis.id);

    expect(await listDailyAssetAnalyses(user.id, DATE_A)).toHaveLength(0);
    const raw = await prisma.dailyAssetAnalysis.findUnique({ where: { id: analysis.id } });
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("scopes screenshot ownership (assertOwnsMediaTarget) to the analysis's own user", async () => {
    const owner = await makeUser("media-owner");
    const attacker = await makeUser("media-attacker");
    userIds.push(owner.id, attacker.id);

    const analysis = await createOrGetDailyAssetAnalysis(owner.id, DATE_A, "EURJPY");

    expect(await assertOwnsMediaTarget(owner.id, "DAILY_ASSET_ANALYSIS", analysis.id)).toBe(true);
    expect(await assertOwnsMediaTarget(attacker.id, "DAILY_ASSET_ANALYSIS", analysis.id)).toBe(false);
    expect(await assertOwnsMediaTarget(owner.id, "DAILY_ASSET_ANALYSIS", "does-not-exist")).toBe(false);
  });

  it("reorders analyses within a day", async () => {
    const user = await makeUser("reorder");
    userIds.push(user.id);

    const a = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "AUDUSD");
    const b = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "USDCAD");

    await reorderDailyAssetAnalyses(user.id, DATE_A, [b.id, a.id]);

    const list = await listDailyAssetAnalyses(user.id, DATE_A);
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("getFinalBiasForAsset is read-only — never creates an analysis just by asking", async () => {
    const user = await makeUser("final-bias-readonly");
    userIds.push(user.id);

    expect(await getFinalBiasForAsset(user.id, DATE_A, "XAUUSD")).toBeNull();
    expect(await listDailyAssetAnalyses(user.id, DATE_A)).toHaveLength(0);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "SHORT" });
    expect(await getFinalBiasForAsset(user.id, DATE_A, "xauusd")).toBe("SHORT");
  });
});

describe("daily-asset-analysis.service — Stage 11 (Daily Market Plan consolidation)", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  it("persists asset-specific fundamentalNotes independent of fundamentalBias", async () => {
    const user = await makeUser("fundamental-notes");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, {
      fundamentalBias: "BULLISH",
      fundamentalNotes: { type: "doc", content: [{ type: "text", text: "USD weakness" }] },
    });

    const [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    expect(row.fundamentalBias).toBe("BULLISH");
    expect(row.fundamentalNotes).not.toBeNull();
  });

  it("adds, toggles, and removes Directional Evidence items — computed summary matches the domain function", async () => {
    const user = await makeUser("evidence-crud");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    const a = await addDirectionalEvidenceItem(user.id, analysis.id, "Major support holding", "BULLISH");
    const b = await addDirectionalEvidenceItem(user.id, analysis.id, "Sell-side liquidity swept", "BULLISH");
    const c = await addDirectionalEvidenceItem(user.id, analysis.id, "Major resistance overhead", "BEARISH");

    let [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    let dto = toDailyAssetAnalysisDTO(row);
    expect(dto.evidenceItems).toHaveLength(3);
    expect(dto.evidenceSummary.bullishCount).toBe(2);
    expect(dto.evidenceSummary.bearishCount).toBe(1);
    expect(dto.evidenceSummary.leadingDirection).toBe("BULLISH");
    expect(dto.evidenceSummary.suggestedBias).toBe("LONG");

    // Uncheck one bullish item — the tally must reflect it immediately.
    await updateDirectionalEvidenceItem(user.id, a.id, { checked: false });
    [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    dto = toDailyAssetAnalysisDTO(row);
    expect(dto.evidenceSummary.bullishCount).toBe(1);
    expect(dto.evidenceSummary.leadingDirection).toBe("BALANCED");
    expect(dto.evidenceSummary.suggestedBias).toBeNull();

    // Removing the bearish item leaves bullish leading again (item `a` is
    // still present, just unchecked — unchecking never deletes).
    await deleteDirectionalEvidenceItem(user.id, c.id);
    [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    dto = toDailyAssetAnalysisDTO(row);
    expect(dto.evidenceItems.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(dto.evidenceSummary.leadingDirection).toBe("BULLISH");
  });

  it("no evidence recorded produces no leader — evidence is genuinely optional", async () => {
    const user = await makeUser("evidence-optional");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "SHORT" });

    const [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    const dto = toDailyAssetAnalysisDTO(row);
    expect(dto.evidenceItems).toHaveLength(0);
    expect(dto.evidenceSummary.leadingDirection).toBe("NONE");
    // The manual final bias stands regardless — evidence never blocks it.
    expect(dto.finalBias).toBe("SHORT");
  });

  it("evidence items on one asset never leak into another asset's summary", async () => {
    const user = await makeUser("evidence-isolation");
    userIds.push(user.id);

    const gold = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    const eur = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "EURUSD");
    await addDirectionalEvidenceItem(user.id, gold.id, "Bullish HTF structure", "BULLISH");
    await addDirectionalEvidenceItem(user.id, gold.id, "Bullish fundamental catalyst", "BULLISH");

    const list = await listDailyAssetAnalyses(user.id, DATE_A);
    const goldDto = toDailyAssetAnalysisDTO(list.find((a) => a.id === gold.id)!);
    const eurDto = toDailyAssetAnalysisDTO(list.find((a) => a.id === eur.id)!);
    expect(goldDto.evidenceSummary.bullishCount).toBe(2);
    expect(eurDto.evidenceItems).toHaveLength(0);
    expect(eurDto.evidenceSummary.leadingDirection).toBe("NONE");
  });

  it("reorders evidence items within an asset", async () => {
    const user = await makeUser("evidence-reorder");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    const a = await addDirectionalEvidenceItem(user.id, analysis.id, "First", "BULLISH");
    const b = await addDirectionalEvidenceItem(user.id, analysis.id, "Second", "BULLISH");

    await reorderDirectionalEvidenceItems(user.id, analysis.id, [b.id, a.id]);

    const [row] = await listDailyAssetAnalyses(user.id, DATE_A);
    expect(row.directionalEvidenceItems.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("rejects mutating another user's evidence item", async () => {
    const owner = await makeUser("evidence-owner");
    const attacker = await makeUser("evidence-attacker");
    userIds.push(owner.id, attacker.id);

    const analysis = await createOrGetDailyAssetAnalysis(owner.id, DATE_A, "XAUUSD");
    const item = await addDirectionalEvidenceItem(owner.id, analysis.id, "Major support", "BULLISH");

    await expect(updateDirectionalEvidenceItem(attacker.id, item.id, { checked: false })).rejects.toThrow();
    await expect(deleteDirectionalEvidenceItem(attacker.id, item.id)).rejects.toThrow();
  });

  it("getDailyMarketContextForAsset reuses the SAME analysis Trade Idea would read — live finalBias + evidence, read-only", async () => {
    const user = await makeUser("market-context");
    userIds.push(user.id);

    expect(await getDailyMarketContextForAsset(user.id, DATE_A, "XAUUSD")).toBeNull();

    const analysis = await createOrGetDailyAssetAnalysis(user.id, DATE_A, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "LONG" });
    await addDirectionalEvidenceItem(user.id, analysis.id, "Major support holding", "BULLISH");
    await addDirectionalEvidenceItem(user.id, analysis.id, "Major resistance overhead", "BEARISH");
    await addDirectionalEvidenceItem(user.id, analysis.id, "Bullish HTF structure", "BULLISH");

    const context = await getDailyMarketContextForAsset(user.id, DATE_A, "xauusd");
    expect(context?.finalBias).toBe("LONG");
    expect(context?.evidenceSummary.bullishCount).toBe(2);
    expect(context?.evidenceSummary.bearishCount).toBe(1);
    expect(context?.evidenceSummary.suggestedBias).toBe("LONG");

    // Still read-only — never creates an analysis for an asset with none.
    expect(await getDailyMarketContextForAsset(user.id, DATE_A, "EURUSD")).toBeNull();
  });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return tradeSchema.parse({
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    ...overrides,
  });
}

// Today V2 (T3) — DailyAssetAnalysis.activeStrategyId: a per-asset day-plan
// preference, a form DEFAULT for new Trade Ideas, never a historical trade
// owner (see the schema's own doc comment).
describe("daily-asset-analysis.service — activeStrategyId (Today V2 T3)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  async function makeStrategy(userId: string, name: string) {
    const last = await prisma.strategy.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" } });
    return prisma.strategy.create({ data: { userId, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
  }

  async function firstAnalysisDTO(userId: string, dateKey: string) {
    const rows = await listDailyAssetAnalyses(userId, dateKey);
    return toDailyAssetAnalysisDTO(rows[0]);
  }

  it("1. saves activeStrategyId and it round-trips through the DTO", async () => {
    const user = await makeUser("active-strategy-save");
    userIds.push(user.id);
    const strategy = await makeStrategy(user.id, "London Continuation");

    const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-11-01", "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategy.id });

    const dto = await firstAnalysisDTO(user.id, "2026-11-01");
    expect(dto.activeStrategyId).toBe(strategy.id);
    expect(dto.activeStrategyName).toBe("London Continuation");
  });

  it("2. rejects attaching another user's strategy", async () => {
    const owner = await makeUser("active-strategy-owner");
    const attacker = await makeUser("active-strategy-attacker");
    userIds.push(owner.id, attacker.id);
    const othersStrategy = await makeStrategy(owner.id, "Not Yours");

    const analysis = await createOrGetDailyAssetAnalysis(attacker.id, "2026-11-02", "EURUSD");
    await expect(
      updateDailyAssetAnalysis(attacker.id, analysis.id, { activeStrategyId: othersStrategy.id }),
    ).rejects.toThrow("Strategy not found.");

    const dto = await firstAnalysisDTO(attacker.id, "2026-11-02");
    expect(dto.activeStrategyId).toBeNull();
  });

  it("3. a hard-deleted strategy clears activeStrategyId (onDelete: SetNull)", async () => {
    const user = await makeUser("active-strategy-setnull");
    userIds.push(user.id);
    const strategy = await makeStrategy(user.id, "Temporary");

    const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-11-03", "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategy.id });
    expect((await firstAnalysisDTO(user.id, "2026-11-03")).activeStrategyId).toBe(strategy.id);

    await prisma.strategy.delete({ where: { id: strategy.id } });

    const reloaded = await prisma.dailyAssetAnalysis.findUniqueOrThrow({ where: { id: analysis.id } });
    expect(reloaded.activeStrategyId).toBeNull();
  });

  it("4. an analysis with no active strategy remains a fully valid row", async () => {
    const user = await makeUser("active-strategy-none");
    userIds.push(user.id);

    const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-11-04", "GBPUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "LONG" });

    const dto = await firstAnalysisDTO(user.id, "2026-11-04");
    expect(dto.activeStrategyId).toBeNull();
    expect(dto.activeStrategyName).toBeNull();
    expect(dto.finalBias).toBe("LONG");
  });

  it("6. two assets on the same day can carry different active strategies", async () => {
    const user = await makeUser("active-strategy-per-asset");
    userIds.push(user.id);
    const london = await makeStrategy(user.id, "London Continuation");
    const nyReversal = await makeStrategy(user.id, "NY Reversal");

    const xau = await createOrGetDailyAssetAnalysis(user.id, "2026-11-06", "XAUUSD");
    const eur = await createOrGetDailyAssetAnalysis(user.id, "2026-11-06", "EURUSD");
    await updateDailyAssetAnalysis(user.id, xau.id, { activeStrategyId: london.id });
    await updateDailyAssetAnalysis(user.id, eur.id, { activeStrategyId: nyReversal.id });

    const rows = await listDailyAssetAnalyses(user.id, "2026-11-06");
    const dtos = rows.map(toDailyAssetAnalysisDTO);
    expect(dtos.find((d) => d.assetSymbol === "XAUUSD")?.activeStrategyName).toBe("London Continuation");
    expect(dtos.find((d) => d.assetSymbol === "EURUSD")?.activeStrategyName).toBe("NY Reversal");
  });

  it("7. changing the day's active strategy afterward never mutates an already-created Trade's strategy", async () => {
    const user = await makeUser("active-strategy-no-retro-mutate");
    userIds.push(user.id);
    const strategyA = await makeStrategy(user.id, "Strategy A");
    const strategyB = await makeStrategy(user.id, "Strategy B");

    const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-11-07", "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategyA.id });

    // Simulates the form defaulting Trade.strategyId from the day's active
    // strategy at creation time — a plain value passed through createTrade,
    // never a server-side link to DailyAssetAnalysis itself.
    const trade = await createTrade(
      user.id,
      "2026-11-07",
      minimalTradeInput({ assetSymbol: "XAUUSD", strategyId: strategyA.id }),
    );
    expect(trade.strategyId).toBe(strategyA.id);

    // The trader (or someone else) later changes today's plan preference...
    await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategyB.id });

    // ...the already-created Trade must be completely unaffected.
    const reloadedTrade = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloadedTrade.strategyId).toBe(strategyA.id);
    expect(reloadedTrade.strategyNameSnapshot).toBe("Strategy A");
  });
});
