import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { tradeSchema } from "@/lib/validation/trades";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { createQuickIdea, recordFirstEntry } from "@/server/services/today-trade.service";
import { createTrade, getTrade, updateTrade, updateTradeSections } from "@/server/services/trades.service";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { settlePerformanceTrade, updatePerformanceConfig } from "@/server/services/performance-account.service";
import { upsertUserInstrumentSpec } from "@/server/services/instrument-spec.service";
import { getV3ReviewData } from "@/server/services/trade-review-v3.service";
import { getDayCloseSummary } from "@/server/services/close-day.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { deleteDataSection } from "@/server/services/data-management.service";
import {
  QuantityLedgerEntryError,
  QuantityLedgerError,
  correctFill,
  enterQuantityLedgerTrade,
  getPerformanceLedger,
  recordCloseFill,
} from "@/server/services/position-ledger.service";

/** Quantity ledger (Phase 2) — Performance Account ledger, end to end against the test DB. */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
afterEach(() => {
  delete process.env.QUANTITY_LEDGER;
});
const flagOn = () => (process.env.QUANTITY_LEDGER = "on");
const flagOff = () => delete process.env.QUANTITY_LEDGER;
const at = (dateKey: string, minutes: number) => new Date(`${dateKey}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`);

async function readyUser(label: string, dateKeys: string[]) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
  await prisma.routineItem.create({
    data: { userId: user.id, sectionId: section.id, label: "Optional", type: "CHECKBOX", isMandatory: false, sortOrder: 0 },
  });
  await runLive(async () => {
    for (const dateKey of dateKeys) {
      const day = await getOrCreateTradingDay(user.id, dateKey);
      await getOrCreateDayRoutine(user.id, day);
      await setRoutineReady(user.id, dateKey, true);
    }
  });
  return user;
}

async function idea(userId: string, dateKey: string, symbol = "XAUUSD", direction: "LONG" | "SHORT" = "LONG") {
  const { tradeId } = await createQuickIdea(
    userId,
    dateKey,
    quickIdeaSchema.parse({ assetSymbol: symbol, direction, nowMinutes: 590, limitOverrideReason: "test" }),
  );
  return tradeId;
}

const entry = (actualEntry: number, actualStopLoss: number | null, entryMinutes = 600) =>
  recordEntrySchema.parse({ actualEntry, actualStopLoss, entryMinutes, limitOverrideReason: "test" });

/** Flag ON → a sized QUANTITY_LEDGER XAUUSD trade: $100,000 × 1% → 0.83 lots (2000 / 1988). */
async function ledgerTrade(userId: string, dateKey: string, opts: { entry?: number; stop?: number; minutes?: number } = {}) {
  flagOn();
  const tradeId = await idea(userId, dateKey);
  await recordFirstEntry(userId, dateKey, tradeId, entry(opts.entry ?? 2000, opts.stop ?? 1988, opts.minutes ?? 600));
  return tradeId;
}

const canonical = async (tradeId: string) => {
  const t = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { performanceRiskSnapshot: true, allocations: { include: { tradingAccount: true } } },
  });
  const perf = t.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE")!;
  const s = t.performanceRiskSnapshot!;
  return {
    realizedR: s.realizedR?.toString() ?? null,
    performancePnl: s.performancePnl?.toString() ?? null,
    settled: s.settledAt != null,
    closingPnlGross: perf.closingPnlGross?.toString() ?? null,
    closingPnlNet: perf.closingPnlNet?.toString() ?? null,
    actualRR: t.actualRR?.toString() ?? null,
  };
};

const SETTLED_NULL = { realizedR: null, performancePnl: null, settled: false, closingPnlGross: null, closingPnlNet: null, actualRR: null };

// ── First entry ─────────────────────────────────────────────────────────────

