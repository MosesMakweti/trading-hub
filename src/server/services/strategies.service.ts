import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
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

// Full-tree include shared by publish (snapshot) and duplicate.
const strategyTreeInclude = {
  arsenalConcepts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  frameworkSteps: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  timeframes: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { checkpoints: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
  },
  entryModels: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  tradeManagement: {
    include: {
      partialTakeProfits: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      customRules: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  },
} satisfies Prisma.StrategyInclude;

type StrategyTree = Prisma.StrategyGetPayload<{ include: typeof strategyTreeInclude }>;

function buildSnapshot(s: StrategyTree): StrategyVersionSnapshot {
  return {
    name: s.name,
    description: s.description,
    applicableAssets: s.applicableAssets,
    status: s.status,
    arsenalConcepts: s.arsenalConcepts.map((c) => ({
      id: c.id,
      name: c.name,
      definition: c.definition,
      purpose: c.purpose,
      howIIdentify: c.howIIdentify,
      whyItMatters: c.whyItMatters,
      whenIUse: c.whenIUse,
      whenIIgnore: c.whenIIgnore,
      examples: c.examples,
      personalNotes: c.personalNotes,
    })),
    frameworkSteps: s.frameworkSteps.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      notes: f.notes,
    })),
    timeframes: s.timeframes.map((t) => ({
      id: t.id,
      name: t.name,
      checkpoints: t.checkpoints.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        notes: c.notes,
      })),
    })),
    entryModels: s.entryModels.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      conditions: m.conditions,
      confirmationChecklist: m.confirmationChecklist,
      invalidation: m.invalidation,
      stopPlacement: m.stopPlacement,
      targetLogic: m.targetLogic,
      notes: m.notes,
    })),
    tradeManagement: s.tradeManagement
      ? {
          id: s.tradeManagement.id,
          takeProfitPhilosophy: s.tradeManagement.takeProfitPhilosophy,
          initialStopPlacement: s.tradeManagement.initialStopPlacement,
          breakEvenRules: s.tradeManagement.breakEvenRules,
          trailingStopRules: s.tradeManagement.trailingStopRules,
          scalingInRules: s.tradeManagement.scalingInRules,
          scalingOutRules: s.tradeManagement.scalingOutRules,
          maxHoldingTime: s.tradeManagement.maxHoldingTime,
          maxRiskPercent: s.tradeManagement.maxRiskPercent
            ? s.tradeManagement.maxRiskPercent.toNumber()
            : null,
          partialTakeProfits: s.tradeManagement.partialTakeProfits.map((p) => ({
            id: p.id,
            trigger: p.trigger,
            percentToClose: p.percentToClose ? p.percentToClose.toNumber() : null,
            reason: p.reason,
          })),
          customRules: s.tradeManagement.customRules.map((r) => ({ id: r.id, text: r.text })),
        }
      : null,
  };
}

// Everything here is scoped by `userId` (tenant isolation) and the soft-delete
// extension in server/db.ts auto-filters `deletedAt: null` on find/list/count.

