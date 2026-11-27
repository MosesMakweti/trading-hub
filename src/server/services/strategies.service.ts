import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  buildSnapshot,
  loadStrategyTree,
  materializeSnapshot,
  nameWithSuffix,
  strategyTreeInclude,
  TREE_TX_OPTIONS,
  type MaterializeReport,
} from "@/server/services/strategy-tree";
import { StrategyLabError } from "@/server/services/strategy-errors";
import { summarizeStrategyVersionSnapshot } from "@/domain/strategies/version-snapshot";
import { diffStrategyVersions } from "@/domain/strategies/version-diff";
import type {
  StrategyCreateInput,
  StrategySettingsInput,
} from "@/lib/validation/strategies";
import type {
  StrategyVersionDiff,
  StrategyVersionDTO,
  StrategyVersionSnapshot,
} from "@/types/strategies";

export type VersionRef = number | "current";

// Everything here is scoped by `userId` (tenant isolation) and the soft-delete
// extension in server/db.ts auto-filters `deletedAt: null` on find/list/count.
// The full strategy tree (snapshot + materialize) lives in strategy-tree.ts.

export async function listStrategies(userId: string) {
  return prisma.strategy.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getStrategy(userId: string, id: string) {
  // findFirst so the soft-delete filter applies (findUnique bypasses it).
  return prisma.strategy.findFirst({ where: { id, userId } });
}

/**
 * The strategy's CURRENT full tree frozen in the same shape as a published
 * StrategyVersion.snapshot, without publishing or bumping the version.
 * Backtesting (Stage 1) freezes this onto a BacktestRun at creation so the
 * experiment stays interpretable after later Strategy Lab edits. Null if the
 * strategy doesn't exist / isn't the user's.
 */
export async function captureStrategySnapshot(
  userId: string,
  strategyId: string,
): Promise<{ name: string; version: number; snapshot: StrategyVersionSnapshot } | null> {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    include: strategyTreeInclude,
  });
  if (!strategy) return null;
  return { name: strategy.name, version: strategy.version, snapshot: buildSnapshot(strategy) };
}

/**
 * Publishes the current state of a strategy as an immutable version snapshot,
 * then bumps `Strategy.version` so the live strategy becomes the next (editable,
 * unpublished) version. Every published version is preserved verbatim as JSON, so
 * a trade's `strategyVersionSnapshot` always has a concrete version to point at.
 *
 * Concurrency: the version bump is a compare-and-set on the version that was
 * read. A second, simultaneous publish blocks on the row lock, then finds the
 * version already moved and fails with a clear CONFLICT — it never creates a
 * duplicate/skipped version number and never surfaces a raw DB error. Not
 * auto-retried: a double-click must not publish the same content twice.
 */
export async function publishStrategyVersion(
  userId: string,
  strategyId: string,
  note: string | null,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const strategy = await loadStrategyTree(tx, userId, strategyId);
      if (!strategy) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");

      const bumped = await tx.strategy.updateMany({
        where: { id: strategyId, userId, deletedAt: null, version: strategy.version },
        data: { version: strategy.version + 1 },
      });
      if (bumped.count === 0) throw publishConflict();

      return tx.strategyVersion.create({
        data: {
          strategyId,
          version: strategy.version,
          note: note?.trim() ? note.trim() : null,
          snapshot: buildSnapshot(strategy) as unknown as Prisma.InputJsonValue,
        },
      });
    }, TREE_TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw publishConflict();
    }
    throw error;
  }
}

function publishConflict() {
  return new StrategyLabError(
    "This strategy was just published from another tab or device. Refresh to see the new version, then publish again if needed.",
    "CONFLICT",
  );
}

/**
 * Diffs two points in a strategy's history. Each ref is a published version
 * number or `"current"` (the live, unpublished draft, snapshotted on the fly).
 * Returns null if the strategy isn't the user's or a referenced version is
 * missing. Pure diff lives in domain/strategies/version-diff.
 */