describe("first entry — sizing, model selection, frozen inputs", () => {
  it("flag ON: Today V3 entry sizes a QUANTITY_LEDGER trade with frozen intended/effective risk and spec", async () => {
    const d = "2026-11-02";
    const user = await readyUser("ql-entry", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { performanceRiskSnapshot: true } });
      const s = t.performanceRiskSnapshot!;
      expect(t.executionModel).toBe("QUANTITY_LEDGER");
      expect(t.actualExit).toBeNull();
      expect([s.riskAmount.toString(), s.effectiveRiskAmount!.toString(), s.executableQuantity!.toString()]).toEqual(["1000", "996", "0.83"]);
      expect([s.initialStop!.toString(), s.initialStopSource, s.quantityUnit, s.sizingConversionRate!.toString(), s.valuePerPriceUnit!.toString()]).toEqual([
        "1988",
        "ACTUAL",
        "LOT",
        "1",
        "100",
      ]);
      expect(s.sizingVersion).toBe(1);
      expect(s.specSnapshot).toMatchObject({ symbol: "XAUUSD", contractSize: "100", quantityStep: "0.01", quoteCurrency: "USD" });
      expect(s.rawQuantity!.toString().startsWith("0.8333333333")).toBe(true);
      expect(s.settledAt).toBeNull();
      expect(t.reviewLifecycleStatus).toBe("STILL_HOLDING");
    });
  });

  it("1. flag ON + no genuine stop → INITIAL_STOP_REQUIRED, nothing written, never downgraded", async () => {
    const d = "2026-11-03";
    const user = await readyUser("ql-nostop", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d);
      const err = await recordFirstEntry(user.id, d, tradeId, entry(2000, null)).catch((e) => e);
      expect(err).toBeInstanceOf(QuantityLedgerEntryError);
      expect(err.code).toBe("INITIAL_STOP_REQUIRED");
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { performanceRiskSnapshot: true } });
      expect([t.executionModel, t.actualEntry, t.performanceRiskSnapshot]).toEqual(["LEGACY_PERCENT", null, null]);
    });
  });

  it("2. flag ON + insufficient instrument spec → INSTRUMENT_SPEC_INSUFFICIENT, not downgraded", async () => {
    const d = "2026-11-04";
    const user = await readyUser("ql-nospec", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d, "NAS100");
      const err = await recordFirstEntry(user.id, d, tradeId, entry(20000, 19950)).catch((e) => e);
      expect(err).toMatchObject({ code: "INSTRUMENT_SPEC_INSUFFICIENT" });
      expect(err.details.missing).toEqual(expect.arrayContaining(["contractSize"]));
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect([t.executionModel, t.actualEntry]).toEqual(["LEGACY_PERCENT", null]);
    });
  });

  it("3. flag ON + conversion required → CONVERSION_REQUIRED, not downgraded", async () => {
    const d = "2026-11-05";
    const user = await readyUser("ql-fx", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d, "USDJPY");
      const err = await recordFirstEntry(user.id, d, tradeId, entry(150, 149.5)).catch((e) => e);
      expect(err).toMatchObject({ code: "CONVERSION_REQUIRED", details: { from: "JPY", to: "USD" } });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).actualEntry).toBeNull();
    });
  });

  it("flag ON + minimum above the budget → CANNOT_SIZE_WITHIN_RISK (never raised to the minimum)", async () => {
    const d = "2026-11-06";
    const user = await readyUser("ql-min", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d, "ES");
      const err = await recordFirstEntry(user.id, d, tradeId, entry(5000, 4900)).catch((e) => e);
      expect(err).toMatchObject({ code: "CANNOT_SIZE_WITHIN_RISK", details: { riskAtMinQuantity: "5000", intendedRiskAmount: "1000" } });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).executionModel).toBe("LEGACY_PERCENT");
    });
  });

  it("4. flag OFF → normal LEGACY_PERCENT behavior", async () => {
    const d = "2026-11-09";
    const user = await readyUser("ql-off", [d]);
    await runLive(async () => {
      flagOff();
      const tradeId = await idea(user.id, d);
      await recordFirstEntry(user.id, d, tradeId, entry(2000, 1988));
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { performanceRiskSnapshot: true } });
      expect(t.executionModel).toBe("LEGACY_PERCENT");
      expect(t.performanceRiskSnapshot?.executableQuantity).toBeNull();
      expect(t.performanceRiskSnapshot?.riskAmount.toString()).toBe("1000");
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 2012, percentClosed: 100, exitedAt: new Date() });
      expect(await canonical(tradeId)).toMatchObject({ realizedR: "1", performancePnl: "1000", settled: true, actualRR: "1" });
    });
  });

  it("the plan stop that existed before execution is a genuine initial stop", async () => {
    const d = "2026-11-10";
    const user = await readyUser("ql-planstop", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d);
      await savePlan(user.id, tradeId, {
        direction: "LONG",
        timeframe: "15m",
        entry: 2000,
        stopLoss: 1990,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 2020, plannedClosePercent: 100 }],
      });
      await recordFirstEntry(user.id, d, tradeId, entry(2000, null));
      const s = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect([s.initialStop!.toString(), s.initialStopSource, s.executableQuantity!.toString()]).toEqual(["1990", "PLANNED", "1"]);
      expect((await prisma.tradePlanVersion.findFirstOrThrow({ where: { tradeId } })).locked).toBe(true);
    });
  });

  it("a stop entered after execution never becomes the ledger's initial stop", async () => {
    const d = "2026-11-11";
    const user = await readyUser("ql-latestop", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      await updateTradeSections(user.id, tradeId, { actualStopLoss: 1999 }); // moved to near break-even
      await settlePerformanceTrade(user.id, tradeId);
      const s = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect([s.initialStop!.toString(), s.riskAmount.toString(), s.executableQuantity!.toString()]).toEqual(["1988", "1000", "0.83"]);
    });
  });

  it("17. concurrent first-entry attempts create exactly one snapshot / model selection", async () => {
    const d = "2026-11-12";
    const user = await readyUser("ql-concurrent-entry", [d]);
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d);
      const input = { actualEntry: 2000, actualStopLoss: 1988, entryMinutes: 600 };
      const results = await Promise.allSettled([1, 2, 3].map(() => enterQuantityLedgerTrade(user.id, tradeId, input)));
      const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ created: boolean }>).value);
      expect(ok.filter((r) => r.created)).toHaveLength(1);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true); // the rest are idempotent no-ops
      expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId } })).toBe(1);
      const other = await enterQuantityLedgerTrade(user.id, tradeId, { ...input, actualEntry: 2001 }).catch((e) => e);
      expect(other).toMatchObject({ code: "ALREADY_ENTERED" });
    });
  });
});

