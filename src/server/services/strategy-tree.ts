import { Prisma } from "@prisma/client";

import type { TransactionClient } from "@/server/db";
import { readExecutionPlan, readScenarioContext } from "@/domain/strategies/scenario-playbook";
import type { StrategyVersionSnapshot } from "@/types/strategies";

/**
 * The ONE place that knows the full shape of a strategy's configuration tree.
 *
 * - `strategyTreeInclude` + `buildSnapshot` freeze a live strategy into a
 *   `StrategyVersionSnapshot` (publish, backtest/sim capture, duplicate).
 * - `materializeSnapshot` rebuilds a snapshot into a brand-new, independent
 *   strategy with fresh ids and every internal reference remapped
 *   (duplicate, restore-a-version, and Backtesting experiments).
 *
 * Duplicate and restore used to have their own hand-written deep copies and
 * silently drifted when Sessions / Confluences / Execution / Setup Types were
 * added. Adding a section now means touching only this file, and the
 * round-trip tests (strategy-tree.test.ts) fail if a field is missed.
 */

type Tx = TransactionClient;

export const MAX_STRATEGY_NAME = 120;

export const strategyTreeInclude = {
  arsenalConcepts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  frameworkSteps: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  timeframes: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { checkpoints: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
  },
  entryModels: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  sessions: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  checklistItems: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
  setupTypes: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: {
      scenarios: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          // A condition whose checklist item was deleted is not part of the
          // strategy any more (the editor hides it too) — never freeze it.
          conditions: {
            where: { checklistItem: { deletedAt: null } },
            orderBy: { sortOrder: "asc" },
            include: { checklistItem: true },
          },
        },
      },
    },
  },
  tradeManagement: {
    include: {
      partialTakeProfits: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      customRules: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  },
} satisfies Prisma.StrategyInclude;

export type StrategyTree = Prisma.StrategyGetPayload<{ include: typeof strategyTreeInclude }>;

/** Loads a user's live strategy tree (null if missing / not theirs / deleted). */
export async function loadStrategyTree(db: Tx, userId: string, strategyId: string) {
  return db.strategy.findFirst({
    where: { id: strategyId, userId, deletedAt: null },
    include: strategyTreeInclude,
  });
}

