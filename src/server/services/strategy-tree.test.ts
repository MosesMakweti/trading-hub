import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import * as strategies from "@/server/services/strategies.service";
import * as sot from "@/server/services/strategy-sot.service";
import { captureStrategySnapshot } from "@/server/services/strategies.service";
import {
  buildFullStrategy,
  checklistInput,
  comparableSnapshot,
  makeTestUser,
} from "@/server/testing/strategy-fixture";
import type { StrategyVersionSnapshot } from "@/types/strategies";

/** Regression tests for audit findings 1, 2, 4 (+ the 120-char restore name). */

const userIds: string[] = [];
async function user(label: string) {
  const u = await makeTestUser(`tree-${label}`);
  userIds.push(u.id);
  return u.id;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function snapshotOf(userId: string, strategyId: string) {
  const captured = await captureStrategySnapshot(userId, strategyId);
  if (!captured) throw new Error("missing strategy");
  return captured.snapshot;
}

/** Every checklist item a condition references must belong to `strategyId`. */
async function assertConditionsStayInside(strategyId: string) {
  const conditions = await prisma.strategySetupScenarioCondition.findMany({
    where: { scenario: { setupType: { strategyId } } },
    include: { checklistItem: { select: { strategyId: true } } },
  });
  expect(conditions.length).toBeGreaterThan(0);
  for (const c of conditions) expect(c.checklistItem.strategyId).toBe(strategyId);
}

describe("duplicateStrategy (audit #1)", () => {
  it("copies every section faithfully, with references remapped onto the copy", async () => {
    const userId = await user("dup");
    const { strategyId } = await buildFullStrategy(userId);
    const source = await snapshotOf(userId, strategyId);

    const copy = await strategies.duplicateStrategy(userId, strategyId);
    expect(copy.id).not.toBe(strategyId);
    const dup = await snapshotOf(userId, copy.id);

    expect(dup.name).toBe("Full strategy (copy)");
    expect(dup.status).toBe("DRAFT");
    expect(comparableSnapshot(dup)).toEqual(comparableSnapshot(source));
    // Specific fields the old copy dropped:
    expect(dup.sessions).toHaveLength(2);
    expect(dup.confluences).toHaveLength(3);
    expect(dup.execution).toHaveLength(1);
    expect(dup.setupTypes).toHaveLength(1);
    expect(dup.tradeManagement).toMatchObject({
      expectedWinRate: 45, expectedAvgRr: 2.5, expectedExpectancy: 0.6,
      minExecutionScore: 70, maxDailyRiskPercent: 3, maxTradesPerDay: 2,
    });
    await assertConditionsStayInside(copy.id);

    // Independent: editing the copy never touches the source.
    const copyItem = (await sot.listStrategyChecklist(userId, copy.id, "CONFLUENCE"))[0];
    await sot.updateChecklistItem(userId, copyItem.id, checklistInput({ name: "Renamed", weight: 1, directionApplicability: copyItem.directionApplicability }));
    expect(comparableSnapshot(await snapshotOf(userId, strategyId))).toEqual(comparableSnapshot(source));
  });

  it("refuses another user's strategy", async () => {
    const owner = await user("dup-owner");
    const intruder = await user("dup-intruder");
    const { strategyId } = await buildFullStrategy(owner);
    await expect(strategies.duplicateStrategy(intruder, strategyId)).rejects.toThrow(/not found/i);
  });
});

describe("restoreStrategyVersionAsNewStrategy (audit #2)", () => {
  it("restores every section, including setup types and trade-management targets", async () => {
    const userId = await user("restore");
    const { strategyId } = await buildFullStrategy(userId);
    await strategies.publishStrategyVersion(userId, strategyId, "v1");
    const published = (await strategies.getStrategyVersion(userId, strategyId, 1))!.snapshot;

    const restored = await strategies.restoreStrategyVersionAsNewStrategy(userId, strategyId, 1);
    expect(restored.droppedConditions).toEqual([]);
    const snap = await snapshotOf(userId, restored.id);

    expect(comparableSnapshot(snap)).toEqual(comparableSnapshot(published));
    expect(snap.setupTypes?.[0].scenarios.find((s) => s.direction === "BULLISH")).toMatchObject({
      customType: "Judas swing",
      instruments: ["XAUUSD"],
      timeframes: ["M15"],
    });
    expect(snap.confluences?.find((c) => c.name === "Liquidity sweep")?.icon).toBe("droplet");
    await assertConditionsStayInside(restored.id);
  });

  it("remaps a pairId that names a confluence id onto the restored confluence", async () => {
    const userId = await user("restore-pair");
    const s = await strategies.createStrategy(userId, { name: "Pairs", description: undefined });
    const bull = await sot.createChecklistItem(userId, s.id, "CONFLUENCE", checklistInput({ name: "Bull", directionApplicability: "BULLISH" }));
    await sot.createChecklistItem(userId, s.id, "CONFLUENCE", checklistInput({ name: "Bear", directionApplicability: "BEARISH", pairId: bull.id }));
    await strategies.publishStrategyVersion(userId, s.id, null);
    const restored = await strategies.restoreStrategyVersionAsNewStrategy(userId, s.id, 1);
    const items = await sot.listStrategyChecklist(userId, restored.id, "CONFLUENCE");
    const newBull = items.find((i) => i.name === "Bull")!;
    expect(items.find((i) => i.name === "Bear")!.pairId).toBe(newBull.id);
  });

  it("restores a LEGACY snapshot (no execution ids, no raw overrides) without dangling references", async () => {
    const userId = await user("restore-legacy");
    const s = await strategies.createStrategy(userId, { name: "Legacy", description: undefined });
    const legacy: StrategyVersionSnapshot = {
      name: "Legacy", description: null, applicableAssets: [], status: "LIVE",
      arsenalConcepts: [], frameworkSteps: [], timeframes: [], entryModels: [], tradeManagement: null,
      confluences: [{ id: "old-c1", name: "MSB", color: "GRAY", category: null, description: null, weight: 10, mandatory: false, validationCriteria: null, enabled: true }],
      execution: [{ name: "Retest", color: "GRAY", category: null, description: null, weight: null, mandatory: true, validationCriteria: null, enabled: true }],
      setupTypes: [{ name: "T", description: null, scenarios: [{ direction: "BULLISH", description: null, conditions: [
        { checklistItemId: "old-c1", name: "MSB", directionApplicability: "BOTH", mandatory: true, weight: 10, sortOrder: 0 },
        { checklistItemId: "old-exec", name: "Retest", directionApplicability: "BOTH", mandatory: true, weight: null, sortOrder: 1 },
        { checklistItemId: "gone", name: "Deleted thing", directionApplicability: "BOTH", mandatory: false, weight: 5, sortOrder: 2 },
      ] }] }],
    };
    await prisma.strategyVersion.create({ data: { strategyId: s.id, version: 1, snapshot: legacy as never } });

    const restored = await strategies.restoreStrategyVersionAsNewStrategy(userId, s.id, 1);
    expect(restored.droppedConditions).toEqual([{ setupType: "T", scenario: "BULLISH", condition: "Deleted thing" }]);
    const conds = await prisma.strategySetupScenarioCondition.findMany({
      where: { scenario: { setupType: { strategyId: restored.id } } },
      include: { checklistItem: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(conds.map((c) => [c.checklistItem.name, c.mandatoryOverride, c.weightOverride])).toEqual([
      ["MSB", true, null], // effective mandatory differed from the item → kept as override
      ["Retest", null, null],
    ]);
    await assertConditionsStayInside(restored.id);
  });

  it("keeps restored names within the 120-character limit", async () => {
    const userId = await user("restore-name");
    const longName = "N".repeat(120);
    const s = await strategies.createStrategy(userId, { name: longName, description: undefined });
    await strategies.publishStrategyVersion(userId, s.id, null);
    const restored = await strategies.restoreStrategyVersionAsNewStrategy(userId, s.id, 1);
    expect(restored.name.length).toBeLessThanOrEqual(120);
    expect(restored.name.endsWith(" (v1 restored)")).toBe(true);
    const dup = await strategies.duplicateStrategy(userId, s.id);
    expect(dup.name.length).toBeLessThanOrEqual(120);
  });
});

describe("published snapshots stay internally consistent (audit #4)", () => {
  it("never freezes setup-type conditions that reference a deleted confluence", async () => {
    const userId = await user("snapdel");
    const { strategyId, items } = await buildFullStrategy(userId);
    await sot.deleteChecklistItem(userId, items.both.id);
    await strategies.publishStrategyVersion(userId, strategyId, null);
    const snap = (await strategies.getStrategyVersion(userId, strategyId, 1))!.snapshot;
    const ids = new Set([...(snap.confluences ?? []), ...(snap.execution ?? [])].map((c) => c.id));
    const conditions = snap.setupTypes!.flatMap((t) => t.scenarios.flatMap((s) => s.conditions));
    expect(conditions.map((c) => c.name)).not.toContain("Liquidity sweep");
    for (const c of conditions) expect(ids.has(c.checklistItemId)).toBe(true);
  });

  it("freezes raw overrides, notes and the disabled flag alongside effective values", async () => {
    const userId = await user("snapfields");
    const { strategyId } = await buildFullStrategy(userId);
    const snap = await snapshotOf(userId, strategyId);
    const bull = snap.setupTypes![0].scenarios.find((s) => s.direction === "BULLISH")!;
    expect(bull.conditions[0]).toMatchObject({
      name: "Bullish MSB", mandatory: false, weight: 55,
      mandatoryOverride: false, weightOverride: 55, note: "clean break", enabled: true, kind: "CONFLUENCE",
    });
  });
});

describe("version comparison against the live strategy (audit #3)", () => {
  it("reports a confluence weight/mandatory change and a new session (previously 'no changes')", async () => {
    const userId = await user("diff");
    const s = await strategies.createStrategy(userId, { name: "Diff", description: undefined });
    const c = await sot.createChecklistItem(userId, s.id, "CONFLUENCE", checklistInput({ name: "MSB", weight: 10 }));
    await strategies.publishStrategyVersion(userId, s.id, null);
    await sot.updateChecklistItem(userId, c.id, checklistInput({ name: "MSB", weight: 90, mandatory: true }));
    await sot.createStrategySession(userId, s.id, { name: "London", color: "GRAY", enabled: true });

    const d = await strategies.getStrategyVersionComparison(userId, s.id, 1, "current");
    expect(d?.hasChanges).toBe(true);
    expect(d?.affectsScoring).toBe(true);
    expect(d?.sections.map((x) => x.key)).toEqual(["confluences", "sessions"]);
  });

  it("a duplicate and a restore differ from their source only in name/status", async () => {
    const userId = await user("diff-dup");
    const { strategyId } = await buildFullStrategy(userId);
    await strategies.publishStrategyVersion(userId, strategyId, null);
    const source = (await strategies.getStrategyVersion(userId, strategyId, 1))!.snapshot;
    const dup = await strategies.duplicateStrategy(userId, strategyId);
    const restored = await strategies.restoreStrategyVersionAsNewStrategy(userId, strategyId, 1);
    const { diffStrategyVersions } = await import("@/domain/strategies/version-diff");
    for (const id of [dup.id, restored.id]) {
      const d = diffStrategyVersions(source, await snapshotOf(userId, id));
      expect(d.sections.map((x) => x.key)).toEqual(["overview"]);
      expect(d.sections[0].entries[0].fields.map((f) => f.field)).toEqual(["Name", "Status"]);
    }
  });
});
