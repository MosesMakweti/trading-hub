import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { confirmPlanSchema } from "@/lib/validation/trade-plan";
import { createBacktestRun, runInBacktestRun, setBacktestRunStatus, BacktestRunNotFoundError } from "@/server/services/backtest-run.service";
import { createTrade } from "@/server/services/trades.service";
import { lockPlanIfConfirmedAndUnlocked, savePlan } from "@/server/services/trade-plan.service";
import { deleteDrawing, DrawingError, DrawingNotFoundError, linkDrawingToTrade, listDrawings, saveDrawing } from "@/server/services/native-replay/chart-drawing.service";
import { defaultStyle, type ChartDrawing, type DrawingType } from "@/domain/native-replay/drawings/model";
import { positionToTradeIdea } from "@/domain/native-replay/drawings/trade-idea";
import { wc } from "@/domain/native-replay/testing/m1-fixtures";
import type { TradeInput } from "@/lib/validation/trades";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function setup(label: string) {
  const u = await createTestUser(`drawings-${label}`);
  userIds.push(u.id);
  const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: `Run ${label}`, assets: ["XAUUSD", "EURUSD"], startDate: "2024-05-13", endDate: "2024-05-24" }));
  return { userId: u.id, run };
}

const drawing = (type: DrawingType, anchors: ChartDrawing["anchors"], extra: Partial<ChartDrawing> = {}): Omit<ChartDrawing, "linkedTradeId"> => ({
  id: randomUUID(),
  type,
  assetSymbol: "XAUUSD",
  anchors,
  style: defaultStyle(type),
  data: {},
  locked: false,
  hidden: false,
  ...extra,
});

describe("chart drawings — persistence in market coordinates", () => {
  it("create, list, update, delete; anchors stored exactly as time + price", async () => {
    const { userId, run } = await setup("crud");
    const trend = drawing("TREND", [{ time: wc("2024-05-14T09:00"), price: 2350.1 }, { time: wc("2024-05-14T11:30"), price: 2361.4 }]);
    await saveDrawing(userId, run.id, trend);
    await saveDrawing(userId, run.id, drawing("HLINE", [{ time: wc("2024-05-14T09:00"), price: 2345.5 }]));
    await saveDrawing(userId, run.id, drawing("FIB", [{ time: wc("2024-05-14T08:00"), price: 2340 }, { time: wc("2024-05-14T10:00"), price: 2360 }], { data: { levels: [0, 0.5, 1] } }));
    let list = await listDrawings(userId, run.id, "XAUUSD");
    expect(list.map((d) => d.type)).toEqual(["TREND", "HLINE", "FIB"]);
    expect(list[0].anchors).toEqual(trend.anchors);
    expect(await listDrawings(userId, run.id, "EURUSD")).toEqual([]); // per asset

    // Move (update by id) + lock + hide.
    await saveDrawing(userId, run.id, { ...trend, anchors: [trend.anchors[0], { time: wc("2024-05-14T12:00"), price: 2365 }], locked: true, hidden: true });
    list = await listDrawings(userId, run.id, "XAUUSD");
    expect(list[0]).toMatchObject({ locked: true, hidden: true, anchors: [trend.anchors[0], { time: wc("2024-05-14T12:00"), price: 2365 }] });

    await deleteDrawing(userId, run.id, "XAUUSD", trend.id);
    expect((await listDrawings(userId, run.id, "XAUUSD")).map((d) => d.type)).toEqual(["HLINE", "FIB"]);
    // Undo of the delete: the same id comes back.
    await saveDrawing(userId, run.id, trend);
    expect((await listDrawings(userId, run.id, "XAUUSD")).some((d) => d.id === trend.id)).toBe(true);
  });

  it("validation is authoritative on the server", async () => {
    const { userId, run } = await setup("validation");
    await expect(saveDrawing(userId, run.id, drawing("TREND", [{ time: 1, price: 1 }]))).rejects.toThrow(/needs 2 anchor/);
    await expect(saveDrawing(userId, run.id, { ...drawing("HLINE", [{ time: 1, price: 1 }]), style: { color: "red", width: 2, dash: "solid", opacity: 1 } })).rejects.toThrow(/colour/);
    await expect(saveDrawing(userId, run.id, drawing("LONG", [{ time: 1, price: 1 }, { time: 2, price: 1 }]))).rejects.toThrow(/entry, stop and target/);
    await expect(saveDrawing(userId, run.id, { ...drawing("HLINE", [{ time: 1, price: 1 }]), id: "bad id!" })).rejects.toBeInstanceOf(DrawingError);
    const h = drawing("HLINE", [{ time: 1, price: 1 }]);
    await saveDrawing(userId, run.id, h);
    await expect(saveDrawing(userId, run.id, { ...h, type: "VLINE" })).rejects.toThrow(/change type/);
  });
});

