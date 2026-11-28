import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import { orderSchema } from "@/lib/validation/simulation";
import * as strategies from "@/server/services/strategies.service";
import * as sot from "@/server/services/strategy-sot.service";
import * as st from "@/server/services/strategy-setup-types.service";
import * as tm from "@/server/services/strategy-trade-management.service";
import * as experiments from "@/server/services/strategy-experiments.service";
import { checklistInput } from "@/server/testing/strategy-fixture";
import { startSimClock } from "./sim-account.service";
import { advanceSimClock } from "./sim-clock.service";
import { closePosition, placeOrder } from "./sim-execution.service";
import { cloneSessionConditions, createLabSession } from "./sim-strategy.service";
import { getExperimentComparison } from "./sim-strategy-analytics.service";
import type { StrategyEvaluation } from "@/domain/strategies/strategy-evaluation";

/**
 * Strategy evaluation in the terminal + baseline/experiment comparison
 * (Part H, I; Part L #5, #14, #19, #20).
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

/** EURUSD bid bars 14 May 09:00–09:09 (broker clock), dip to 1.07880 at 09:04. */
function fixture(): string {
  const rows: string[][] = [];
  const add = (t: string, o: string, h: string, l: string, c: string) => rows.push(["2024.05.14", t, o, h, l, c, "10", "0", "10"]);
  add("09:00", "1.08000", "1.08010", "1.07990", "1.08000");
  add("09:01", "1.08000", "1.08020", "1.07995", "1.08010");
  add("09:02", "1.08010", "1.08030", "1.08005", "1.08020");
  add("09:03", "1.08020", "1.08025", "1.07940", "1.07950");
  add("09:04", "1.07950", "1.07960", "1.07880", "1.07890");
  add("09:05", "1.07890", "1.08100", "1.07885", "1.08090");
  for (const t of ["09:06", "09:07", "09:08", "09:09"]) add(t, "1.08090", "1.08250", "1.08080", "1.08240");
  return mt5Text(rows);
}

async function setup(label: string) {
  const u = await createTestUser(`sim-eval-${label}`);
  userIds.push(u.id);
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(fixture()), fileName: "EURUSD_M1_202405140900_202405140909.csv" });
  const s = await strategies.createStrategy(u.id, { name: "London sweep", description: undefined });
  await sot.createChecklistItem(u.id, s.id, "CONFLUENCE", checklistInput({ name: "Sweep", weight: 60, mandatory: true }));
  await sot.createChecklistItem(u.id, s.id, "CONFLUENCE", checklistInput({ name: "FVG", weight: 40 }));
  // 09:00 broker (GMT+3 in May, the default "NYC+7" data zone) = 06:00 UTC;
  // the trader's timezone is unconfigured → UTC.
  await sot.createStrategySession(u.id, s.id, { name: "London", color: "BLUE", startMinutes: 6 * 60, endMinutes: 8 * 60, enabled: true });
  const rec = await tm.getOrCreateTradeManagement(u.id, s.id);
  await tm.updateTradeManagement(u.id, rec.id, { maxTradesPerDay: 1, maxRiskPercent: 1 });
  const type = await st.createSetupType(u.id, s.id, { name: "Type A" });
  const [withScenarios] = await st.listSetupTypesWithScenarios(u.id, s.id);
  const items = await sot.listStrategyChecklist(u.id, s.id, "CONFLUENCE");
  for (const i of items) await st.addScenarioCondition(u.id, withScenarios.scenarios.find((x) => x.direction === "BULLISH")!.id, { checklistItemId: i.id });
  const session = {
    name: `Eval ${label}`,
    datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }],
    periodStart: "2024-05-14",
    periodEnd: "2024-05-17",
    startingBalance: 10_000,
    currency: "USD",
    costs: { commissionPerUnitPerSide: 0 },
  };
  return { userId: u.id, strategyId: s.id, setupTypeId: type.id, session };
}

const evalOf = (p: { strategyEvaluation: unknown }) => p.strategyEvaluation as StrategyEvaluation;

