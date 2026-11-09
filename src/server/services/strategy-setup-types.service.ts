import { Prisma, type SetupScenarioDirection } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  isEligibleForScenario,
  resolveScenarioConditions,
  type ResolvedSetupCondition,
} from "@/domain/strategies/setup-type-scoring";
import { pickScenarioForTrade, scenarioDirectionLabel } from "@/domain/strategies/scenario-playbook";
import type {
  SetupScenarioConditionAddInput,
  SetupScenarioConditionUpdateInput,
  SetupScenarioCreateInput,
  SetupScenarioDetailsInput,
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
    include: {
      scenarios: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, include: setupScenarioConditionInclude },
    },
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
        { setupTypeId: setupType.id, direction: "BULLISH", name: "Bullish", sortOrder: 0 },
        { setupTypeId: setupType.id, direction: "BEARISH", name: "Bearish", sortOrder: 1 },
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
    where: { id: scenarioId, deletedAt: null, setupType: { userId } },
    data: { description: data.description },
  });
  if (result.count === 0) throw new Error("Scenario not found.");
}

async function ownedSetupType(userId: string, setupTypeId: string) {
  const setupType = await prisma.strategySetupType.findFirst({
    where: { id: setupTypeId, userId, deletedAt: null },
    select: { id: true, strategyId: true },
  });
  if (!setupType) throw new Error("Setup type not found.");
  return setupType;
}