describe("ownership and run status", () => {
  it("another user can't read, write, overwrite, delete or link — it all looks missing", async () => {
    const a = await setup("owner-a");
    const b = await setup("owner-b");
    const d = drawing("HLINE", [{ time: 1, price: 2350 }]);
    await saveDrawing(a.userId, a.run.id, d);
    await expect(listDrawings(b.userId, a.run.id, "XAUUSD")).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(saveDrawing(b.userId, a.run.id, d)).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    // Reusing A's drawing id inside B's own run never overwrites A's drawing.
    await expect(saveDrawing(b.userId, b.run.id, { ...d, anchors: [{ time: 1, price: 1 }] })).rejects.toBeInstanceOf(DrawingNotFoundError);
    await expect(deleteDrawing(b.userId, b.run.id, "XAUUSD", d.id)).rejects.toBeInstanceOf(DrawingNotFoundError);
    // An asset the run doesn't have.
    await expect(listDrawings(a.userId, a.run.id, "GBPUSD")).rejects.toBeInstanceOf(DrawingNotFoundError);
    expect((await listDrawings(a.userId, a.run.id, "XAUUSD"))[0].anchors[0].price).toBe(2350);
    // The database refuses a drawing on another user's run or a foreign asset even if app code is bypassed.
    await expect(prisma.replayChartDrawing.create({ data: { id: randomUUID(), userId: b.userId, backtestRunId: a.run.id, assetSymbol: "XAUUSD", type: "HLINE", anchors: [], style: {} } })).rejects.toThrow(/does not match its run/);
    await expect(prisma.replayChartDrawing.create({ data: { id: randomUUID(), userId: a.userId, backtestRunId: a.run.id, assetSymbol: "GBPUSD", type: "HLINE", anchors: [], style: {} } })).rejects.toThrow(/does not match its run/);
  });

  it("completed / archived runs keep drawings visible but read-only", async () => {
    const { userId, run } = await setup("readonly");
    const d = drawing("RECT", [{ time: 1, price: 2340 }, { time: 60, price: 2350 }]);
    await saveDrawing(userId, run.id, d);
    for (const status of ["COMPLETED", "ARCHIVED"] as const) {
      await setBacktestRunStatus(userId, run.id, status);
      expect(await listDrawings(userId, run.id, "XAUUSD")).toHaveLength(1);
      await expect(saveDrawing(userId, run.id, { ...d, locked: true })).rejects.toThrow(/read-only/);
      await expect(deleteDrawing(userId, run.id, "XAUUSD", d.id)).rejects.toThrow(/read-only/);
    }
    await setBacktestRunStatus(userId, run.id, "ACTIVE");
    await saveDrawing(userId, run.id, { ...d, locked: true });
  });
});