export function buildSnapshot(s: StrategyTree): StrategyVersionSnapshot {
  const liveItemIds = new Set(s.checklistItems.map((c) => c.id));
  const checklist = (kind: "CONFLUENCE" | "EXECUTION") =>
    s.checklistItems
      .filter((c) => c.kind === kind)
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        category: c.category,
        description: c.description,
        weight: c.weight,
        mandatory: c.mandatory,
        // Frozen so a later strategy edit can't retro-change a trade's eligible set.
        directionApplicability: c.directionApplicability,
        pairId: c.pairId,
        validationCriteria: c.validationCriteria,
        enabled: c.enabled,
      }));

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
    tradeManagement:
      s.tradeManagement && !s.tradeManagement.deletedAt
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
            expectedWinRate: s.tradeManagement.expectedWinRate,
            expectedAvgRr: s.tradeManagement.expectedAvgRr,
            expectedExpectancy: s.tradeManagement.expectedExpectancy,
            minExecutionScore: s.tradeManagement.minExecutionScore,
            maxDailyRiskPercent: s.tradeManagement.maxDailyRiskPercent,
            maxTradesPerDay: s.tradeManagement.maxTradesPerDay,
            partialTakeProfits: s.tradeManagement.partialTakeProfits.map((p) => ({
              id: p.id,
              trigger: p.trigger,
              percentToClose: p.percentToClose ? p.percentToClose.toNumber() : null,
              reason: p.reason,
            })),
            customRules: s.tradeManagement.customRules.map((r) => ({ id: r.id, text: r.text })),
          }
        : null,
    sessions: s.sessions.map((x) => ({
      id: x.id,
      name: x.name,
      color: x.color,
      startMinutes: x.startMinutes,
      endMinutes: x.endMinutes,
      enabled: x.enabled,
    })),
    confluences: checklist("CONFLUENCE"),
    execution: checklist("EXECUTION"),
    // mandatory/weight are the EFFECTIVE values (scenario override ?? the
    // checklist item's own), frozen so a later edit to either can never
    // retroactively change what a historical trade was validated against.
    // The raw overrides ride along so a restore rebuilds the exact config.
    setupTypes: s.setupTypes.map((st) => ({
      name: st.name,
      description: st.description,
      scenarios: st.scenarios.map((sc) => ({
        direction: sc.direction,
        name: sc.name,
        scenarioType: sc.scenarioType,
        customType: sc.customType,
        instruments: sc.instruments,
        timeframes: sc.timeframes,
        sortOrder: sc.sortOrder,
        context: readScenarioContext(sc.context),
        executionPlan: readExecutionPlan(sc.executionPlan),
        description: sc.description,
        conditions: sc.conditions
          // Integrity: only conditions that point at one of THIS strategy's live items.
          .filter((c) => liveItemIds.has(c.checklistItemId))
          .map((c) => ({
            checklistItemId: c.checklistItemId,
            name: c.checklistItem.name,
            kind: c.checklistItem.kind,
            directionApplicability: c.checklistItem.directionApplicability,
            mandatory: c.mandatoryOverride ?? c.checklistItem.mandatory,
            weight: c.weightOverride ?? c.checklistItem.weight,
            mandatoryOverride: c.mandatoryOverride,
            weightOverride: c.weightOverride,
            note: c.note,
            enabled: c.checklistItem.enabled,
            sortOrder: c.sortOrder,
          })),
      })),
    })),
  };
}

// When re-inserting a nullable Json column, a stored SQL NULL reads back as
// `null` but must be written as `Prisma.DbNull` (not the literal `null`).
export function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** `base` + `suffix`, with `base` trimmed so the whole name fits the limit. */
export function nameWithSuffix(base: string, suffix: string, max = MAX_STRATEGY_NAME): string {
  const room = Math.max(1, max - suffix.length);
  const trimmed = base.length > room ? `${base.slice(0, Math.max(1, room - 1)).trimEnd()}…` : base;
  return `${trimmed}${suffix}`.slice(0, max);
}

export interface MaterializeOptions {
  name: string;
  status?: "DRAFT" | "TESTING" | "LIVE" | "ARCHIVED";
  description?: string | null;
}

export interface MaterializeReport {
  strategy: { id: string; name: string };
  /** Setup-type conditions that could not be linked to a restored checklist
   *  item (only possible for legacy snapshots) — dropped, never left dangling. */
  droppedConditions: { setupType: string; scenario: string; condition: string }[];
}

/**
 * Rebuilds `snap` into a NEW strategy owned by `userId` inside the caller's
 * transaction. Every row gets a fresh id; every internal reference
 * (setup-type condition → checklist item, confluence pairId when it names a
 * confluence id) is remapped onto the new rows, so the result never points
 * back at the source strategy. Order comes from snapshot array position.
 */
