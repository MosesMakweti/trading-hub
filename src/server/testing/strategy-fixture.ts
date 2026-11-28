import { prisma } from "@/server/db";
import * as strategies from "@/server/services/strategies.service";
import * as arsenal from "@/server/services/arsenal.service";
import * as framework from "@/server/services/framework.service";
import * as timeframes from "@/server/services/timeframes.service";
import * as entryModels from "@/server/services/strategy-entry-models.service";
import * as tm from "@/server/services/strategy-trade-management.service";
import * as sot from "@/server/services/strategy-sot.service";
import * as setupTypes from "@/server/services/strategy-setup-types.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import type { StrategyVersionSnapshot } from "@/types/strategies";

/** Test-only helpers: a strategy with EVERY section populated, plus a
 *  normalizer that makes two snapshots comparable across fresh ids. */

export const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

export async function makeTestUser(label: string) {
  return prisma.user.create({
    data: { email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

export const checklistInput = (over: Record<string, unknown>) =>
  strategyChecklistItemSchema.parse({ name: "x", color: "GRAY", ...over });

export async function buildFullStrategy(userId: string, name = "Full strategy") {
  const strategy = await strategies.createStrategy(userId, { name, description: "Desc" });
  const id = strategy.id;
  await strategies.updateStrategySettings(userId, id, {
    name,
    description: "Desc",
    applicableAssets: ["XAUUSD", "NAS100"],
    status: "TESTING",
  });

  const concept = await arsenal.createArsenalConcept(userId, id, "FVG");
  await arsenal.updateArsenalConcept(userId, concept.id, { definition: doc("gap"), personalNotes: doc("notes") });
  const step = await framework.createFrameworkStep(userId, id, "HTF bias");
  await framework.updateFrameworkStep(userId, step.id, { description: doc("look left") });
  const tf = await timeframes.createTimeframe(userId, id, "H4");
  const cp = await timeframes.createCheckpoint(userId, tf.id, "Swing");
  await timeframes.updateCheckpoint(userId, cp.id, { notes: doc("cp note") });
  const em = await entryModels.createEntryModel(userId, id, "Sweep + FVG");
  await entryModels.updateEntryModel(userId, em.id, { invalidation: doc("close below") });

  const rec = await tm.getOrCreateTradeManagement(userId, id);
  await tm.updateTradeManagement(userId, rec.id, {
    takeProfitPhilosophy: doc("2R"),
    maxHoldingTime: "1 session",
    maxRiskPercent: 1,
    expectedWinRate: 45,
    expectedAvgRr: 2.5,
    expectedExpectancy: 0.6,
    minExecutionScore: 70,
    maxDailyRiskPercent: 3,
    maxTradesPerDay: 2,
  });
  const ptp = await tm.createPartialTakeProfit(userId, rec.id);
  await tm.updatePartialTakeProfit(userId, ptp.id, { trigger: "1R", percentToClose: 50, reason: "lock" });
  await tm.createCustomRule(userId, rec.id, "No news trades");

  await sot.createStrategySession(userId, id, { name: "London", color: "BLUE", startMinutes: 420, endMinutes: 600, enabled: true });
  await sot.createStrategySession(userId, id, { name: "NY", color: "GREEN", startMinutes: 780, endMinutes: 960, enabled: false });

  const bull = await sot.createChecklistItem(userId, id, "CONFLUENCE", checklistInput({
    name: "Bullish MSB", color: "GREEN", weight: 40, mandatory: true, directionApplicability: "BULLISH", pairId: "msb", category: "Structure",
  }));
  const bear = await sot.createChecklistItem(userId, id, "CONFLUENCE", checklistInput({
    name: "Bearish MSB", color: "RED", weight: 40, mandatory: true, directionApplicability: "BEARISH", pairId: "msb",
  }));
  const both = await sot.createChecklistItem(userId, id, "CONFLUENCE", checklistInput({
    name: "Liquidity sweep", weight: 20, validationCriteria: "wick through PDL", enabled: true,
  }));
  const exec = await sot.createChecklistItem(userId, id, "EXECUTION", checklistInput({ name: "Retest", mandatory: true }));
  // Give one confluence an icon (not settable through the schema; set directly).
  await prisma.strategyChecklistItem.update({ where: { id: both.id }, data: { icon: "droplet" } });

  const type = await setupTypes.createSetupType(userId, id, { name: "Type A", description: "A+ setup" });
  const [withScenarios] = await setupTypes.listSetupTypesWithScenarios(userId, id);
  const bullScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
  const bearScenario = withScenarios.scenarios.find((s) => s.direction === "BEARISH")!;
  await setupTypes.updateScenarioDetails(userId, bullScenario.id, {
    scenarioType: "CUSTOM",
    customType: "Judas swing",
    instruments: ["XAUUSD"],
    timeframes: ["M15"],
    context: { htfBias: "Bullish" },
    executionPlan: { entry: [{ id: "e1", text: "FVG fill", mandatory: true }], minRiskReward: 2 },
  });
  const c1 = await setupTypes.addScenarioCondition(userId, bullScenario.id, { checklistItemId: bull.id });
  await setupTypes.updateScenarioCondition(userId, c1.id, { mandatoryOverride: false, weightOverride: 55, note: "clean break" });
  await setupTypes.addScenarioCondition(userId, bullScenario.id, { checklistItemId: both.id });
  await setupTypes.addScenarioCondition(userId, bullScenario.id, { checklistItemId: exec.id });
  await setupTypes.addScenarioCondition(userId, bearScenario.id, { checklistItemId: bear.id });

  return { strategyId: id, setupTypeId: type.id, items: { bull, bear, both, exec }, scenarios: { bullScenario, bearScenario } };
}

/**
 * Strips everything that legitimately differs between a source and its copy
 * (row ids, checklist-item ids inside conditions, name/status) so the rest
 * can be compared with toEqual. Condition item references are replaced by
 * "<kind>:<name>" after asserting they resolve inside the SAME snapshot.
 */
export function comparableSnapshot(snap: StrategyVersionSnapshot) {
  const items = [...(snap.confluences ?? []), ...(snap.execution ?? [])];
  const byId = new Map(items.map((c) => [c.id, c]));
  const confluenceIds = new Set((snap.confluences ?? []).map((c) => c.id));
  const strip = <T extends { id?: string }>(x: T) => {
    const { id: _id, ...rest } = x;
    void _id;
    return rest;
  };
  return {
    description: snap.description,
    applicableAssets: snap.applicableAssets,
    arsenalConcepts: snap.arsenalConcepts.map(strip),
    frameworkSteps: snap.frameworkSteps.map(strip),
    timeframes: snap.timeframes.map((t) => ({ name: t.name, checkpoints: t.checkpoints.map(strip) })),
    entryModels: snap.entryModels.map(strip),
    tradeManagement: snap.tradeManagement
      ? {
          ...strip(snap.tradeManagement),
          partialTakeProfits: snap.tradeManagement.partialTakeProfits.map(strip),
          customRules: snap.tradeManagement.customRules.map(strip),
        }
      : null,
    sessions: (snap.sessions ?? []).map(strip),
    confluences: (snap.confluences ?? []).map((c) => ({
      ...strip(c),
      // pairId naming a confluence id must resolve within the copy.
      pairId: c.pairId && confluenceIds.has(c.pairId) ? `->${byId.get(c.pairId)!.name}` : c.pairId,
    })),
    execution: (snap.execution ?? []).map(strip),
    setupTypes: (snap.setupTypes ?? []).map((st) => ({
      ...st,
      scenarios: st.scenarios.map((sc) => ({
        ...sc,
        conditions: sc.conditions.map((c) => {
          const item = byId.get(c.checklistItemId);
          if (!item) throw new Error(`condition ${c.name} points outside the snapshot (${c.checklistItemId})`);
          const { checklistItemId: _ignored, ...rest } = c;
          void _ignored;
          return { ...rest, item: item.name };
        }),
      })),
    })),
  };
}