describe("Position → Trade Idea (existing workflow) and plan immutability", () => {
  const tradeInput = (asset: string, direction: "LONG" | "SHORT", executionMinutes: number): TradeInput =>
    ({
      strategyId: "", assetSymbol: asset, executionMinutes, direction, higherTimeframeBias: "BULLISH", biasConfidencePercent: 50, selectedSession: null,
      expectedRR: null, actualRR: null, allocations: [], propFirmExecutions: [], selectedConfluences: [], selectedExecution: [], selectedEntryModel: null, psychologyAnswers: {},
    }) as unknown as TradeInput;

  it("maps asset, direction, entry, stop, TP1…TPn, timeframe and world time into the existing createTrade + savePlan path", async () => {
    const { userId, run } = await setup("convert");
    const long = drawing("LONG", [{ time: wc("2024-05-14T09:30"), price: 2350.1 }, { time: wc("2024-05-14T12:30"), price: 2350.1 }], {
      data: { position: { entry: 2350.1, stop: 2347.1, targets: [2357.3, 2362.1] } },
    });
    await saveDrawing(userId, run.id, long);

    // What the chart pre-fills into the existing Trade Idea form (world time 09:37, M30 view).
    const prefill = positionToTradeIdea({ ...long, linkedTradeId: null }, { timeframe: "M30", worldMinute: wc("2024-05-14T09:37"), priceScale: 2 })!;
    expect(prefill).toEqual({
      assetSymbol: "XAUUSD",
      direction: "LONG",
      timeframe: "30m",
      entry: "2350.10",
      stopLoss: "2347.10",
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: "2357.30" }, { targetOrder: 2, label: "TP2", targetPrice: "2362.10" }],
      executionMinutes: 9 * 60 + 37,
    });

    // The trader saves the form: the same services the form's actions call, in the run's scope.
    const trade = await runInBacktestRun(userId, run.id, async () => {
      const t = await createTrade(userId, "2024-05-14", tradeInput(prefill.assetSymbol, prefill.direction, prefill.executionMinutes));
      await savePlan(userId, t.id, confirmPlanSchema.parse({ direction: prefill.direction, timeframe: prefill.timeframe, entry: prefill.entry, stopLoss: prefill.stopLoss, targets: prefill.targets }));
      return t;
    });
    await linkDrawingToTrade(userId, run.id, "XAUUSD", long.id, trade.id);

    // Trade is a Backtesting root model: read it inside the run's scope (outside it, isolation hides it).
    const inRun = <T,>(fn: () => Promise<T>) => runInBacktestRun(userId, run.id, fn);
    const saved = await inRun(() => prisma.trade.findUniqueOrThrow({ where: { id: trade.id }, include: { plannedTargets: { orderBy: { targetOrder: "asc" } } } }));
    expect(saved).toMatchObject({ backtestRunId: run.id, assetSymbol: "XAUUSD", direction: "LONG", executionMinutes: 577, timeframe: "30m" });
    expect(saved.tradeDate.toISOString().slice(0, 10)).toBe("2024-05-14"); // the simulation date
    expect([saved.plannedEntry?.toString(), saved.plannedStopLoss?.toString()]).toEqual(["2350.1", "2347.1"]);
    expect(saved.plannedTargets.map((t) => t.targetPrice.toString())).toEqual(["2357.3", "2362.1"]);
    // The plan's own R per target (savePlan) agrees with the chart's position maths: 7.20/3.00 and 12.00/3.00.
    const [version1] = await inRun(() => prisma.tradePlanVersion.findMany({ where: { tradeId: trade.id } }));
    expect((version1.targetsSnapshot as { rMultiple: number }[]).map((t) => t.rMultiple)).toEqual([2.4, 4]);
    expect((await listDrawings(userId, run.id, "XAUUSD"))[0].linkedTradeId).toBe(trade.id);

    // Execution begins → the plan locks. Moving the drawing afterwards changes nothing in the plan.
    await inRun(() => lockPlanIfConfirmedAndUnlocked(userId, trade.id)); // as the execution action does, in the run scope
    const versionsBefore = await inRun(() => prisma.tradePlanVersion.findMany({ where: { tradeId: trade.id } }));
    expect(versionsBefore).toHaveLength(1);
    expect(versionsBefore[0].locked).toBe(true);
    await saveDrawing(userId, run.id, { ...long, data: { position: { entry: 2400, stop: 2390, targets: [2450] } } });
    const after = await inRun(() => prisma.trade.findUniqueOrThrow({ where: { id: trade.id }, include: { plannedTargets: true } }));
    const versionsAfter = await inRun(() => prisma.tradePlanVersion.findMany({ where: { tradeId: trade.id } }));
    expect([after.plannedEntry?.toString(), after.plannedStopLoss?.toString()]).toEqual(["2350.1", "2347.1"]);
    expect(after.plannedTargets.map((t) => t.targetPrice.toString()).sort()).toEqual(["2357.3", "2362.1"]);
    expect(versionsAfter).toEqual(versionsBefore);
  });

  it("a drawing can only be linked to a trade of the same run and asset", async () => {
    const a = await setup("link-a");
    const b = await setup("link-b");
    const short = drawing("SHORT", [{ time: 1, price: 2350 }, { time: 60, price: 2350 }], { data: { position: { entry: 2350, stop: 2353, targets: [2344] } } });
    await saveDrawing(a.userId, a.run.id, short);
    const otherRunTrade = await runInBacktestRun(b.userId, b.run.id, () => createTrade(b.userId, "2024-05-14", tradeInput("XAUUSD", "SHORT", 600)));
    await expect(linkDrawingToTrade(a.userId, a.run.id, "XAUUSD", short.id, otherRunTrade.id)).rejects.toThrow(/isn't part of this run/);
    const eurTrade = await runInBacktestRun(a.userId, a.run.id, () => createTrade(a.userId, "2024-05-14", tradeInput("EURUSD", "SHORT", 600)));
    await expect(linkDrawingToTrade(a.userId, a.run.id, "XAUUSD", short.id, eurTrade.id)).rejects.toThrow(/different asset/);
    const liveTrade = await createTrade(a.userId, "2024-05-14", tradeInput("XAUUSD", "SHORT", 600)); // LIVE — never linkable
    await expect(linkDrawingToTrade(a.userId, a.run.id, "XAUUSD", short.id, liveTrade.id)).rejects.toThrow(/isn't part of this run/);
    const hline = drawing("HLINE", [{ time: 1, price: 2350 }]);
    await saveDrawing(a.userId, a.run.id, hline);
    const okTrade = await runInBacktestRun(a.userId, a.run.id, () => createTrade(a.userId, "2024-05-14", tradeInput("XAUUSD", "SHORT", 600)));
    await expect(linkDrawingToTrade(a.userId, a.run.id, "XAUUSD", hline.id, okTrade.id)).rejects.toBeInstanceOf(DrawingNotFoundError); // only positions
  });
});