export async function materializeSnapshot(
  tx: Tx,
  userId: string,
  snap: StrategyVersionSnapshot,
  opts: MaterializeOptions,
): Promise<MaterializeReport> {
  const last = await tx.strategy.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await tx.strategy.create({
    data: {
      userId,
      name: opts.name.slice(0, MAX_STRATEGY_NAME),
      description: opts.description !== undefined ? opts.description : snap.description,
      applicableAssets: snap.applicableAssets ?? [],
      status: opts.status ?? "DRAFT",
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  const strategyId = created.id;

  if (snap.arsenalConcepts?.length) {
    await tx.arsenalConcept.createMany({
      data: snap.arsenalConcepts.map((c, i) => ({
        strategyId,
        name: c.name,
        sortOrder: i,
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

  if (snap.frameworkSteps?.length) {
    await tx.strategyFrameworkStep.createMany({
      data: snap.frameworkSteps.map((s, i) => ({
        strategyId,
        title: s.title,
        sortOrder: i,
        description: toJsonInput(s.description),
        notes: toJsonInput(s.notes),
      })),
    });
  }

  for (const [i, tf] of (snap.timeframes ?? []).entries()) {
    const newTf = await tx.strategyTimeframe.create({
      data: { strategyId, name: tf.name, sortOrder: i },
    });
    if (tf.checkpoints?.length) {
      await tx.strategyCheckpoint.createMany({
        data: tf.checkpoints.map((cp, j) => ({
          timeframeId: newTf.id,
          title: cp.title,
          sortOrder: j,
          description: toJsonInput(cp.description),
          notes: toJsonInput(cp.notes),
        })),
      });
    }
  }

  if (snap.entryModels?.length) {
    await tx.strategyEntryModel.createMany({
      data: snap.entryModels.map((m, i) => ({
        strategyId,
        name: m.name,
        sortOrder: i,
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

  const tm = snap.tradeManagement;
  if (tm) {
    const newTm = await tx.strategyTradeManagement.create({
      data: {
        strategyId,
        takeProfitPhilosophy: toJsonInput(tm.takeProfitPhilosophy),
        initialStopPlacement: toJsonInput(tm.initialStopPlacement),
        breakEvenRules: toJsonInput(tm.breakEvenRules),
        trailingStopRules: toJsonInput(tm.trailingStopRules),
        scalingInRules: toJsonInput(tm.scalingInRules),
        scalingOutRules: toJsonInput(tm.scalingOutRules),
        maxHoldingTime: tm.maxHoldingTime ?? null,
        maxRiskPercent: tm.maxRiskPercent ?? null,
        expectedWinRate: tm.expectedWinRate ?? null,
        expectedAvgRr: tm.expectedAvgRr ?? null,
        expectedExpectancy: tm.expectedExpectancy ?? null,
        minExecutionScore: tm.minExecutionScore ?? null,
        maxDailyRiskPercent: tm.maxDailyRiskPercent ?? null,
        maxTradesPerDay: tm.maxTradesPerDay ?? null,
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

  if (snap.sessions?.length) {
    await tx.strategySession.createMany({
      data: snap.sessions.map((x, i) => ({
        userId,
        strategyId,
        name: x.name,
        color: x.color,
        startMinutes: x.startMinutes,
        endMinutes: x.endMinutes,
        enabled: x.enabled,
        sortOrder: i,
      })),
    });
  }

  // Checklist items one by one so each new id is known for remapping.
  const sourceConfluenceIds = new Set(
    (snap.confluences ?? []).map((c) => c.id).filter((id): id is string => Boolean(id)),
  );
  const idMap = new Map<string, string>(); // old checklist item id → new id
  type NewItem = { id: string; name: string; kind: "CONFLUENCE" | "EXECUTION"; mandatory: boolean; weight: number | null };
  const newItems: NewItem[] = [];
  const pendingPairs: { newId: string; oldPairId: string }[] = [];

  for (const [kind, items] of [
    ["CONFLUENCE", snap.confluences ?? []],
    ["EXECUTION", snap.execution ?? []],
  ] as const) {
    for (const [i, c] of items.entries()) {
      const isConfluence = kind === "CONFLUENCE";
      const row = await tx.strategyChecklistItem.create({
        data: {
          userId,
          strategyId,
          kind,
          name: c.name,
          color: c.color,
          icon: c.icon ?? null,
          category: c.category,
          description: c.description,
          weight: c.weight,
          mandatory: c.mandatory,
          // Pre-direction snapshots have no applicability → BOTH.
          directionApplicability: isConfluence ? c.directionApplicability ?? "BOTH" : "BOTH",
          pairId: isConfluence ? c.pairId ?? null : null,
          validationCriteria: c.validationCriteria,
          enabled: c.enabled,
          sortOrder: i,
        },
      });
      if (c.id) idMap.set(c.id, row.id);
      newItems.push({ id: row.id, name: c.name, kind, mandatory: c.mandatory, weight: c.weight });
      // pairId is normally a free-form group token shared by both halves of a
      // pair; if it instead names a confluence id, point it at the new copy.
      if (isConfluence && c.pairId && sourceConfluenceIds.has(c.pairId)) {
        pendingPairs.push({ newId: row.id, oldPairId: c.pairId });
      }
    }
  }
  for (const p of pendingPairs) {
    await tx.strategyChecklistItem.update({
      where: { id: p.newId },
      data: { pairId: idMap.get(p.oldPairId) ?? null },
    });
  }

  const report: MaterializeReport = { strategy: { id: created.id, name: created.name }, droppedConditions: [] };

  const resolveItem = (cond: { checklistItemId: string; name: string; kind?: "CONFLUENCE" | "EXECUTION" }) => {
    const mapped = idMap.get(cond.checklistItemId);
    if (mapped) return newItems.find((n) => n.id === mapped) ?? null;
    // Legacy snapshots: execution items had no id. Fall back to a unique
    // name (+ kind when known) match among the items just restored.
    const candidates = newItems.filter((n) => n.name === cond.name && (!cond.kind || n.kind === cond.kind));
    return candidates.length === 1 ? candidates[0] : null;
  };

  const usedNames = new Set<string>();
  for (const [i, st] of (snap.setupTypes ?? []).entries()) {
    // Live names are unique per strategy; stay defensive for odd snapshots.
    let name = st.name;
    for (let n = 2; usedNames.has(name.trim().toLowerCase()); n++) name = `${st.name} (${n})`;
    usedNames.add(name.trim().toLowerCase());

    const setupType = await tx.strategySetupType.create({
      data: { userId, strategyId, name, description: st.description, sortOrder: i },
    });
    for (const [j, sc] of st.scenarios.entries()) {
      const scenario = await tx.strategySetupScenario.create({
        data: {
          setupTypeId: setupType.id,
          direction: sc.direction,
          name: sc.name ?? "",
          scenarioType: sc.scenarioType ?? null,
          customType: sc.customType ?? null,
          instruments: sc.instruments ?? [],
          timeframes: sc.timeframes ?? [],
          context: toJsonInput(sc.context ?? null),
          executionPlan: toJsonInput(sc.executionPlan ?? null),
          description: sc.description,
          sortOrder: sc.sortOrder ?? j,
        },
      });
      const seen = new Set<string>();
      const rows: Prisma.StrategySetupScenarioConditionCreateManyInput[] = [];
      for (const cond of sc.conditions ?? []) {
        const item = resolveItem(cond);
        if (!item || seen.has(item.id)) {
          if (!item) {
            report.droppedConditions.push({
              setupType: st.name,
              scenario: sc.name || sc.direction,
              condition: cond.name,
            });
          }
          continue;
        }
        seen.add(item.id);
        // Full-fidelity snapshots carry the raw overrides. Legacy ones only
        // have EFFECTIVE values: keep an override only where it differed
        // from the restored item's own value.
        const hasRaw = cond.mandatoryOverride !== undefined || cond.weightOverride !== undefined;
        rows.push({
          scenarioId: scenario.id,
          checklistItemId: item.id,
          mandatoryOverride: hasRaw
            ? cond.mandatoryOverride ?? null
            : cond.mandatory !== item.mandatory
              ? cond.mandatory
              : null,
          weightOverride: hasRaw
            ? cond.weightOverride ?? null
            : cond.weight !== item.weight
              ? cond.weight
              : null,
          note: cond.note ?? null,
          sortOrder: cond.sortOrder,
        });
      }
      if (rows.length) await tx.strategySetupScenarioCondition.createMany({ data: rows });
    }
  }

  return report;
}

/** Interactive-transaction options for whole-tree writes (many small inserts). */
export const TREE_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;