// ── Fills + settlement ──────────────────────────────────────────────────────

describe("fills and canonical settlement", () => {
  it("19. 50% → 50% → close: exactly zero remaining; canonical outputs written; readers see it", async () => {
    const d = "2026-11-16";
    const user = await readyUser("ql-fills", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const first = await recordCloseFill(user.id, tradeId, { percentOfRemaining: 50, price: 2012, executedAt: at(d, 630) });
      expect([first.remainingQuantity, first.fullyClosed, first.settlement.status]).toEqual(["0.42", false, "NOT_CALCULABLE"]);
      expect(await canonical(tradeId)).toEqual(SETTLED_NULL);

      // Open trade: every reader sees a partially closed position via the derived projection.
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).reviewLifecycleStatus).toBe("PARTIALLY_CLOSED");
      expect(await prisma.tradeActualPartialExit.count({ where: { tradeId } })).toBe(0); // never persisted
      const review = await getV3ReviewData(user.id, tradeId);
      expect(review.state).not.toBe("FINAL_REVIEW_REQUIRED");
      const open = await getDayCloseSummary(user.id, d);
      expect(open.totalRealizedRSoFar).toBeCloseTo(0.492, 6);

      await recordCloseFill(user.id, tradeId, { percentOfRemaining: 50, price: 2024, executedAt: at(d, 660) });
      const last = await recordCloseFill(user.id, tradeId, { percentOfRemaining: 100, price: 2006, executedAt: at(d, 700) });
      expect([last.remainingQuantity, last.fullyClosed, last.settlement.status]).toEqual(["0", true, "SETTLED"]);

      const ledger = (await getPerformanceLedger(user.id, tradeId))!;
      expect(ledger.fills.map((f) => [f.sequence, f.executedQuantity, f.quantityAfter, f.grossPnl])).toEqual([
        [1, "0.41", "0.42", "492"],
        [2, "0.21", "0.21", "504"],
        [3, "0.21", "0", "126"],
      ]);
      expect(ledger.state.remainingQuantity.toString()).toBe("0");
      expect(await canonical(tradeId)).toEqual({
        realizedR: "1.122",
        performancePnl: "1122",
        settled: true,
        closingPnlGross: "1122",
        closingPnlNet: "1122",
        actualRR: "1.12",
      });

      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect([t.reviewLifecycleStatus, t.status, t.actualExit]).toEqual(["FULLY_CLOSED", "CLOSED", null]);
      expect((await getV3ReviewData(user.id, tradeId)).state).toBe("FINAL_REVIEW_REQUIRED");
      const rows = await getCanonicalAnalyticsDataset(user.id, { from: d, to: d });
      expect(rows.find((r) => r.tradeId === tradeId)).toMatchObject({ isExecuted: true, realizedR: 1.122, pnl: 1122, winLossClass: "WIN" });
      const close = await getDayCloseSummary(user.id, d);
      expect([close.totalRealizedRSoFar, close.totalPnl, close.wins]).toEqual([1.122, 1122, 1]);
    });
  });

  it("a stop-out at the rounded quantity settles at −0.996R against intended risk", async () => {
    const d = "2026-11-17";
    const user = await readyUser("ql-stopout", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      await recordCloseFill(user.id, tradeId, { quantity: "0.83", price: 1988, executedAt: at(d, 640) });
      expect(await canonical(tradeId)).toMatchObject({ realizedR: "-0.996", performancePnl: "-996", actualRR: "-1" });
    });
  });

  it("rejects over-close, off-step quantities and closes on a closed position", async () => {
    const d = "2026-11-18";
    const user = await readyUser("ql-reject", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      await expect(recordCloseFill(user.id, tradeId, { quantity: "0.84", price: 2010, executedAt: at(d, 610) })).rejects.toMatchObject({ code: "EXCEEDS_REMAINING" });
      await expect(recordCloseFill(user.id, tradeId, { quantity: "0.415", price: 2010, executedAt: at(d, 610) })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
      await recordCloseFill(user.id, tradeId, { quantity: "0.83", price: 2010, executedAt: at(d, 610) });
      await expect(recordCloseFill(user.id, tradeId, { quantity: "0.01", price: 2010, executedAt: at(d, 611) })).rejects.toMatchObject({ code: "POSITION_CLOSED" });
      expect(await prisma.positionFill.count({ where: { tradeId } })).toBe(1);
    });
  });

  it("18. concurrent fill attempts never duplicate a sequence or an economic execution", async () => {
    const d = "2026-11-19";
    const user = await readyUser("ql-concurrent-fill", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const results = await Promise.allSettled(
        [1, 2, 3].map((i) => recordCloseFill(user.id, tradeId, { quantity: "0.3", price: 2010 + i, executedAt: at(d, 620 + i) })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "EXCEEDS_REMAINING" });
      const fills = await prisma.positionFill.findMany({ where: { tradeId }, orderBy: { sequence: "asc" } });
      expect(fills.map((f) => [f.sequence, f.quantityBefore.toString(), f.quantityAfter.toString()])).toEqual([
        [1, "0.83", "0.53"],
        [2, "0.53", "0.23"],
      ]);
    });
  });
});