/** Adds a scenario (any direction) at the end of a Setup Type's list. */
export async function createScenario(userId: string, setupTypeId: string, data: SetupScenarioCreateInput) {
  await ownedSetupType(userId, setupTypeId);
  const last = await prisma.strategySetupScenario.findFirst({
    where: { setupTypeId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return prisma.strategySetupScenario.create({
    data: {
      setupTypeId,
      name: data.name,
      direction: data.direction,
      scenarioType: data.scenarioType ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

/**
 * Edits a scenario's identity, context and execution plan. A direction
 * change is refused while the scenario still holds a condition that the new
 * direction can't use (e.g. a bearish-only confluence in a Bullish scenario).
 */
export async function updateScenarioDetails(userId: string, scenarioId: string, data: SetupScenarioDetailsInput) {
  const scenario = await ownedScenario(userId, scenarioId);
  if (data.direction !== undefined && data.direction !== scenario.direction) {
    const conditions = await prisma.strategySetupScenarioCondition.findMany({
      where: { scenarioId, checklistItem: { deletedAt: null } },
      select: { checklistItem: { select: { name: true, directionApplicability: true } } },
    });
    const blocking = conditions.filter((c) => !isEligibleForScenario(c.checklistItem.directionApplicability, data.direction!));
    if (blocking.length > 0) {
      throw new Error(
        `Remove ${blocking.map((c) => `"${c.checklistItem.name}"`).join(", ")} first — ${
          blocking.length === 1 ? "it doesn't" : "they don't"
        } apply to a ${scenarioDirectionLabel(data.direction)} scenario.`,
      );
    }
  }
  const json = (v: unknown) => (v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));
  await prisma.strategySetupScenario.update({
    where: { id: scenarioId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.direction !== undefined ? { direction: data.direction } : {}),
      ...(data.scenarioType !== undefined ? { scenarioType: data.scenarioType } : {}),
      ...(data.customType !== undefined ? { customType: data.customType } : {}),
      ...(data.instruments !== undefined ? { instruments: data.instruments } : {}),
      ...(data.timeframes !== undefined ? { timeframes: data.timeframes } : {}),
      ...(data.context !== undefined ? { context: json(data.context) } : {}),
      ...(data.executionPlan !== undefined ? { executionPlan: json(data.executionPlan) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
}

/**
 * Copies a scenario — identity, context, plan and its conditions (with their
 * overrides and notes) — directly after the original. Conditions keep
 * REFERENCING the same checklist items; nothing in the strategy is copied.
 */
export async function duplicateScenario(userId: string, scenarioId: string) {
  await ownedScenario(userId, scenarioId);
  const source = await prisma.strategySetupScenario.findUniqueOrThrow({
    where: { id: scenarioId },
    include: { conditions: { orderBy: { sortOrder: "asc" } } },
  });
  return prisma.$transaction(async (tx) => {
    // Make room right after the source.
    await tx.strategySetupScenario.updateMany({
      where: { setupTypeId: source.setupTypeId, deletedAt: null, sortOrder: { gt: source.sortOrder } },
      data: { sortOrder: { increment: 1 } },
    });
    const copy = await tx.strategySetupScenario.create({
      data: {
        setupTypeId: source.setupTypeId,
        name: `${source.name || scenarioDirectionLabel(source.direction)} (copy)`.slice(0, 80),
        direction: source.direction,
        scenarioType: source.scenarioType,
        customType: source.customType,
        instruments: source.instruments,
        timeframes: source.timeframes,
        context: source.context ?? Prisma.DbNull,
        executionPlan: source.executionPlan ?? Prisma.DbNull,
        description: source.description,
        sortOrder: source.sortOrder + 1,
      },
    });
    if (source.conditions.length > 0) {
      await tx.strategySetupScenarioCondition.createMany({
        data: source.conditions.map((c) => ({
          scenarioId: copy.id,
          checklistItemId: c.checklistItemId,
          mandatoryOverride: c.mandatoryOverride,
          weightOverride: c.weightOverride,
          note: c.note,
          sortOrder: c.sortOrder,
        })),
      });
    }
    return copy;
  });
}

/**
 * Archives a scenario (soft delete). Trades that were validated against it
 * keep their link and their frozen validation snapshot.
 */
export async function archiveScenario(userId: string, scenarioId: string) {
  const result = await prisma.strategySetupScenario.updateMany({
    where: { id: scenarioId, deletedAt: null, setupType: { userId } },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Scenario not found.");
}

export async function reorderScenarios(userId: string, setupTypeId: string, orderedIds: string[]) {
  await ownedSetupType(userId, setupTypeId);
  const owned = await prisma.strategySetupScenario.count({ where: { id: { in: orderedIds }, setupTypeId, deletedAt: null } });
  if (owned !== orderedIds.length) throw new Error("Some scenarios were not found.");
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.strategySetupScenario.updateMany({ where: { id, setupTypeId }, data: { sortOrder: index } })),
  );
}

async function ownedScenario(userId: string, scenarioId: string) {
  const scenario = await prisma.strategySetupScenario.findFirst({
    where: { id: scenarioId, deletedAt: null, setupType: { userId } },
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
    throw new Error(`This condition isn't eligible for a ${scenarioDirectionLabel(scenario.direction)} scenario.`);
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
      ...(data.note !== undefined ? { note: data.note } : {}),
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
  scenario: { id: string; name: string; direction: SetupScenarioDirection; description: string | null };
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
  tradeDirection: "LONG" | "SHORT",
  /** An explicitly chosen scenario; it must fit the trade's direction. */
  scenarioId?: string | null,
): Promise<EffectiveSetupScenario | null> {
  const setupType = await prisma.strategySetupType.findFirst({
    where: { id: setupTypeId, userId },
    select: {
      id: true,
      name: true,
      description: true,
      scenarios: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          conditions: {
            where: { checklistItem: { deletedAt: null } },
            include: { checklistItem: true },
          },
        },
      },
    },
  });
  if (!setupType) return null;
  // First scenario of the trade's direction, else a NEUTRAL one — or the
  // explicitly chosen scenario, if it fits (see pickScenarioForTrade).
  const scenario = pickScenarioForTrade(setupType.scenarios, tradeDirection, scenarioId);
  if (!scenario) return null;

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
    scenario: { id: scenario.id, name: scenario.name, direction: scenario.direction, description: scenario.description },
    conditions,
  };
}