export async function getStrategyVersionComparison(
  userId: string,
  strategyId: string,
  base: VersionRef,
  target: VersionRef,
): Promise<StrategyVersionDiff | null> {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    include: strategyTreeInclude,
  });
  if (!strategy) return null;
  const current = buildSnapshot(strategy);

  const load = async (ref: VersionRef): Promise<StrategyVersionSnapshot | null> => {
    if (ref === "current") return current;
    const row = await prisma.strategyVersion.findFirst({
      where: { strategyId, version: ref },
    });
    return row ? (row.snapshot as unknown as StrategyVersionSnapshot) : null;
  };

  const [from, to] = await Promise.all([load(base), load(target)]);
  if (!from || !to) return null;
  return diffStrategyVersions(from, to);
}

/** One published version's full snapshot (for the read-only version view). */
export async function getStrategyVersion(
  userId: string,
  strategyId: string,
  version: number,
): Promise<{ version: number; note: string | null; createdAt: string; snapshot: StrategyVersionSnapshot } | null> {
  const owned = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
  if (!owned) return null;
  const row = await prisma.strategyVersion.findFirst({ where: { strategyId, version } });
  if (!row) return null;
  return {
    version: row.version,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    snapshot: row.snapshot as unknown as StrategyVersionSnapshot,
  };
}

/**
 * Restores a published version by rebuilding its snapshot into a **new** DRAFT
 * strategy — never mutating the live one, so a restore can't clobber current
 * work. Shares strategy-tree.ts's materializer with duplicate, so every
 * section (incl. sessions, checklist, setup types, trade-management targets)
 * comes back with fresh ids and internally-remapped references.
 */
export async function restoreStrategyVersionAsNewStrategy(
  userId: string,
  strategyId: string,
  version: number,
): Promise<MaterializeReport["strategy"] & { droppedConditions: MaterializeReport["droppedConditions"] }> {
  const owned = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
  if (!owned) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");
  const row = await prisma.strategyVersion.findFirst({ where: { strategyId, version } });
  if (!row) throw new StrategyLabError("Version not found.", "NOT_FOUND");
  const snap = row.snapshot as unknown as StrategyVersionSnapshot;

  const report = await prisma.$transaction(
    (tx) =>
      materializeSnapshot(tx, userId, snap, {
        name: nameWithSuffix(snap.name, ` (v${version} restored)`),
        status: "DRAFT",
      }),
    TREE_TX_OPTIONS,
  );
  return { ...report.strategy, droppedConditions: report.droppedConditions };
}

/** Published versions of a strategy, newest first, each with a compact summary. */
export async function listStrategyVersions(
  userId: string,
  strategyId: string,
): Promise<StrategyVersionDTO[]> {
  const owned = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return [];

  const versions = await prisma.strategyVersion.findMany({
    where: { strategyId },
    orderBy: { version: "desc" },
  });

  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    summary: summarizeStrategyVersionSnapshot(v.snapshot as unknown as StrategyVersionSnapshot),
  }));
}

/**
 * A read-only reference view of a strategy for the Journal (Phase 7): its
 * applicable assets, entry models, framework steps, and trade-management rules —
 * so a trade that references the strategy can surface its process as context.
 * **Never includes Arsenal** (the Journal references, it does not copy the
 * knowledge base). Nested relations need explicit `deletedAt: null` because the
 * soft-delete extension only guards top-level queries.
 */
