import type { SetupScenarioDirection } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  isEligibleForScenario,
  resolveScenarioConditions,
  type ResolvedSetupCondition,
} from "@/domain/strategies/setup-type-scoring";
import type {
  SetupScenarioConditionAddInput,
  SetupScenarioConditionUpdateInput,
  SetupScenarioUpdateInput,
  SetupTypeUpdateInput,
} from "@/lib/validation/strategy-setup-types";

async function assertOwnsStrategy(userId: string, strategyId: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
  if (!strategy) throw new Error("Strategy not found.");
}

/** Case-insensitive duplicate-name check among a strategy's LIVE setup types
 *  (the DB @@unique is case-sensitive defense-in-depth; this gives a friendly
 *  error and catches case-only duplicates it wouldn't). */
async function assertUniqueSetupTypeName(
  strategyId: string,
  name: string,
  excludeId?: string,
) {
  const existing = await prisma.strategySetupType.findMany({
    where: { strategyId, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
  });
  const normalized = name.trim().toLowerCase();
  if (existing.some((s) => s.name.trim().toLowerCase() === normalized)) {
    throw new Error("A setup type with this name already exists.");
  }
}

const setupScenarioConditionInclude = {
  conditions: {
    where: { checklistItem: { deletedAt: null } },
    orderBy: { sortOrder: "asc" as const },
    include: { checklistItem: true },
  },
};

// ── Setup Types ───────────────────────────────────────────────────────────────

export async function listSetupTypesWithScenarios(userId: string, strategyId: string) {
  return prisma.strategySetupType.findMany({
    where: { strategyId, userId },
    orderBy: { sortOrder: "asc" },
    include: { scenarios: { include: setupScenarioConditionInclude } },
  });
}

/** Creates a Setup Type and both its (initially empty) Bullish + Bearish
 *  scenarios in one transaction — a scenario row always exists, even when
 *  the trader doesn't trade that side (an intentionally empty scenario, not
 *  a missing one). */
export async function createSetupType(
  userId: string,
  strategyId: string,
  data: { name: string; description?: string | null },
) {
  await assertOwnsStrategy(userId, strategyId);
  await assertUniqueSetupTypeName(strategyId, data.name);

  const last = await prisma.strategySetupType.findFirst({
    where: { strategyId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.$transaction(async (tx) => {
    const setupType = await tx.strategySetupType.create({
      data: {
        userId,
        strategyId,
        name: data.name,
        description: data.description ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await tx.strategySetupScenario.createMany({
      data: [
        { setupTypeId: setupType.id, direction: "BULLISH" },
        { setupTypeId: setupType.id, direction: "BEARISH" },
      ],
    });
    return setupType;
  });
}

export async function updateSetupType(userId: string, id: string, data: SetupTypeUpdateInput) {
  const existing = await prisma.strategySetupType.findFirst({
    where: { id, userId },
    select: { strategyId: true },
  });
  if (!existing) throw new Error("Setup type not found.");
  if (data.name !== undefined) {
    await assertUniqueSetupTypeName(existing.strategyId, data.name, id);
  }

  const result = await prisma.strategySetupType.updateMany({
    where: { id, userId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
  if (result.count === 0) throw new Error("Setup type not found.");
}

export async function archiveSetupType(userId: string, id: string) {
  const result = await prisma.strategySetupType.updateMany({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Setup type not found.");
}

export async function reorderSetupTypes(userId: string, strategyId: string, orderedIds: string[]) {
  const owned = await prisma.strategySetupType.count({
    where: { id: { in: orderedIds }, strategyId, userId },
  });
  if (owned !== orderedIds.length) throw new Error("Some setup types were not found.");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategySetupType.updateMany({ where: { id, userId }, data: { sortOrder: index } }),
    ),
  );
}

// ── Scenarios ───────────────────────────────────────────────────────────────

export async function updateScenarioDescription(
  userId: string,
  scenarioId: string,
  data: SetupScenarioUpdateInput,
) {
  const result = await prisma.strategySetupScenario.updateMany({
    where: { id: scenarioId, setupType: { userId } },
    data: { description: data.description },
  });
  if (result.count === 0) throw new Error("Scenario not found.");
}

async function ownedScenario(userId: string, scenarioId: string) {
  const scenario = await prisma.strategySetupScenario.findFirst({
    where: { id: scenarioId, setupType: { userId } },
    select: { id: true, direction: true, setupType: { select: { strategyId: true } } },
  });
  if (!scenario) throw new Error("Scenario not found.");
  return scenario;
}

// ── Scenario conditions ──────────────────────────────────────────────────────

/**
 * Adds an existing StrategyChecklistItem to a scenario (never a copy).
 * Validates: ownership, that the item belongs to the SAME strategy as the
 * scenario (cross-strategy protection), that the item isn't archived, and
 * that its directionApplicability is eligible for this scenario's direction
 * (a bearish-only item can never enter a Bullish scenario, and vice versa).
 */
export async function addScenarioCondition(
  userId: string,
  scenarioId: string,
  data: SetupScenarioConditionAddInput,
) {
  const scenario = await ownedScenario(userId, scenarioId);

  const item = await prisma.strategyChecklistItem.findFirst({
    where: { id: data.checklistItemId, userId, deletedAt: null },
    select: { id: true, strategyId: true, directionApplicability: true },
  });
  if (!item) throw new Error("Checklist item not found.");
  if (item.strategyId !== scenario.setupType.strategyId) {
    throw new Error("That confluence belongs to a different strategy.");
  }
  if (!isEligibleForScenario(item.directionApplicability, scenario.direction)) {
    throw new Error(
      `This condition isn't eligible for the ${scenario.direction === "BULLISH" ? "Bullish" : "Bearish"} scenario.`,
    );
  }

  const existing = await prisma.strategySetupScenarioCondition.findFirst({
    where: { scenarioId, checklistItemId: data.checklistItemId },
    select: { id: true },
  });
  if (existing) throw new Error("This condition is already part of the scenario.");

  const last = await prisma.strategySetupScenarioCondition.findFirst({
    where: { scenarioId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategySetupScenarioCondition.create({
    data: {
      scenarioId,
      checklistItemId: data.checklistItemId,
      mandatoryOverride: data.mandatoryOverride ?? null,
      weightOverride: data.weightOverride ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateScenarioCondition(
  userId: string,
  conditionId: string,
  data: SetupScenarioConditionUpdateInput,
) {
  const result = await prisma.strategySetupScenarioCondition.updateMany({
    where: { id: conditionId, scenario: { setupType: { userId } } },
    data: {
      ...(data.mandatoryOverride !== undefined ? { mandatoryOverride: data.mandatoryOverride } : {}),
      ...(data.weightOverride !== undefined ? { weightOverride: data.weightOverride } : {}),
    },
  });
  if (result.count === 0) throw new Error("Condition not found.");
}

/** Removes a condition from the Setup Type — deletes only this join row, the
 *  underlying StrategyChecklistItem is completely untouched. */
export async function removeScenarioCondition(userId: string, conditionId: string) {
  const result = await prisma.strategySetupScenarioCondition.deleteMany({
    where: { id: conditionId, scenario: { setupType: { userId } } },
  });
  if (result.count === 0) throw new Error("Condition not found.");
}

export async function reorderScenarioConditions(
  userId: string,
  scenarioId: string,
  orderedIds: string[],
) {
  await ownedScenario(userId, scenarioId);

  const owned = await prisma.strategySetupScenarioCondition.count({
    where: { id: { in: orderedIds }, scenarioId },
  });
  if (owned !== orderedIds.length) throw new Error("Some conditions were not found.");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategySetupScenarioCondition.updateMany({
        where: { id, scenarioId },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ── The Stage 4 read path ────────────────────────────────────────────────────

export interface EffectiveSetupScenario {
  setupType: { id: string; name: string; description: string | null };
  scenario: { id: string; direction: SetupScenarioDirection; description: string | null };
  conditions: ResolvedSetupCondition[];
}

/**
 * "Give me the effective Bullish/Bearish Type A checklist" — the exact entry
 * point Stage 4 (Trade Idea validation shield) calls. Returns a ready-to-score
 * condition list (feed straight into
 * domain/strategies/setup-type-scoring.ts's toScorableConfluences, then the
 * existing scoreConfluences engine) or null if the setup type/scenario/user
 * combination doesn't resolve to a real, owned row.
 */
export async function getEffectiveScenario(
  userId: string,
  setupTypeId: string,
  direction: SetupScenarioDirection,
): Promise<EffectiveSetupScenario | null> {
  const setupType = await prisma.strategySetupType.findFirst({
    where: { id: setupTypeId, userId },
    select: {
      id: true,
      name: true,
      description: true,
      scenarios: {
        where: { direction },
        include: {
          conditions: {
            where: { checklistItem: { deletedAt: null } },
            include: { checklistItem: true },
          },
        },
      },
    },
  });
  const scenario = setupType?.scenarios[0];
  if (!setupType || !scenario) return null;

  const conditions = resolveScenarioConditions(
    scenario.conditions.map((c) => ({
      id: c.id,
      checklistItemId: c.checklistItemId,
      checklistItemName: c.checklistItem.name,
      checklistItemKind: c.checklistItem.kind,
      checklistItemColor: c.checklistItem.color,
      checklistItemWeight: c.checklistItem.weight,
      checklistItemMandatory: c.checklistItem.mandatory,
      checklistItemDirectionApplicability: c.checklistItem.directionApplicability,
      mandatoryOverride: c.mandatoryOverride,
      weightOverride: c.weightOverride,
      sortOrder: c.sortOrder,
    })),
  );

  return {
    setupType: { id: setupType.id, name: setupType.name, description: setupType.description },
    scenario: { id: scenario.id, direction: scenario.direction, description: scenario.description },
    conditions,
  };
}