// When re-inserting a nullable Json column, a stored SQL NULL reads back as
// `null` but must be written as `Prisma.DbNull` (not the literal `null`).
function toJsonInput(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

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
 * Publishes the current state of a strategy as an immutable version snapshot,
 * then bumps `Strategy.version` so the live strategy becomes the next (editable,
 * unpublished) version. Every published version is preserved verbatim as JSON, so
 * a trade's `strategyVersionSnapshot` always has a concrete version to point at.
 */
export async function publishStrategyVersion(
  userId: string,
  strategyId: string,
  note: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const strategy = await tx.strategy.findFirst({
      where: { id: strategyId, userId },
      include: strategyTreeInclude,
    });
    if (!strategy) throw new Error("Strategy not found.");

    const snapshot = buildSnapshot(strategy);
    const created = await tx.strategyVersion.create({
      data: {
        strategyId,
        version: strategy.version,
        note: note?.trim() ? note.trim() : null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.strategy.update({
      where: { id: strategyId },
      data: { version: strategy.version + 1 },
    });
    return created;
  });
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
 * work. Mirrors duplicateStrategy's deep-copy, but the source is the frozen JSON
 * snapshot (order comes from array position). Rich-text fields are re-inserted
 * via toJsonInput (a stored SQL NULL must be written as Prisma.DbNull).
 */
export async function restoreStrategyVersionAsNewStrategy(
  userId: string,
  strategyId: string,
  version: number,
) {
  const owned = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
  if (!owned) throw new Error("Strategy not found.");
  const row = await prisma.strategyVersion.findFirst({ where: { strategyId, version } });
  if (!row) throw new Error("Version not found.");
  const snap = row.snapshot as unknown as StrategyVersionSnapshot;

  const last = await prisma.strategy.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" } });
  const json = (value: unknown) => toJsonInput(value as Prisma.JsonValue | null);

  return prisma.$transaction(async (tx) => {
    const created = await tx.strategy.create({
      data: {
        userId,
        name: `${snap.name} (v${version} restored)`,
        description: snap.description,
        applicableAssets: snap.applicableAssets ?? [],
        status: "DRAFT",
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    if (snap.arsenalConcepts?.length) {
      await tx.arsenalConcept.createMany({
        data: snap.arsenalConcepts.map((c, i) => ({
          strategyId: created.id,
          name: c.name,
          sortOrder: i,
          definition: json(c.definition),
          purpose: json(c.purpose),
          howIIdentify: json(c.howIIdentify),
          whyItMatters: json(c.whyItMatters),
          whenIUse: json(c.whenIUse),
          whenIIgnore: json(c.whenIIgnore),
          examples: json(c.examples),
          personalNotes: json(c.personalNotes),
        })),
      });
    }

    if (snap.frameworkSteps?.length) {
      await tx.strategyFrameworkStep.createMany({
        data: snap.frameworkSteps.map((s, i) => ({
          strategyId: created.id,
          title: s.title,
          sortOrder: i,
          description: json(s.description),
          notes: json(s.notes),
        })),
      });
    }

    for (const [i, tf] of (snap.timeframes ?? []).entries()) {
      const newTf = await tx.strategyTimeframe.create({
        data: { strategyId: created.id, name: tf.name, sortOrder: i },
      });
      if (tf.checkpoints?.length) {
        await tx.strategyCheckpoint.createMany({
          data: tf.checkpoints.map((cp, j) => ({
            timeframeId: newTf.id,
            title: cp.title,
            sortOrder: j,
            description: json(cp.description),
            notes: json(cp.notes),
          })),
        });
      }
    }

    if (snap.entryModels?.length) {
      await tx.strategyEntryModel.createMany({
        data: snap.entryModels.map((m, i) => ({
          strategyId: created.id,
          name: m.name,
          sortOrder: i,
          description: json(m.description),
          conditions: json(m.conditions),
          confirmationChecklist: json(m.confirmationChecklist),
          invalidation: json(m.invalidation),
          stopPlacement: json(m.stopPlacement),
          targetLogic: json(m.targetLogic),
          notes: json(m.notes),
        })),
      });
    }

    const tm = snap.tradeManagement;
    if (tm) {
      const newTm = await tx.strategyTradeManagement.create({
        data: {
          strategyId: created.id,
          takeProfitPhilosophy: json(tm.takeProfitPhilosophy),
          initialStopPlacement: json(tm.initialStopPlacement),
          breakEvenRules: json(tm.breakEvenRules),
          trailingStopRules: json(tm.trailingStopRules),
          scalingInRules: json(tm.scalingInRules),
          scalingOutRules: json(tm.scalingOutRules),
          maxHoldingTime: tm.maxHoldingTime,
          maxRiskPercent: tm.maxRiskPercent,
        },
      });
      if (tm.partialTakeProfits?.length) {
        await tx.partialTakeProfit.createMany({
          data: tm.partialTakeProfits.map((p, i) => ({
            tradeManagementId: newTm.id,
            trigger: p.trigger,
            percentToClose: p.percentToClose,
            reason: p.reason,
            sortOrder: i,
          })),
        });
      }
      if (tm.customRules?.length) {
        await tx.tradeManagementRule.createMany({
          data: tm.customRules.map((r, i) => ({
            tradeManagementId: newTm.id,
            text: r.text,
            sortOrder: i,
          })),
        });
      }
    }

    return created;
  });
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
        select: { name: true, color: true, category: true, weight: true, mandatory: true, kind: true },
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
        name: c.name,
        color: c.color,
        category: c.category,
        weight: c.weight,
        mandatory: c.mandatory,
      })),
    execution: s.checklistItems
      .filter((c) => c.kind === "EXECUTION")
      .map((c) => ({
        name: c.name,
        color: c.color,
        category: c.category,
        weight: c.weight,
        mandatory: c.mandatory,
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
 * Deep-copy a strategy, including (eventually) every nested workspace section.
 *
 * Phase 1 only copies the top-level fields. It is written as a single
 * transaction on purpose: when Phase 2+ adds nested sections (Arsenal concepts,
 * framework steps, timeframes + checkpoints, entry models, trade management),
 * their rows are created inside THIS transaction keyed to `copy.id` — see the
 * marked extension point below — so a duplicate is always all-or-nothing.
 */
export async function duplicateStrategy(userId: string, id: string) {
  const source = await prisma.strategy.findFirst({
    where: { id, userId },
    include: {
      // Only live rows; the extension doesn't filter nested relations.
      arsenalConcepts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      frameworkSteps: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      timeframes: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: { checkpoints: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
      },
      entryModels: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      tradeManagement: {
        include: {
          partialTakeProfits: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
          customRules: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!source) throw new Error("Strategy not found.");

  const last = await prisma.strategy.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.$transaction(async (tx) => {
    const copy = await tx.strategy.create({
      data: {
        userId,
        name: `${source.name} (copy)`,
        description: source.description,
        applicableAssets: source.applicableAssets,
        // A duplicate starts as a working draft you then adapt.
        status: "DRAFT",
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    // ── Deep-copy nested sections into `copy` (add future sections here) ─────
    // Section 1 — Arsenal:
    if (source.arsenalConcepts.length > 0) {
      await tx.arsenalConcept.createMany({
        data: source.arsenalConcepts.map((c) => ({
          strategyId: copy.id,
          name: c.name,
          sortOrder: c.sortOrder,
          definition: toJsonInput(c.definition),
          purpose: toJsonInput(c.purpose),
          howIIdentify: toJsonInput(c.howIIdentify),
          whyItMatters: toJsonInput(c.whyItMatters),
          whenIUse: toJsonInput(c.whenIUse),
          whenIIgnore: toJsonInput(c.whenIIgnore),
          examples: toJsonInput(c.examples),
          personalNotes: toJsonInput(c.personalNotes),
        })),
      });
    }

    // Section 2 — Framework:
    if (source.frameworkSteps.length > 0) {
      await tx.strategyFrameworkStep.createMany({
        data: source.frameworkSteps.map((s) => ({
          strategyId: copy.id,
          title: s.title,
          sortOrder: s.sortOrder,
          description: toJsonInput(s.description),
          notes: toJsonInput(s.notes),
        })),
      });
    }

    // Section 3 — Timeframes (nested): create each timeframe, then its checkpoints
    // under the new timeframe id, all inside this transaction.
    for (const tf of source.timeframes) {
      const newTf = await tx.strategyTimeframe.create({
        data: { strategyId: copy.id, name: tf.name, sortOrder: tf.sortOrder },
      });
      if (tf.checkpoints.length > 0) {
        await tx.strategyCheckpoint.createMany({
          data: tf.checkpoints.map((cp) => ({
            timeframeId: newTf.id,
            title: cp.title,
            sortOrder: cp.sortOrder,
            description: toJsonInput(cp.description),
            notes: toJsonInput(cp.notes),
          })),
        });
      }
    }

    // Section 4 — Entry Models:
    if (source.entryModels.length > 0) {
      await tx.strategyEntryModel.createMany({
        data: source.entryModels.map((m) => ({
          strategyId: copy.id,
          name: m.name,
          sortOrder: m.sortOrder,
          description: toJsonInput(m.description),
          conditions: toJsonInput(m.conditions),
          confirmationChecklist: toJsonInput(m.confirmationChecklist),
          invalidation: toJsonInput(m.invalidation),
          stopPlacement: toJsonInput(m.stopPlacement),
          targetLogic: toJsonInput(m.targetLogic),
          notes: toJsonInput(m.notes),
        })),
      });
    }

    // Section 5 — Trade Management (1:1 + two child lists): create the record,
    // then its partial TPs and custom rules under the new record id.
    const tm = source.tradeManagement;
    if (tm) {
      const newTm = await tx.strategyTradeManagement.create({
        data: {
          strategyId: copy.id,
          takeProfitPhilosophy: toJsonInput(tm.takeProfitPhilosophy),
          initialStopPlacement: toJsonInput(tm.initialStopPlacement),
          breakEvenRules: toJsonInput(tm.breakEvenRules),
          trailingStopRules: toJsonInput(tm.trailingStopRules),
          scalingInRules: toJsonInput(tm.scalingInRules),
          scalingOutRules: toJsonInput(tm.scalingOutRules),
          maxHoldingTime: tm.maxHoldingTime,
          maxRiskPercent: tm.maxRiskPercent,
        },
      });
      if (tm.partialTakeProfits.length > 0) {
        await tx.partialTakeProfit.createMany({
          data: tm.partialTakeProfits.map((p) => ({
            tradeManagementId: newTm.id,
            trigger: p.trigger,
            percentToClose: p.percentToClose,
            reason: p.reason,
            sortOrder: p.sortOrder,
          })),
        });
      }
      if (tm.customRules.length > 0) {
        await tx.tradeManagementRule.createMany({
          data: tm.customRules.map((r) => ({
            tradeManagementId: newTm.id,
            text: r.text,
            sortOrder: r.sortOrder,
          })),
        });
      }
    }

    return copy;
  });
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