export async function getStrategyReference(userId: string, id: string) {
  const s = await prisma.strategy.findFirst({
    where: { id, userId },
    include: {
      entryModels: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { name: true },
      },
      frameworkSteps: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { title: true },
      },
      sessions: {
        where: { deletedAt: null, enabled: true },
        orderBy: { sortOrder: "asc" },
        select: { name: true, color: true },
      },
      checklistItems: {
        where: { deletedAt: null, enabled: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          color: true,
          category: true,
          weight: true,
          mandatory: true,
          kind: true,
          directionApplicability: true,
          pairId: true,
        },
      },
      tradeManagement: {
        include: {
          customRules: {
            where: { deletedAt: null },
            orderBy: { sortOrder: "asc" },
            select: { text: true },
          },
          partialTakeProfits: {
            where: { deletedAt: null },
            orderBy: { sortOrder: "asc" },
            select: { trigger: true, percentToClose: true },
          },
        },
      },
      // Trade Idea Validation Shield (Stage 4) — just enough to populate the
      // trade form's Setup Type picker; its scenario/conditions are loaded
      // live (getEffectiveScenario) only once a Setup Type is actually picked.
      setupTypes: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      },
    },
  });
  if (!s) return null;

  return {
    id: s.id,
    name: s.name,
    version: s.version,
    applicableAssets: s.applicableAssets,
    entryModels: s.entryModels.map((e) => e.name),
    frameworkSteps: s.frameworkSteps.map((f) => f.title),
    sessions: s.sessions.map((x) => ({ name: x.name, color: x.color })),
    confluences: s.checklistItems
      .filter((c) => c.kind === "CONFLUENCE")
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        category: c.category,
        weight: c.weight,
        mandatory: c.mandatory,
        directionApplicability: c.directionApplicability,
        pairId: c.pairId,
      })),
    execution: s.checklistItems
      .filter((c) => c.kind === "EXECUTION")
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        category: c.category,
        weight: c.weight,
        mandatory: c.mandatory,
        directionApplicability: c.directionApplicability,
        pairId: c.pairId,
      })),
    tradeManagement: s.tradeManagement
      ? {
          maxRiskPercent: s.tradeManagement.maxRiskPercent
            ? s.tradeManagement.maxRiskPercent.toNumber()
            : null,
          maxHoldingTime: s.tradeManagement.maxHoldingTime,
          customRules: s.tradeManagement.customRules.map((r) => r.text),
          partialTakeProfits: s.tradeManagement.partialTakeProfits.map((p) => ({
            trigger: p.trigger,
            percentToClose: p.percentToClose ? p.percentToClose.toNumber() : null,
          })),
        }
      : null,
    setupTypes: s.setupTypes.map((t) => ({ id: t.id, name: t.name })),
  };
}

export async function createStrategy(userId: string, data: StrategyCreateInput) {
  const last = await prisma.strategy.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategy.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

/** Settings-tab update (name, description, assets, status). Autosaved. */
export async function updateStrategySettings(
  userId: string,
  id: string,
  data: StrategySettingsInput,
) {
  // Scope the write by userId via updateMany (update-by-unique-id can't also
  // filter userId), so a user can never edit another tenant's strategy.
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: {
      name: data.name,
      description: data.description ?? null,
      applicableAssets: data.applicableAssets,
      status: data.status,
    },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

export async function renameStrategy(userId: string, id: string, name: string) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { name },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/** Archive is a status, not a delete — the strategy stays fully editable. */
export async function setStrategyStatus(
  userId: string,
  id: string,
  status: StrategySettingsInput["status"],
) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { status },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/** Delete = soft delete (hidden by the db.ts extension), reversible at the DB level. */
export async function deleteStrategy(userId: string, id: string) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/**
 * Deep-copies a strategy into an independent DRAFT: snapshot the live tree,
 * then materialize it (strategy-tree.ts) with fresh ids and every reference
 * remapped. One transaction, so a duplicate is all-or-nothing.
 */
export async function duplicateStrategy(userId: string, id: string) {
  const report = await prisma.$transaction(async (tx) => {
    const source = await loadStrategyTree(tx, userId, id);
    if (!source) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");
    return materializeSnapshot(tx, userId, buildSnapshot(source), {
      name: nameWithSuffix(source.name, " (copy)"),
      description: source.description,
      status: "DRAFT",
    });
  }, TREE_TX_OPTIONS);
  return report.strategy;
}

/** Ready for drag-and-drop reordering of the strategy list (Phase 2 UI). */
export async function reorderStrategies(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategy.updateMany({
        where: { id, userId },
        data: { sortOrder: index } as Prisma.StrategyUpdateManyMutationInput,
      }),
    ),
  );
}