// ── Reversals ───────────────────────────────────────────────────────────────

describe("reversals", () => {
  it("6/20. reversing a settled trade re-opens it deterministically and clears every canonical output incl. actualRR", async () => {
    const d = "2026-11-23";
    const user = await readyUser("ql-reverse", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const { fillIds } = await recordCloseFill(user.id, tradeId, { quantity: "0.83", price: 2012, executedAt: at(d, 640) });
      expect(await canonical(tradeId)).toMatchObject({ realizedR: "0.996", actualRR: "1" });

      const res = await correctFill(user.id, tradeId, fillIds[0], { note: "wrong price" });
      expect([res.remainingQuantity, res.fullyClosed, res.settlement.status]).toEqual(["0.83", false, "NOT_CALCULABLE"]);
      expect(await canonical(tradeId)).toEqual(SETTLED_NULL);
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect([t.reviewLifecycleStatus, t.status, t.closedAt]).toEqual(["STILL_HOLDING", "OPEN", null]);

      // The original is preserved; the reversal exactly negates it.
      const fills = await prisma.positionFill.findMany({ where: { tradeId }, orderBy: { sequence: "asc" } });
      expect(fills.map((f) => [f.sequence, f.kind, f.executedQuantity.toString(), f.grossPnl.toString(), f.reversesFillId])).toEqual([
        [1, "CLOSE", "0.83", "996", null],
        [2, "REVERSAL", "0.83", "-996", fillIds[0]],
      ]);
    });
  });

  it("7. a replacement close re-settles Trade.actualRR from the complete ledger", async () => {
    const d = "2026-11-24";
    const user = await readyUser("ql-replace", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const { fillIds } = await recordCloseFill(user.id, tradeId, { quantity: "0.83", price: 2012, executedAt: at(d, 640) });
      const res = await correctFill(user.id, tradeId, fillIds[0], {
        replacement: { quantity: "0.83", price: 2006, executedAt: at(d, 640), note: "actual fill was 2006" },
      });
      expect([res.fullyClosed, res.settlement.status, res.fillIds.length]).toEqual([true, "SETTLED", 2]);
      expect(await canonical(tradeId)).toEqual({
        realizedR: "0.498",
        performancePnl: "498",
        settled: true,
        closingPnlGross: "498",
        closingPnlNet: "498",
        actualRR: "0.5",
      });
      const rep = await prisma.positionFill.findUniqueOrThrow({ where: { id: res.fillIds[1] } });
      expect([rep.kind, rep.source, rep.replacesFillId, rep.sequence]).toEqual(["CLOSE", "CORRECTION", fillIds[0], 3]);
    });
  });

  it("8/9/10/11. cross-trade, cross-owner, double and reversal-of-reversal are rejected (service + database)", async () => {
    const d = "2026-11-25";
    const user = await readyUser("ql-reverse-strict", [d]);
    await runLive(async () => {
      const a = await ledgerTrade(user.id, d, { minutes: 600 });
      const b = await ledgerTrade(user.id, d, { minutes: 610 });
      const fa = (await recordCloseFill(user.id, a, { quantity: "0.5", price: 2010, executedAt: at(d, 620) })).fillIds[0];
      const fb = (await recordCloseFill(user.id, b, { quantity: "0.5", price: 2010, executedAt: at(d, 620) })).fillIds[0];

      // 8. cross-trade: B's fill is not part of A's ledger.
      await expect(correctFill(user.id, a, fb)).rejects.toMatchObject({ code: "REVERSAL_TARGET_NOT_FOUND" });
      // another user's trade is not even visible.
      const stranger = await createTestUser("ql-stranger");
      userIds.push(stranger.id);
      await expect(correctFill(stranger.id, a, fa)).rejects.toMatchObject({ code: "TRADE_NOT_FOUND" });

      // 10/11. double reversal and reversal-of-reversal.
      const rev = (await correctFill(user.id, a, fa)).fillIds[0];
      await expect(correctFill(user.id, a, fa)).rejects.toMatchObject({ code: "REVERSAL_ALREADY_REVERSED" });
      await expect(correctFill(user.id, a, rev)).rejects.toMatchObject({ code: "REVERSAL_TARGET_NOT_CLOSE" });

      // Database backstops for malformed direct inserts.
      const snapA = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: a } });
      const snapB = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: b } });
      const target = await prisma.positionFill.findUniqueOrThrow({ where: { id: fb } });
      const base = {
        userId: user.id,
        kind: "REVERSAL" as const,
        source: "CORRECTION" as const,
        executedQuantity: target.executedQuantity,
        price: target.price,
        quantityBefore: "0.33",
        quantityAfter: "0.83",
        grossPnl: target.grossPnl.negated(),
        conversionRate: target.conversionRate,
        executedAt: new Date(),
      };
      // cross-trade: A's ledger reversing B's fill
      await expect(
        prisma.positionFill.create({ data: { ...base, tradeId: a, performanceSnapshotId: snapA.id, sequence: 9, reversesFillId: fb } }),
      ).rejects.toThrow(/REVERSAL_INVALID/);
      // 9. cross-owner: a row on trade A owned by B's ledger
      await expect(
        prisma.positionFill.create({ data: { ...base, tradeId: a, performanceSnapshotId: snapB.id, sequence: 9, reversesFillId: fb } }),
      ).rejects.toThrow(/LEDGER_OWNER/);
      // double reversal (unique reversesFillId) and reversal-of-reversal
      await expect(
        prisma.positionFill.create({ data: { ...base, tradeId: a, performanceSnapshotId: snapA.id, sequence: 9, reversesFillId: fa, quantityBefore: "0.83", quantityAfter: "1.33" } }),
      ).rejects.toThrow();
      await expect(
        prisma.positionFill.create({ data: { ...base, tradeId: a, performanceSnapshotId: snapA.id, sequence: 9, reversesFillId: rev } }),
      ).rejects.toThrow(/REVERSAL_INVALID/);
      // arbitrary quantity through a malformed reversal
      await expect(
        prisma.positionFill.create({
          data: { ...base, tradeId: b, performanceSnapshotId: snapB.id, sequence: 2, reversesFillId: fb, executedQuantity: "5", quantityBefore: "0.33", quantityAfter: "5.33" },
        }),
      ).rejects.toThrow(/REVERSAL_INVALID/);
      expect(await prisma.positionFill.count({ where: { tradeId: b } })).toBe(1);
    });
  });
});