describe("strategy evaluation at the trade decision", () => {
  it("scores the checklist on the frozen snapshot and runs session / trades-per-day / risk checks at the server clock", async () => {
    const { userId, strategyId, session } = await setup("market");
    const { account } = await createLabSession(userId, { ...session, strategyMode: "EXISTING", strategyId });
    await startSimClock(userId, account.id);

    const first = await placeOrder(userId, account.id, {
      symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
      strategyCheck: { setupTypeName: "Type A", checkedNames: ["Sweep", "FVG"] },
    });
    const p1 = await prisma.simPosition.findUniqueOrThrow({ where: { id: first.positionId! } });
    expect(p1).toMatchObject({ setupTypeName: "Type A", strategySessionName: "London", executionScore: 100, followedRules: true });
    expect(evalOf(p1).checks.map((c) => [c.rule, c.status])).toEqual([
      ["MANDATORY_CONDITIONS", "PASS"],
      ["SESSION", "PASS"],
      ["MAX_TRADES_PER_DAY", "PASS"],
      ["MAX_RISK_PER_TRADE", "PASS"],
    ]);

    // Second trade the same day: over the 1-trade limit and missing the mandatory sweep.
    const second = await placeOrder(userId, account.id, {
      symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
      strategyCheck: { setupTypeName: "Type A", checkedNames: ["FVG"] },
    });
    const p2 = await prisma.simPosition.findUniqueOrThrow({ where: { id: second.positionId! } });
    expect(p2.followedRules).toBe(false);
    expect(p2.executionScore).toBe(40);
    expect(evalOf(p2).checks.filter((c) => c.status === "FAIL").map((c) => c.rule)).toEqual(["MANDATORY_CONDITIONS", "MAX_TRADES_PER_DAY"]);
  });

  it("a pending order is evaluated when it's PLACED and carries that evaluation onto the position when it fills", async () => {
    const { userId, strategyId, session } = await setup("pending");
    const { account } = await createLabSession(userId, { ...session, strategyMode: "EXISTING", strategyId });
    await startSimClock(userId, account.id);
    const order = await placeOrder(userId, account.id, {
      symbol: "EURUSD", side: "BUY", type: "LIMIT", price: "1.07900", stopLoss: "1.07800", sizing: { mode: "RISK_PERCENT", riskPercent: 0.5 },
      strategyCheck: { setupTypeName: null, checkedNames: ["Sweep"] },
    });
    const placed = await prisma.simOrder.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(evalOf(placed).score).toBe(60);
    await advanceSimClock(userId, account.id, { kind: "BARS", count: 6 }, "fill");
    const filled = await prisma.simOrder.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(filled.status).toBe("FILLED");
    const position = await prisma.simPosition.findUniqueOrThrow({ where: { id: filled.positionId! } });
    expect(position.openedMinute).toBeGreaterThan(placed.placedMinute);
    expect(position.strategyEvaluation).toEqual(placed.strategyEvaluation);
    expect(position.executionScore).toBe(60);
  });

  it("can't be fed results or a replay time from the client (no-lookahead / server-authoritative)", () => {
    const parsed = orderSchema.parse({
      accountId: "acct_1", symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
      strategyCheck: { checkedNames: ["Sweep"], score: 100, followedRules: true, minute: 999999 },
    });
    expect(parsed.strategyCheck).toEqual({ checkedNames: ["Sweep"] });
  });

  it("sessions without a strategy, or orders without a checklist, are not evaluated", async () => {
    const { userId, session } = await setup("none");
    const { account } = await createLabSession(userId, { ...session, strategyMode: "NONE" });
    await startSimClock(userId, account.id);
    const o = await placeOrder(userId, account.id, {
      symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
      strategyCheck: { checkedNames: ["Sweep"] },
    });
    const p = await prisma.simPosition.findUniqueOrThrow({ where: { id: o.positionId! } });
    expect(p.strategyEvaluation).toBeNull();
    expect(p.followedRules).toBeNull();
  });
});

describe("baseline vs experiment comparison", () => {
  it("compares sessions run on identical conditions, and later edits never change recorded results", async () => {
    const { userId, strategyId, session } = await setup("compare");
    const { account: base } = await createLabSession(userId, { ...session, strategyMode: "EXISTING", strategyId });
    const exp = await experiments.forkExperiment(userId, strategyId, { hypothesis: "Drop the FVG requirement" });
    const variation = await cloneSessionConditions(userId, base.id, { experimentId: exp.id });

    for (const [acct, checked] of [[base.id, ["Sweep", "FVG"]], [variation.id, ["Sweep"]]] as const) {
      await startSimClock(userId, acct);
      const o = await placeOrder(userId, acct, {
        symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
        strategyCheck: { setupTypeName: "Type A", checkedNames: [...checked] },
      });
      await closePosition(userId, acct, o.positionId!, {});
    }

    const c = await getExperimentComparison(userId, exp.id);
    expect(c.comparable).toBe(true);
    expect(c.differences).toEqual([]);
    expect(c.baseline?.results.overall.resolved).toBe(1);
    expect(c.variation.results.overall.resolved).toBe(1);
    expect(c.baseline?.results.averageExecutionScore).toBe(100);
    expect(c.variation.results.averageExecutionScore).toBe(60);
    expect(c.warnings.map((w) => w.kind)).toContain("SMALL_SAMPLE");
    expect(c.unsupported.join(" ")).toMatch(/market condition/);

    // Editing the experiment afterwards changes neither the frozen evaluation nor the results.
    const before = JSON.stringify(c.variation.results);
    const work = await experiments.getExperiment(userId, exp.id);
    const fvg = (await sot.listStrategyChecklist(userId, work.workingStrategyId, "CONFLUENCE")).find((i) => i.name === "FVG")!;
    await sot.updateChecklistItem(userId, fvg.id, checklistInput({ name: "FVG", weight: 5 }));
    const again = await getExperimentComparison(userId, exp.id);
    expect(JSON.stringify(again.variation.results)).toBe(before);
    // The setup type's condition inherits the weight, so its effective weight changed too.
    expect(again.experiment.changesFromBaseline?.sections.map((s) => s.key)).toEqual(["confluences", "setupTypes"]);
  });

  it("flags sessions that were not run under the same conditions", async () => {
    const { userId, strategyId, session } = await setup("differ");
    await createLabSession(userId, { ...session, strategyMode: "EXISTING", strategyId });
    await createLabSession(userId, { ...session, periodEnd: "2024-05-15", strategyMode: "REFINE", strategyId });
    const [exp] = await experiments.listExperiments(userId);
    const c = await getExperimentComparison(userId, exp.id);
    expect(c.comparable).toBe(false);
    expect(c.differences.map((d) => d.field)).toEqual(["Period"]);
    expect(c.warnings.map((w) => w.kind)).toContain("CONDITIONS_DIFFER");
  });

  it("another user's experiment comparison is not found", async () => {
    const { userId, strategyId } = await setup("own");
    const exp = await experiments.forkExperiment(userId, strategyId);
    const intruder = await createTestUser("sim-eval-intruder");
    userIds.push(intruder.id);
    await expect(getExperimentComparison(intruder.id, exp.id)).rejects.toThrow(/not found/i);
  });
});
