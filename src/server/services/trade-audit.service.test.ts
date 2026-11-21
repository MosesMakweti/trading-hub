import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { assertOwnsMediaTarget, deleteMediaAttachment } from "@/server/services/media.service";
import {
  createCommitmentFromAudit,
  createExpectedTrade,
  deleteExpectedTrade,
  ensureUploadOwner,
  finalizeAudit,
  loadAuditWorkspace,
  reopenAudit,
  resolveCarriedCommitment,
  saveAnnotation,
  saveDayAudit,
  saveTradeAssessment,
  saveWeeklyAssessment,
  setDayStatus,
  TradeAuditError,
  updateExpectedTrade,
} from "@/server/services/trade-audit.service";
import { getActiveCommitmentsForToday, setCommitmentDailyState } from "@/server/services/edge-review-commitment.service";
import { createExpectedTradeSchema } from "@/lib/validation/trade-audit";

vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, deleteMediaFile: vi.fn(async () => {}) };
});

const userIds: string[] = [];
afterAll(async () => {
  await prisma.tradeAccountAllocation.deleteMany({ where: { tradingAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function makeUser(label: string) {
  const user = await prisma.user.create({ data: { email: `trade-audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` } });
  userIds.push(user.id);
  return user;
}

const WEEK = "2026-11-16"; // Mon 16 … Sun 22 November 2026
const scope = (overrides: Partial<{ strategyId: string | null; assetSymbols: string[] }> = {}) => ({ weekStart: WEEK, strategyId: null, assetSymbols: [], ...overrides });

let tradeCounter = 0;
function makeTrade(
  userId: string,
  dateKey: string,
  overrides: Partial<{ assetSymbol: string; strategyId: string | null; actualEntry: number; actualExit: number; executionMinutes: number; validationState: "VALIDATED" | "OVERRIDDEN"; deletedAt: Date }> = {},
) {
  tradeCounter += 1;
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date(`${dateKey}T00:00:00.000Z`),
      executionMinutes: overrides.executionMinutes ?? 9 * 60 + tradeCounter,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      assetSymbol: overrides.assetSymbol ?? "XAUUSD",
      strategyId: overrides.strategyId ?? null,
      plannedEntry: 2400,
      plannedStopLoss: 2390,
      plannedTarget: 2430,
      actualEntry: overrides.actualEntry ?? 2401,
      actualExit: overrides.actualExit ?? null,
      validationState: overrides.validationState ?? null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function attachImage(userId: string, ownerType: "TRADE" | "OPPORTUNITY", ownerId: string, createdAt: Date) {
  const media = await prisma.mediaAsset.create({
    data: { userId, storageKey: `${userId}/test-${Math.random().toString(36).slice(2)}.png`, fileName: "chart.png", mimeType: "image/png", fileSize: 10, url: "/api/media/x" },
  });
  return prisma.mediaAttachment.create({ data: { mediaId: media.id, ownerType, ownerId, category: "BEFORE", createdAt } });
}

const allTrades = (ws: Awaited<ReturnType<typeof loadAuditWorkspace>>) => ws.days.flatMap((d) => d.trades);

describe("retrieving and grouping the week's trades", () => {
  it("returns only this week's live trades, grouped by trading day, with empty days kept", async () => {
    const user = await makeUser("grouping");
    const monA = await makeTrade(user.id, "2026-11-16");
    const monB = await makeTrade(user.id, "2026-11-16");
    const thu = await makeTrade(user.id, "2026-11-19");
    await makeTrade(user.id, "2026-11-15"); // Sunday before — previous week
    await makeTrade(user.id, "2026-11-23"); // Monday after — next week
    await makeTrade(user.id, "2026-11-17", { deletedAt: new Date() }); // soft-deleted

    const ws = await loadAuditWorkspace(user.id, scope());
    expect(ws.week).toEqual({ weekStart: "2026-11-16", weekEnd: "2026-11-22" });
    expect(ws.days.map((d) => d.dateKey)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(ws.days[0].trades.map((t) => t.id)).toEqual([monA.id, monB.id]); // multiple trades, in entry order
    expect(ws.days[1].trades).toEqual([]); // empty day still present
    expect(ws.days[3].trades.map((t) => t.id)).toEqual([thu.id]);
    expect(allTrades(ws)).toHaveLength(3);
    expect(ws.audit).toBeNull(); // nothing is created just by looking
    expect(ws.days.every((d) => d.status === "NOT_STARTED")).toBe(true);
  });

  it("shows a weekend trade on its own (unscheduled) day instead of dropping it", async () => {
    const user = await makeUser("weekend");
    const sat = await makeTrade(user.id, "2026-11-21");
    const ws = await loadAuditWorkspace(user.id, scope());
    const day = ws.days.find((d) => d.dateKey === "2026-11-21");
    expect(day?.schedule).toBe("UNSCHEDULED");
    expect(day?.trades.map((t) => t.id)).toEqual([sat.id]);
  });

  it("maps real trade facts and never invents missing ones", async () => {
    const user = await makeUser("facts");
    await makeTrade(user.id, "2026-11-18", { validationState: "OVERRIDDEN" });
    const [t] = allTrades(await loadAuditWorkspace(user.id, scope()));
    expect(t).toMatchObject({ assetSymbol: "XAUUSD", direction: "LONG", plannedEntry: 2400, plannedStopLoss: 2390, plannedTarget: 2430, actualEntry: 2401 });
    expect(t.actualExit).toBeNull();
    expect(t.positionSize).toBeNull(); // not recorded → not guessed
    expect(t.risk).toBeNull();
    expect(t.systemFlags.map((f) => f.key)).toContain("VALIDATION_OVERRIDDEN");
  });

  it("filters by strategy and instrument", async () => {
    const user = await makeUser("filters");
    const strategy = await prisma.strategy.create({ data: { userId: user.id, name: "London Sweep" } });
    const inStrategy = await makeTrade(user.id, "2026-11-17", { strategyId: strategy.id });
    await makeTrade(user.id, "2026-11-17");
    const eur = await makeTrade(user.id, "2026-11-18", { assetSymbol: "EURUSD" });

    expect(allTrades(await loadAuditWorkspace(user.id, scope({ strategyId: strategy.id }))).map((t) => t.id)).toEqual([inStrategy.id]);
    expect(allTrades(await loadAuditWorkspace(user.id, scope({ assetSymbols: ["eurusd"] }))).map((t) => t.id)).toEqual([eur.id]);
  });

  it("isolates users: another trader's trades never appear and can't be assessed", async () => {
    const owner = await makeUser("iso-owner");
    const intruder = await makeUser("iso-intruder");
    const trade = await makeTrade(owner.id, "2026-11-17");
    expect(allTrades(await loadAuditWorkspace(intruder.id, scope()))).toHaveLength(0);
    await expect(saveTradeAssessment(intruder.id, scope(), trade.id, { verdict: "INVALID" })).rejects.toThrow(TradeAuditError);
  });

  it("rejects a week that doesn't start on Monday", async () => {
    const user = await makeUser("bad-week");
    await expect(loadAuditWorkspace(user.id, { weekStart: "2026-11-18", strategyId: null, assetSymbols: [] })).rejects.toThrow(/Monday/);
  });
});

describe("expected vs actual decisions", () => {
  it("records an invalid trade with mistake, weakness and improvement as separate fields — idempotently", async () => {
    const user = await makeUser("invalid");
    const trade = await makeTrade(user.id, "2026-11-17");
    await saveTradeAssessment(user.id, scope(), trade.id, {
      verdict: "INVALID",
      invalidReasons: ["EARLY_ENTRY"],
      mistake: "Entered before confirmation.",
      weaknesses: ["IMPATIENCE"],
      underlyingWeakness: "Impatience — didn't wait for the full setup.",
      improvement: "Only enter after the predefined confirmation condition is satisfied.",
    });
    await saveTradeAssessment(user.id, scope(), trade.id, { executionQuality: 2 });

    expect(await prisma.tradeAuditAssessment.count({ where: { tradeId: trade.id } })).toBe(1);
    const ws = await loadAuditWorkspace(user.id, scope());
    const day = ws.days.find((d) => d.dateKey === "2026-11-17")!;
    expect(day.status).toBe("IN_PROGRESS");
    expect(day.assessments[trade.id]).toMatchObject({
      verdict: "INVALID",
      invalidReasons: ["EARLY_ENTRY"],
      executionQuality: 2,
      mistake: "Entered before confirmation.",
      weaknesses: ["IMPATIENCE"],
      improvement: "Only enter after the predefined confirmation condition is satisfied.",
    });
    expect(ws.summary.ruleViolations).toBe(1);
  });

  it("clears 'why invalid' reasons when the verdict changes to valid", async () => {
    const user = await makeUser("valid-clears");
    const trade = await makeTrade(user.id, "2026-11-17");
    await saveTradeAssessment(user.id, scope(), trade.id, { verdict: "INVALID", invalidReasons: ["REVENGE"] });
    await saveTradeAssessment(user.id, scope(), trade.id, { verdict: "VALID" });
    const row = await prisma.tradeAuditAssessment.findFirstOrThrow({ where: { tradeId: trade.id } });
    expect(row.invalidReasons).toEqual([]);
  });

  it("records a missed opportunity once even if submitted twice, and only inside the week", async () => {
    const user = await makeUser("missed");
    const data = { assetSymbol: "eurusd", direction: "SHORT" as const, intendedEntry: 1.085, stopLoss: 1.088, target: 1.079, validityReason: "London sweep of Asia high + bearish BOS", missReason: "HESITATION" as const, weaknesses: ["FEAR_HESITATION" as const] };
    const a = await createExpectedTrade(user.id, scope(), "2026-11-18", "client-key-0001", data);
    const b = await createExpectedTrade(user.id, scope(), "2026-11-18", "client-key-0001", data);
    expect(a.id).toBe(b.id);
    await expect(createExpectedTrade(user.id, scope(), "2026-11-24", "client-key-0002", data)).rejects.toThrow(/not part of this week/);

    const ws = await loadAuditWorkspace(user.id, scope());
    const day = ws.days.find((d) => d.dateKey === "2026-11-18")!;
    expect(day.expectedTrades).toHaveLength(1);
    expect(day.expectedTrades[0]).toMatchObject({ assetSymbol: "EURUSD", direction: "SHORT", intendedEntry: 1.085, missReason: "HESITATION" });
    expect(ws.summary.missed.total).toBe(1);
  });

  it("requires a strategy-based validity reason for a missed trade (no hindsight-only misses)", () => {
    const parsed = createExpectedTradeSchema.safeParse({
      scope: scope(),
      dateKey: "2026-11-18",
      clientKey: "client-key-0003",
      data: { assetSymbol: "XAUUSD", direction: "LONG", validityReason: "   " },
    });
    expect(parsed.success).toBe(false);
  });

  it("won't let another user edit or delete an expected trade", async () => {
    const owner = await makeUser("exp-owner");
    const other = await makeUser("exp-other");
    const { id } = await createExpectedTrade(owner.id, scope(), "2026-11-18", "client-key-0004", { assetSymbol: "XAUUSD", direction: "LONG", validityReason: "valid" });
    await expect(updateExpectedTrade(other.id, id, { improvement: "x" })).rejects.toThrow(TradeAuditError);
    await expect(deleteExpectedTrade(other.id, id)).rejects.toThrow(TradeAuditError);
  });

  it("shows live MISSED opportunities alongside retrospective ones", async () => {
    const user = await makeUser("live-missed");
    await prisma.tradeOpportunity.create({
      data: { userId: user.id, spottedAt: new Date("2026-11-19T00:00:00Z"), assetSymbol: "XAUUSD", direction: "LONG", status: "MISSED", missReason: "DISTRACTED" },
    });
    const ws = await loadAuditWorkspace(user.id, scope());
    const day = ws.days.find((d) => d.dateKey === "2026-11-19")!;
    expect(day.liveMissed).toHaveLength(1);
    expect(ws.summary.missed).toMatchObject({ total: 1, live: 1, retrospective: 0 });
  });

  it("records why a no-trade day had no trades", async () => {
    const user = await makeUser("no-trade");
    await saveDayAudit(user.id, scope(), "2026-11-20", { noTradeReason: "NO_VALID_SETUP" });
    const ws = await loadAuditWorkspace(user.id, scope());
    expect(ws.days.find((d) => d.dateKey === "2026-11-20")).toMatchObject({ noTradeReason: "NO_VALID_SETUP", status: "IN_PROGRESS" });
  });
});

describe("saving and resuming", () => {
  it("keeps partial work across reloads and tracks day status explicitly", async () => {
    const user = await makeUser("resume");
    await makeTrade(user.id, "2026-11-16");
    await saveDayAudit(user.id, scope(), "2026-11-16", { wentWell: "Waited for London open." });
    await saveWeeklyAssessment(user.id, scope(), { mainLesson: "Patience pays.", patienceRating: 4 });

    const resumed = await loadAuditWorkspace(user.id, scope());
    expect(resumed.audit).toMatchObject({ status: "IN_PROGRESS", mainLesson: "Patience pays.", patienceRating: 4 });
    expect(resumed.days[0]).toMatchObject({ status: "IN_PROGRESS", wentWell: "Waited for London open." });
    // Auto-imported trades alone never mark a day reviewed.
    expect(resumed.days.filter((d) => d.status === "COMPLETED")).toHaveLength(0);

    await setDayStatus(user.id, scope(), "2026-11-16", "COMPLETED");
    const after = await loadAuditWorkspace(user.id, scope());
    expect(after.days[0].status).toBe("COMPLETED");
    expect(after.summary.days.completed).toBe(1);
  });

  it("keeps two scopes of the same week separate (no overwritten reflections)", async () => {
    const user = await makeUser("scopes");
    await saveWeeklyAssessment(user.id, scope(), { mainLesson: "All-trading lesson" });
    await saveWeeklyAssessment(user.id, scope({ assetSymbols: ["XAUUSD"] }), { mainLesson: "Gold-only lesson" });
    expect((await loadAuditWorkspace(user.id, scope())).audit?.mainLesson).toBe("All-trading lesson");
    expect((await loadAuditWorkspace(user.id, scope({ assetSymbols: ["xauusd"] }))).audit?.mainLesson).toBe("Gold-only lesson");
    expect(await prisma.weeklyTradeAudit.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe("screenshots and provenance", () => {
  it("labels session vs after-session trade images and review uploads", async () => {
    const user = await makeUser("provenance");
    const trade = await makeTrade(user.id, "2026-11-17");
    await attachImage(user.id, "TRADE", trade.id, new Date("2026-11-17T10:00:00Z"));
    await attachImage(user.id, "TRADE", trade.id, new Date("2026-11-21T10:00:00Z"));
    const owner = await ensureUploadOwner(user.id, { kind: "ASSESSMENT", scope: scope(), tradeId: trade.id });
    expect(owner.ownerType).toBe("TRADE_AUDIT_ASSESSMENT");
    const media = await prisma.mediaAsset.create({ data: { userId: user.id, storageKey: `${user.id}/r.png`, fileName: "review.png", mimeType: "image/png", fileSize: 1, url: "/api/media/r" } });
    const reviewAttachment = await prisma.mediaAttachment.create({ data: { mediaId: media.id, ownerType: owner.ownerType, ownerId: owner.ownerId } });

    const ws = await loadAuditWorkspace(user.id, scope());
    const day = ws.days.find((d) => d.dateKey === "2026-11-17")!;
    expect(day.trades[0].images.map((i) => i.provenance).sort()).toEqual(["POST_SESSION", "SESSION"]);
    expect(day.trades[0].images.every((i) => !i.removable)).toBe(true); // originals are never removable from the audit
    expect(day.assessments[trade.id].images).toEqual([expect.objectContaining({ attachmentId: reviewAttachment.id, provenance: "REVIEW", removable: true })]);
  });

  it("stores retrospective markers beside the image and locks evidence once finalized", async () => {
    const user = await makeUser("annotate");
    const trade = await makeTrade(user.id, "2026-11-17");
    const original = await attachImage(user.id, "TRADE", trade.id, new Date("2026-11-17T10:00:00Z"));
    await saveAnnotation(user.id, scope(), original.id, [{ id: "m1", kind: "INTENDED_ENTRY", x: 0.4, y: 0.6, note: "should have waited here" }]);

    const owner = await ensureUploadOwner(user.id, { kind: "DAY", scope: scope(), dateKey: "2026-11-17" });
    expect(await assertOwnsMediaTarget(user.id, owner.ownerType, owner.ownerId)).toBe(true);
    const media = await prisma.mediaAsset.create({ data: { userId: user.id, storageKey: `${user.id}/d.png`, fileName: "day.png", mimeType: "image/png", fileSize: 1, url: "/api/media/d" } });
    const dayImage = await prisma.mediaAttachment.create({ data: { mediaId: media.id, ownerType: owner.ownerType, ownerId: owner.ownerId } });

    const ws = await loadAuditWorkspace(user.id, scope());
    expect(ws.days.find((d) => d.dateKey === "2026-11-17")!.trades[0].images[0].annotation).toEqual([
      { id: "m1", kind: "INTENDED_ENTRY", x: 0.4, y: 0.6, note: "should have waited here" },
    ]);
    // The original attachment row itself is untouched.
    expect(await prisma.mediaAttachment.findUnique({ where: { id: original.id } })).toMatchObject({ ownerType: "TRADE", ownerId: trade.id });

    await finalizeAudit(user.id, scope());
    expect(await assertOwnsMediaTarget(user.id, owner.ownerType, owner.ownerId)).toBe(false); // no new uploads
    await expect(deleteMediaAttachment(user.id, dayImage.id)).rejects.toThrow(/finalized/);
    await expect(saveAnnotation(user.id, scope(), original.id, [])).rejects.toThrow(/finalized/);
  });

  it("won't annotate another user's screenshot", async () => {
    const owner = await makeUser("ann-owner");
    const other = await makeUser("ann-other");
    const trade = await makeTrade(owner.id, "2026-11-17");
    const img = await attachImage(owner.id, "TRADE", trade.id, new Date("2026-11-17T10:00:00Z"));
    await expect(saveAnnotation(other.id, scope(), img.id, [{ id: "m", kind: "NOTE", x: 0, y: 0, note: null }])).rejects.toThrow(TradeAuditError);
  });
});

describe("finalizing and historical integrity", () => {
  it("freezes the week; later trade edits are flagged, never written into the review", async () => {
    const user = await makeUser("finalize");
    const trade = await makeTrade(user.id, "2026-11-17", { actualExit: 2425 });
    await saveTradeAssessment(user.id, scope(), trade.id, { verdict: "VALID" });
    await saveWeeklyAssessment(user.id, scope(), { nextWeekPriority: "Wait for confirmation." });
    await finalizeAudit(user.id, scope());

    const finalized = await loadAuditWorkspace(user.id, scope());
    expect(finalized.audit?.status).toBe("FINALIZED");
    expect(finalized.hasFinalizedDrift).toBe(false);
    const frozenSummary = finalized.summary;

    // Edit the trade, and add a new trade to the week, AFTER finalization.
    await prisma.trade.update({ where: { id: trade.id }, data: { actualExit: 2380 } });
    await makeTrade(user.id, "2026-11-18");

    const later = await loadAuditWorkspace(user.id, scope());
    const day = later.days.find((d) => d.dateKey === "2026-11-17")!;
    expect(day.trades[0].actualExit).toBe(2425); // the frozen snapshot, not the live edit
    expect(day.changes).toEqual([expect.objectContaining({ kind: "EDITED", fields: expect.arrayContaining(["exit"]) })]);
    expect(later.days.find((d) => d.dateKey === "2026-11-18")!.changes).toEqual([expect.objectContaining({ kind: "ADDED" })]);
    expect(later.days.find((d) => d.dateKey === "2026-11-18")!.trades).toHaveLength(0);
    expect(later.hasFinalizedDrift).toBe(true);
    expect(later.summary).toEqual(frozenSummary);

    // Every write is refused until the trader explicitly reopens.
    await expect(saveWeeklyAssessment(user.id, scope(), { mainLesson: "x" })).rejects.toThrow(/finalized/);
    await expect(saveTradeAssessment(user.id, scope(), trade.id, { verdict: "INVALID" })).rejects.toThrow(/finalized/);
    await expect(saveDayAudit(user.id, scope(), "2026-11-17", { mainLesson: "x" })).rejects.toThrow(/finalized/);
    await expect(createExpectedTrade(user.id, scope(), "2026-11-17", "client-key-0005", { assetSymbol: "X", direction: "LONG", validityReason: "v" })).rejects.toThrow(/finalized/);
    await expect(finalizeAudit(user.id, scope())).rejects.toThrow(/finalized/);

    await reopenAudit(user.id, scope());
    const reopened = await loadAuditWorkspace(user.id, scope());
    expect(reopened.audit?.status).toBe("IN_PROGRESS");
    expect(reopened.audit?.reopenedAt).not.toBeNull();
    expect(reopened.days.find((d) => d.dateKey === "2026-11-17")!.trades[0].actualExit).toBe(2380); // live again
    expect(reopened.unacknowledgedChanges).toBe(1); // the edit since assessment is flagged
  });

  it("blocks finalizing over an unacknowledged trade edit until it's re-checked", async () => {
    const user = await makeUser("ack");
    const trade = await makeTrade(user.id, "2026-11-17");
    await saveTradeAssessment(user.id, scope(), trade.id, { verdict: "VALID" });
    await prisma.trade.update({ where: { id: trade.id }, data: { actualEntry: 2410 } });

    const ws = await loadAuditWorkspace(user.id, scope());
    expect(ws.unacknowledgedChanges).toBe(1);
    await expect(finalizeAudit(user.id, scope())).rejects.toThrow(/changed after you assessed/);

    await saveTradeAssessment(user.id, scope(), trade.id, {}); // re-check acknowledges
    expect((await loadAuditWorkspace(user.id, scope())).unacknowledgedChanges).toBe(0);
    await finalizeAudit(user.id, scope());
  });

  it("detects a trade moved to another day of the week", async () => {
    const user = await makeUser("moved");
    const trade = await makeTrade(user.id, "2026-11-17");
    await saveTradeAssessment(user.id, scope(), trade.id, { verdict: "VALID" });
    await prisma.trade.update({ where: { id: trade.id }, data: { tradeDate: new Date("2026-11-19T00:00:00Z") } });
    const ws = await loadAuditWorkspace(user.id, scope());
    const thursday = ws.days.find((d) => d.dateKey === "2026-11-19")!;
    expect(thursday.trades.map((t) => t.id)).toEqual([trade.id]);
    expect(thursday.changes[0]).toMatchObject({ kind: "MOVED", fields: ["date"] });
  });
});

describe("commitments as optional follow-through", () => {
  it("a commitment from a finalized audit is surfaced on Today and governs from the NEXT week", async () => {
    const user = await makeUser("commitment");
    await makeTrade(user.id, "2026-11-17");
    const { id } = await createCommitmentFromAudit(user.id, scope(), { category: "BEHAVIOR", title: "Wait for confirmation", description: null, priority: "HIGH" });
    const row = await prisma.edgeReviewCommitment.findUniqueOrThrow({ where: { id } });
    expect(row.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-11-23");

    expect((await getActiveCommitmentsForToday(user.id)).weekly).toHaveLength(0); // not until the week is finalized
    await finalizeAudit(user.id, scope());
    expect((await getActiveCommitmentsForToday(user.id)).weekly.map((c) => c.id)).toEqual([id]);
  });

  it("automatic evidence never scores a commitment against the week that created it (audit #1)", async () => {
    const user = await makeUser("no-self-penalty");
    await makeTrade(user.id, "2026-11-17", { validationState: "OVERRIDDEN" }); // the behaviour that triggered it
    const { id } = await createCommitmentFromAudit(user.id, scope(), { category: "EXECUTION", title: "Only validated setups", description: null, priority: "HIGH" });
    await prisma.edgeReviewCommitment.update({ where: { id }, data: { sourceFindingType: "OVERRIDE_DISCIPLINE" } });
    await finalizeAudit(user.id, scope());
    expect(await prisma.edgeReviewCommitmentDailyState.count({ where: { commitmentId: id } })).toBe(0);

    // The NEXT week's override is evidence — and it upgrades a neutral
    // "acknowledged" tap instead of being hidden by it (audit #2).
    await makeTrade(user.id, "2026-11-24", { validationState: "OVERRIDDEN" });
    await setCommitmentDailyState(user.id, id, new Date("2026-11-24T00:00:00Z"), "ACKNOWLEDGED", "saw it");
    await finalizeAudit(user.id, { weekStart: "2026-11-23", strategyId: null, assetSymbols: [] });
    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { commitmentId: id } });
    expect(states).toEqual([expect.objectContaining({ status: "BREACHED", source: "SYSTEM", note: "saw it" })]);
  });

  it("carries a still-active commitment into the next week so it keeps surfacing on Today", async () => {
    const user = await makeUser("carry-forward");
    const { id } = await createCommitmentFromAudit(user.id, scope(), { category: "BEHAVIOR", title: "Wait for confirmation", description: null, priority: "HIGH" });
    await finalizeAudit(user.id, scope());

    const next = { weekStart: "2026-11-23", strategyId: null, assetSymbols: [] };
    // An earlier week never offers a later review's commitments (audit #5).
    expect((await loadAuditWorkspace(user.id, { weekStart: "2026-11-09", strategyId: null, assetSymbols: [] })).carryForward).toEqual([]);
    expect((await loadAuditWorkspace(user.id, next)).carryForward.map((c) => c.id)).toEqual([id]);

    await resolveCarriedCommitment(user.id, next, id, "CONTINUE");
    const ws = await loadAuditWorkspace(user.id, next);
    expect(ws.carryForward).toEqual([]);
    expect(ws.commitments).toEqual([expect.objectContaining({ title: "Wait for confirmation", status: "ACTIVE", periodStart: "2026-11-23" })]);
    await expect(resolveCarriedCommitment(user.id, next, id, "CONTINUE")).rejects.toThrow(TradeAuditError); // can't double-continue

    await finalizeAudit(user.id, next);
    expect((await getActiveCommitmentsForToday(user.id)).weekly.map((c) => c.title)).toEqual(["Wait for confirmation"]);
  });
});
