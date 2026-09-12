import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createStrategy, publishStrategyVersion, getStrategyVersion } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as svc from "@/server/services/strategy-setup-types.service";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  confluence-direction.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `setup-types-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const confluence = (over: Record<string, unknown>) =>
  strategyChecklistItemSchema.parse({ name: "x", color: "GRAY", ...over });

describe("strategy-setup-types.service — Stage 3", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  async function setupStrategy(label: string) {
    const user = await makeUser(label);
    userIds.push(user.id);
    const strategy = await createStrategy(user.id, { name: `Strategy ${label}`, description: undefined });
    return { userId: user.id, strategyId: strategy.id };
  }

  it("creates a setup type with both an empty Bullish and Bearish scenario", async () => {
    const { userId, strategyId } = await setupStrategy("create");
    const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });

    const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
    expect(withScenarios.id).toBe(setupType.id);
    expect(withScenarios.scenarios).toHaveLength(2);
    expect(withScenarios.scenarios.map((s) => s.direction).sort()).toEqual(["BEARISH", "BULLISH"]);
    expect(withScenarios.scenarios.every((s) => s.conditions.length === 0)).toBe(true);
  });

  it("rejects a duplicate setup type name within the same strategy, case-insensitively", async () => {
    const { userId, strategyId } = await setupStrategy("dup-name");
    await svc.createSetupType(userId, strategyId, { name: "Type A" });
    await expect(svc.createSetupType(userId, strategyId, { name: "type a" })).rejects.toThrow(
      /already exists/i,
    );
  });

  it("allows renaming a setup type, but still rejects a rename that collides with another", async () => {
    const { userId, strategyId } = await setupStrategy("rename");
    const a = await svc.createSetupType(userId, strategyId, { name: "Type A" });
    await svc.createSetupType(userId, strategyId, { name: "Type B" });

    await svc.updateSetupType(userId, a.id, { name: "Type A Renamed" });
    const [renamed] = await svc.listSetupTypesWithScenarios(userId, strategyId);
    expect([renamed].some((s) => s.name === "Type A Renamed")).toBe(true);

    await expect(svc.updateSetupType(userId, a.id, { name: "Type B" })).rejects.toThrow(/already exists/i);
  });

  it("archives (soft-deletes) a setup type — hidden from listing", async () => {
    const { userId, strategyId } = await setupStrategy("archive");
    const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });
    await svc.archiveSetupType(userId, setupType.id);
    expect(await svc.listSetupTypesWithScenarios(userId, strategyId)).toHaveLength(0);
  });

  it("reorders setup types within a strategy", async () => {
    const { userId, strategyId } = await setupStrategy("reorder");
    const a = await svc.createSetupType(userId, strategyId, { name: "Type A" });
    const b = await svc.createSetupType(userId, strategyId, { name: "Type B" });

    await svc.reorderSetupTypes(userId, strategyId, [b.id, a.id]);
    const list = await svc.listSetupTypesWithScenarios(userId, strategyId);
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("rejects operating on another user's setup type", async () => {
    const { userId, strategyId } = await setupStrategy("cross-user-owner");
    const attacker = await makeUser("cross-user-attacker");
    userIds.push(attacker.id);
    const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });

    await expect(svc.updateSetupType(attacker.id, setupType.id, { name: "Hijacked" })).rejects.toThrow();
    await expect(svc.archiveSetupType(attacker.id, setupType.id)).rejects.toThrow();
  });

  describe("scenario conditions", () => {
    async function setupWithConfluences(label: string) {
      const { userId, strategyId } = await setupStrategy(label);
      const bullishItem = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bullish MSB", weight: 30, mandatory: true, directionApplicability: "BULLISH" }),
      );
      const bearishItem = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bearish MSB", weight: 30, mandatory: true, directionApplicability: "BEARISH" }),
      );
      const bothItem = await createChecklistItem(
        userId,
        strategyId,
        "EXECUTION",
        confluence({ name: "Candle Close", weight: null, mandatory: false }),
      );
      const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });
      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
      const bearishScenario = withScenarios.scenarios.find((s) => s.direction === "BEARISH")!;
      return { userId, strategyId, setupType, bullishItem, bearishItem, bothItem, bullishScenario, bearishScenario };
    }

    it("adds an eligible condition to a scenario, inheriting base weight/mandatory (no override)", async () => {
      const { userId, strategyId, bullishScenario, bullishItem } = await setupWithConfluences("add-ok");
      const created = await svc.addScenarioCondition(userId, bullishScenario.id, {
        checklistItemId: bullishItem.id,
      });
      expect(created.mandatoryOverride).toBeNull();
      expect(created.weightOverride).toBeNull();

      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const scenarioAfter = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
      expect(scenarioAfter.conditions).toHaveLength(1);
      expect(scenarioAfter.conditions[0].checklistItem.name).toBe("Bullish MSB");
    });

    it("rejects adding a bearish-only condition to a bullish scenario (direction filtering)", async () => {
      const { userId, bullishScenario, bearishItem } = await setupWithConfluences("direction-reject");
      await expect(
        svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: bearishItem.id }),
      ).rejects.toThrow(/eligible/i);
    });

    it("rejects adding a bullish-only condition to a bearish scenario", async () => {
      const { userId, bearishScenario, bullishItem } = await setupWithConfluences("direction-reject-2");
      await expect(
        svc.addScenarioCondition(userId, bearishScenario.id, { checklistItemId: bullishItem.id }),
      ).rejects.toThrow(/eligible/i);
    });

    it("allows a BOTH-direction (execution) item into either scenario", async () => {
      const { userId, bullishScenario, bearishScenario, bothItem } = await setupWithConfluences("both-ok");
      await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: bothItem.id });
      await svc.addScenarioCondition(userId, bearishScenario.id, { checklistItemId: bothItem.id });
    });

    it("rejects a duplicate condition within the same scenario", async () => {
      const { userId, bullishScenario, bullishItem } = await setupWithConfluences("dup-condition");
      await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: bullishItem.id });
      await expect(
        svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: bullishItem.id }),
      ).rejects.toThrow(/already part of/i);
    });

    it("rejects a condition referencing a checklist item from a different strategy (cross-strategy protection)", async () => {
      const { userId, bullishScenario } = await setupWithConfluences("cross-strategy-a");
      const other = await createStrategy(userId, { name: "Other strategy", description: undefined });
      const otherItem = await createChecklistItem(
        userId,
        other.id,
        "CONFLUENCE",
        confluence({ name: "Other's confluence", directionApplicability: "BOTH" }),
      );
      await expect(
        svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: otherItem.id }),
      ).rejects.toThrow(/different strategy/i);
    });

    it("rejects a condition referencing another user's checklist item (cross-user protection)", async () => {
      const { userId, bullishScenario } = await setupWithConfluences("cross-user-item-a");
      const other = await setupStrategy("cross-user-item-b");
      const otherItem = await createChecklistItem(
        other.userId,
        other.strategyId,
        "CONFLUENCE",
        confluence({ name: "Their confluence", directionApplicability: "BOTH" }),
      );
      await expect(
        svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: otherItem.id }),
      ).rejects.toThrow();
    });

    it("an override applies only within this scenario, without touching the underlying checklist item", async () => {
      const { userId, strategyId, bullishScenario, bullishItem } = await setupWithConfluences(
        "inherit-override",
      );
      const condition = await svc.addScenarioCondition(userId, bullishScenario.id, {
        checklistItemId: bullishItem.id,
      });
      await svc.updateScenarioCondition(userId, condition.id, { mandatoryOverride: false, weightOverride: 75 });

      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const scenarioAfter = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
      expect(scenarioAfter.conditions[0].mandatoryOverride).toBe(false);
      expect(scenarioAfter.conditions[0].weightOverride).toBe(75);

      // The underlying checklist item is completely untouched.
      const underlying = await prisma.strategyChecklistItem.findFirst({ where: { id: bullishItem.id } });
      expect(underlying?.mandatory).toBe(true);
      expect(underlying?.weight).toBe(30);
    });

    it("removing a condition never deletes the underlying checklist item", async () => {
      const { userId, strategyId, bullishScenario, bullishItem } = await setupWithConfluences("remove-condition");
      const condition = await svc.addScenarioCondition(userId, bullishScenario.id, {
        checklistItemId: bullishItem.id,
      });
      await svc.removeScenarioCondition(userId, condition.id);

      const stillExists = await prisma.strategyChecklistItem.findFirst({
        where: { id: bullishItem.id, strategyId, deletedAt: null },
      });
      expect(stillExists).not.toBeNull();

      const [afterRemoval] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const scenarioAfter = afterRemoval.scenarios.find((s) => s.direction === "BULLISH")!;
      expect(scenarioAfter.conditions).toHaveLength(0);
    });

    it("reorders conditions within a scenario", async () => {
      const { userId, strategyId, bullishScenario, bullishItem } = await setupWithConfluences("reorder-conditions");
      const secondItem = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bullish FVG", directionApplicability: "BULLISH" }),
      );
      const c1 = await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: bullishItem.id });
      const c2 = await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: secondItem.id });

      await svc.reorderScenarioConditions(userId, bullishScenario.id, [c2.id, c1.id]);

      const [after] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const scenarioAfter = after.scenarios.find((s) => s.direction === "BULLISH")!;
      expect(scenarioAfter.conditions.map((c) => c.id)).toEqual([c2.id, c1.id]);
    });
  });

  describe("getEffectiveScenario — the Stage 4 resolver entry point", () => {
    it("resolves the effective condition list with overrides applied", async () => {
      const { userId, strategyId } = await setupStrategy("effective");
      const item = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bullish MSB", weight: 30, mandatory: true, directionApplicability: "BULLISH" }),
      );
      const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });
      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;

      await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: item.id });
      const condition = (await svc.listSetupTypesWithScenarios(userId, strategyId))[0].scenarios.find(
        (s) => s.direction === "BULLISH",
      )!.conditions[0];
      await svc.updateScenarioCondition(userId, condition.id, { weightOverride: 60 });

      const effective = await svc.getEffectiveScenario(userId, setupType.id, "BULLISH");
      expect(effective).not.toBeNull();
      expect(effective!.conditions).toHaveLength(1);
      expect(effective!.conditions[0].weight).toBe(60); // overridden
      expect(effective!.conditions[0].mandatory).toBe(true); // inherited
      expect(effective!.conditions[0].name).toBe("Bullish MSB");
    });

    it("returns null for a setup type owned by another user", async () => {
      const attacker = await makeUser("effective-attacker");
      userIds.push(attacker.id);
      const owner = await setupStrategy("effective-owner");
      const setupType = await svc.createSetupType(owner.userId, owner.strategyId, { name: "Type A" });

      expect(await svc.getEffectiveScenario(attacker.id, setupType.id, "BULLISH")).toBeNull();
    });

    it("returns an empty condition list for the Bearish scenario when the trader only trades Bullish", async () => {
      const { userId, strategyId } = await setupStrategy("one-sided");
      const item = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bullish MSB", directionApplicability: "BULLISH" }),
      );
      const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A" });
      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
      await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: item.id });

      const bearishEffective = await svc.getEffectiveScenario(userId, setupType.id, "BEARISH");
      expect(bearishEffective).not.toBeNull();
      expect(bearishEffective!.conditions).toHaveLength(0); // intentionally empty, not missing
    });
  });

  describe("strategy version snapshots include Setup Types (historical integrity)", () => {
    it("freezes the setup type's effective conditions into the published snapshot, and a later edit never mutates it", async () => {
      const { userId, strategyId } = await setupStrategy("snapshot");
      const item = await createChecklistItem(
        userId,
        strategyId,
        "CONFLUENCE",
        confluence({ name: "Bullish MSB", weight: 30, mandatory: true, directionApplicability: "BULLISH" }),
      );
      const setupType = await svc.createSetupType(userId, strategyId, { name: "Type A", description: "v1 desc" });
      const [withScenarios] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
      await svc.addScenarioCondition(userId, bullishScenario.id, { checklistItemId: item.id });

      const published = await publishStrategyVersion(userId, strategyId, "v1");
      const snapshot = await getStrategyVersion(userId, strategyId, published.version);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.snapshot.setupTypes).toHaveLength(1);
      const snapshotType = snapshot!.snapshot.setupTypes![0];
      expect(snapshotType.name).toBe("Type A");
      expect(snapshotType.description).toBe("v1 desc");
      const snapshotBullish = snapshotType.scenarios.find((s) => s.direction === "BULLISH")!;
      expect(snapshotBullish.conditions).toHaveLength(1);
      expect(snapshotBullish.conditions[0]).toMatchObject({
        checklistItemId: item.id,
        name: "Bullish MSB",
        mandatory: true,
        weight: 30,
      });

      // Now edit the LIVE setup type: rename it, change the description, and
      // override the condition's weight — none of this should touch the
      // already-published snapshot above.
      await svc.updateSetupType(userId, setupType.id, { name: "Type A Renamed", description: "v2 desc" });
      const [afterEdit] = await svc.listSetupTypesWithScenarios(userId, strategyId);
      const scenarioAfterEdit = afterEdit.scenarios.find((s) => s.direction === "BULLISH")!;
      await svc.updateScenarioCondition(userId, scenarioAfterEdit.conditions[0].id, { weightOverride: 99 });

      const snapshotAfterEdit = await getStrategyVersion(userId, strategyId, published.version);
      const snapshotTypeAfterEdit = snapshotAfterEdit!.snapshot.setupTypes![0];
      expect(snapshotTypeAfterEdit.name).toBe("Type A"); // unchanged
      expect(snapshotTypeAfterEdit.description).toBe("v1 desc"); // unchanged
      expect(
        snapshotTypeAfterEdit.scenarios.find((s) => s.direction === "BULLISH")!.conditions[0].weight,
      ).toBe(30); // unchanged — still the value frozen at publish time
    });
  });
});