// ── Immutability / isolation ────────────────────────────────────────────────

describe("immutability and legacy isolation", () => {
  it("fills are append-only; ledger snapshot sizing and the model are frozen; trade deletion still cascades", async () => {
    const d = "2026-11-26";
    const user = await readyUser("ql-immutable", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      const [fillId] = (await recordCloseFill(user.id, tradeId, { quantity: "0.5", price: 2010, executedAt: at(d, 620) })).fillIds;
      await expect(prisma.positionFill.update({ where: { id: fillId }, data: { note: "edit" } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
      await expect(prisma.positionFill.delete({ where: { id: fillId } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
      await expect(
        prisma.performanceRiskSnapshot.update({ where: { tradeId }, data: { executableQuantity: "0.9" } }),
      ).rejects.toThrow(/LEDGER_IMMUTABLE/);
      await expect(prisma.performanceRiskSnapshot.update({ where: { tradeId }, data: { riskAmount: "2000" } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
      await expect(prisma.performanceRiskSnapshot.delete({ where: { tradeId } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
      await expect(prisma.trade.update({ where: { id: tradeId }, data: { executionModel: "LEGACY_PERCENT" } })).rejects.toThrow(/EXECUTION_MODEL/);
      await expect(prisma.trade.update({ where: { id: tradeId }, data: { actualExit: "2010" } })).rejects.toThrow(/EXECUTION_MODEL/);
      await expect(prisma.trade.update({ where: { id: tradeId }, data: { actualEntry: "2001" } })).rejects.toThrow(/EXECUTION_MODEL/);
      await expect(updateTradeSections(user.id, tradeId, { actualExit: 2010 })).rejects.toThrow(/quantity-ledger/);
      await expect(updateTradeSections(user.id, tradeId, { actualEntry: 2001 })).rejects.toThrow(/frozen/);

      // Deleting the trade itself removes its ledger (the only allowed DELETE path).
      await prisma.trade.delete({ where: { id: tradeId } });
      expect(await prisma.positionFill.count({ where: { tradeId } })).toBe(0);
    });
  });

  it("bulk 'delete journal trades' still removes ledger trades with their fills", async () => {
    const d = "2026-11-28";
    const user = await readyUser("ql-bulk-delete", [d]);
    await runLive(async () => {
      const a = await ledgerTrade(user.id, d, { minutes: 600 });
      const b = await ledgerTrade(user.id, d, { minutes: 610 });
      const [fa] = (await recordCloseFill(user.id, a, { quantity: "0.5", price: 2010, executedAt: at(d, 620) })).fillIds;
      await correctFill(user.id, a, fa);
      await recordCloseFill(user.id, b, { quantity: "0.83", price: 2010, executedAt: at(d, 620) });
    });
    await deleteDataSection(user.id, "journal-trades");
    expect(await prisma.positionFill.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(0);
  });

  it("13. no PositionFill can exist for a LEGACY_PERCENT trade", async () => {
    const d = "2026-11-27";
    const user = await readyUser("ql-legacy-nofill", [d]);
    await runLive(async () => {
      flagOff();
      const tradeId = await idea(user.id, d);
      await recordFirstEntry(user.id, d, tradeId, entry(2000, 1988));
      await expect(recordCloseFill(user.id, tradeId, { quantity: "0.5", price: 2010, executedAt: at(d, 620) })).rejects.toMatchObject({
        code: "NOT_A_LEDGER_TRADE",
      });
      const snap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      await expect(
        prisma.positionFill.create({
          data: {
            userId: user.id,
            tradeId,
            performanceSnapshotId: snap.id,
            sequence: 1,
            kind: "CLOSE",
            source: "MANUAL",
            executedQuantity: "0.5",
            price: "2010",
            quantityBefore: "1",
            quantityAfter: "0.5",
            grossPnl: "500",
            conversionRate: "1",
            executedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/EXECUTION_MODEL/);
      // ... and a legacy snapshot can never be given sizing afterwards.
      await expect(prisma.performanceRiskSnapshot.update({ where: { tradeId }, data: { executableQuantity: "1" } })).rejects.toThrow();
    });
  });

  it("14. no TradeActualPartialExit can be added to a QUANTITY_LEDGER trade", async () => {
    const d = "2026-11-30";
    const user = await readyUser("ql-nopartial", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      await expect(
        upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 2010, percentClosed: 50, exitedAt: new Date() }),
      ).rejects.toThrow(/quantity-ledger/);
      await expect(
        prisma.tradeActualPartialExit.create({ data: { userId: user.id, tradeId, exitOrder: 1, exitPrice: "2010", percentClosed: "50", exitedAt: new Date() } }),
      ).rejects.toThrow(/EXECUTION_MODEL/);
    });
  });

  it("5. turning the flag OFF later never changes a ledger trade's settlement engine", async () => {
    const d = "2026-12-01";
    const user = await readyUser("ql-flagflip", [d]);
    await runLive(async () => {
      const tradeId = await ledgerTrade(user.id, d);
      flagOff();
      await recordCloseFill(user.id, tradeId, { quantity: "0.83", price: 1994, executedAt: at(d, 640) });
      expect(await canonical(tradeId)).toMatchObject({ realizedR: "-0.498", performancePnl: "-498", actualRR: "-0.5" });
      // A Journal full-form edit (rebuilds allocations, may post a form actualRR) re-settles through the ledger.
      const trade = await getTrade(user.id, tradeId);
      await updateTrade(user.id, tradeId, tradeSchema.parse({ ...tradeToFormValues(trade!), actualRR: 3, marketContext: "edited" }));
      expect(await canonical(tradeId)).toMatchObject({ realizedR: "-0.498", performancePnl: "-498", closingPnlNet: "-498", actualRR: "-0.5" });
      expect((await settlePerformanceTrade(user.id, tradeId)).status).toBe("SETTLED");
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).executionModel).toBe("QUANTITY_LEDGER");
    });
  });

  it("12. ledger and legacy trades coexist in one Performance Account and compound correctly", async () => {
    const d = "2026-12-02";
    const user = await readyUser("ql-coexist", [d]);
    await updatePerformanceConfig(user.id, { compoundingEnabled: true });
    await runLive(async () => {
      // 1) legacy, settles +1R on $100,000 → +$1,000
      flagOff();
      const legacy = await idea(user.id, d);
      await recordFirstEntry(user.id, d, legacy, entry(2000, 1990, 540));
      await upsertPartialExit(user.id, legacy, { exitOrder: 1, exitPrice: 2010, percentClosed: 100, exitedAt: at(d, 545) });
      expect(await canonical(legacy)).toMatchObject({ performancePnl: "1000" });

      // 2) ledger, later: balance before = 101,000 → budget 1,010 → 0.84 lots (12 × 100 per lot)
      const ledger = await ledgerTrade(user.id, d, { minutes: 600 });
      const s = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: ledger } });
      expect([s.balanceBefore.toString(), s.riskAmount.toString(), s.executableQuantity!.toString()]).toEqual(["101000", "1010", "0.84"]);
      await recordCloseFill(user.id, ledger, { quantity: "0.84", price: 2012, executedAt: at(d, 610) });
      expect(await canonical(ledger)).toMatchObject({ performancePnl: "1008", realizedR: "0.998" });

      // 3) legacy again, later still: compounds over BOTH earlier results.
      flagOff();
      const after = await idea(user.id, d);
      await recordFirstEntry(user.id, d, after, entry(2000, 1990, 660));
      const s3 = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: after } });
      expect(s3.balanceBefore.toString()).toBe("102008");
    });
  });
});

// ── Spec snapshot / backtesting ─────────────────────────────────────────────

describe("frozen instrument economics and backtest isolation", () => {
  it("16. a UserInstrumentSpec change after entry never changes historical sizing or PnL", async () => {
    const d = "2026-12-03";
    const user = await readyUser("ql-spec-freeze", [d]);
    await upsertUserInstrumentSpec(user.id, "NAS100", { contractSize: "1", quantityUnit: "LOT", quantityStep: "0.1", minQuantity: "0.1" });
    await runLive(async () => {
      flagOn();
      const tradeId = await idea(user.id, d, "NAS100");
      await recordFirstEntry(user.id, d, tradeId, entry(20000, 19950)); // 50 pts × 1 = 50/lot → 20 lots
      const s = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect([s.executableQuantity!.toString(), s.effectiveRiskAmount!.toString()]).toEqual(["20", "1000"]);
      expect(s.specSnapshot).toMatchObject({ contractSize: "1", sources: { contractSize: "USER_OVERRIDE", quoteCurrency: "CATALOG" } });

      await upsertUserInstrumentSpec(user.id, "NAS100", { contractSize: "10", quantityUnit: "LOT", quantityStep: "1", minQuantity: "1" });
      const res = await recordCloseFill(user.id, tradeId, { quantity: "20", price: 20025, executedAt: at(d, 640) });
      expect(res.settlement).toMatchObject({ status: "SETTLED" });
      expect(await canonical(tradeId)).toMatchObject({ performancePnl: "500", realizedR: "0.5" }); // 25 × 20 × 1, not × 10
    });
  });

  it("15. a backtest trade can never become QUANTITY_LEDGER (service + database)", async () => {
    const user = await readyUser("ql-backtest", []);
    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "QL isolation", assets: ["XAUUSD"], startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    flagOn();
    await runInBacktestRun(user.id, run.id, async () => {
      const t = await createTrade(
        user.id,
        "2026-09-15",
        tradeSchema.parse({ assetSymbol: "XAUUSD", executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 }),
      );
      await expect(enterQuantityLedgerTrade(user.id, t.id, { actualEntry: 2000, actualStopLoss: 1988, entryMinutes: 600 })).rejects.toMatchObject({
        code: "BACKTEST_NOT_ALLOWED",
      });
      await expect(recordCloseFill(user.id, t.id, { quantity: "1", price: 2010, executedAt: new Date() })).rejects.toMatchObject({
        code: "BACKTEST_NOT_ALLOWED",
      });
      await updateTradeSections(user.id, t.id, { actualEntry: 2000, actualStopLoss: 1988 });
      const row = await prisma.trade.findFirstOrThrow({ where: { id: t.id } });
      expect(row.executionModel).toBe("LEGACY_PERCENT");
      await expect(prisma.trade.update({ where: { id: t.id }, data: { executionModel: "QUANTITY_LEDGER" } })).rejects.toThrow(/executionModel_live_only/);
      expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId: t.id } })).toBe(0);
    });
  });

  it("existing and newly created trades default to LEGACY_PERCENT (no backfill)", async () => {
    const d = "2026-12-04";
    const user = await readyUser("ql-default", [d]);
    await runLive(async () => {
      flagOn(); // the flag only acts at first entry
      const tradeId = await idea(user.id, d);
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).executionModel).toBe("LEGACY_PERCENT");
    });
    expect(await prisma.trade.count({ where: { executionModel: "QUANTITY_LEDGER", userId: { notIn: userIds } } })).toBe(0);
  });

  it("errors are structured for callers", () => {
    expect(new QuantityLedgerError("NOT_A_LEDGER_TRADE", "x").code).toBe("NOT_A_LEDGER_TRADE");
  });
});
