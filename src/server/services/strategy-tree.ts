import { Prisma } from "@prisma/client";

import type { TransactionClient } from "@/server/db";
import { readExecutionPlan, readScenarioContext } from "@/domain/strategies/scenario-playbook";
import type { StrategyVersionConfluenceSnapshot, StrategyVersionSnapshot } from "@/types/strategies";

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
  /** Create the strategy as a hidden Backtesting experiment working copy. */
  isExperiment?: boolean;
}

export interface WriteReport {
  /** Setup-type conditions that could not be linked to a checklist item
   *  (only possible for legacy snapshots) — dropped, never left dangling. */
  droppedConditions: { setupType: string; scenario: string; condition: string }[];
}

export interface MaterializeReport extends WriteReport {
  strategy: { id: string; name: string };
}

/**
 * Rebuilds `snap` into a NEW strategy owned by `userId` inside the caller's
 * transaction. Every row gets a fresh id and every internal reference is
 * remapped onto the new rows (see writeSnapshotInto), so the result never
 * points back at the source strategy.
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
      isExperiment: opts.isExperiment ?? false,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  const report = await writeSnapshotInto(tx, userId, created.id, snap);
  return { strategy: { id: created.id, name: created.name }, ...report };
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** Pairs snapshot items with existing rows by a key (duplicates pair in order). */
function pairByKey<S, R>(snapItems: S[], rows: R[], keyS: (x: S) => string, keyR: (x: R) => string) {
  const pool = new Map<string, R[]>();
  for (const r of rows) {
    const k = keyR(r);
    pool.set(k, [...(pool.get(k) ?? []), r]);
  }
  const matched = snapItems.map((item) => {
    const list = pool.get(keyS(item));
    const row = list?.shift() ?? null;
    return { item, row };
  });
  const unmatched = [...pool.values()].flat();
  return { matched, unmatched };
}

/**
 * Makes strategy `strategyId`'s whole configuration equal to `snap`, inside
 * the caller's transaction.
 *
 * Rows that other records point at keep their ids: checklist items (matched
 * by kind + name), sessions (by name), setup types (by name) and their
 * scenarios (by direction + name) are UPDATED in place; snapshot items with
 * no match are created and rows the snapshot no longer has are archived
 * (soft-deleted — never hard-deleted, so historical trades keep their links).
 * Purely descriptive rows (arsenal, framework, timeframes, entry models,
 * partial TPs, custom rules) are archived and re-created in snapshot order.
 * Scenario conditions are rebuilt against the (kept or new) checklist ids.
 *
 * Writing into a brand-new, empty strategy therefore creates everything —
 * that is how duplicate / restore / experiment forks materialize — while
 * saving an experiment back onto its baseline preserves the baseline's ids.
 */
export async function writeSnapshotInto(
  tx: Tx,
  userId: string,
  strategyId: string,
  snap: StrategyVersionSnapshot,
): Promise<WriteReport> {
  const now = new Date();
  const report: WriteReport = { droppedConditions: [] };

  // ── Descriptive sections: archive + re-create ──────────────────────────────
  await tx.arsenalConcept.updateMany({ where: { strategyId, deletedAt: null }, data: { deletedAt: now } });
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

  await tx.strategyFrameworkStep.updateMany({ where: { strategyId, deletedAt: null }, data: { deletedAt: now } });
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

  await tx.strategyTimeframe.updateMany({ where: { strategyId, deletedAt: null }, data: { deletedAt: now } });
  for (const [i, tf] of (snap.timeframes ?? []).entries()) {
    const newTf = await tx.strategyTimeframe.create({ data: { strategyId, name: tf.name, sortOrder: i } });
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

  await tx.strategyEntryModel.updateMany({ where: { strategyId, deletedAt: null }, data: { deletedAt: now } });
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

  // ── Trade management: one record per strategy (unique), updated in place ──
  const tm = snap.tradeManagement;
  const existingTm = await tx.strategyTradeManagement.findUnique({ where: { strategyId }, select: { id: true } });
  if (tm || existingTm) {
    const fields = {
      takeProfitPhilosophy: toJsonInput(tm?.takeProfitPhilosophy ?? null),
      initialStopPlacement: toJsonInput(tm?.initialStopPlacement ?? null),
      breakEvenRules: toJsonInput(tm?.breakEvenRules ?? null),
      trailingStopRules: toJsonInput(tm?.trailingStopRules ?? null),
      scalingInRules: toJsonInput(tm?.scalingInRules ?? null),
      scalingOutRules: toJsonInput(tm?.scalingOutRules ?? null),
      maxHoldingTime: tm?.maxHoldingTime ?? null,
      maxRiskPercent: tm?.maxRiskPercent ?? null,
      expectedWinRate: tm?.expectedWinRate ?? null,
      expectedAvgRr: tm?.expectedAvgRr ?? null,
      expectedExpectancy: tm?.expectedExpectancy ?? null,
      minExecutionScore: tm?.minExecutionScore ?? null,
      maxDailyRiskPercent: tm?.maxDailyRiskPercent ?? null,
      maxTradesPerDay: tm?.maxTradesPerDay ?? null,
    };
    const record = existingTm
      ? await tx.strategyTradeManagement.update({ where: { id: existingTm.id }, data: { ...fields, deletedAt: null } })
      : await tx.strategyTradeManagement.create({ data: { strategyId, ...fields } });
    await tx.partialTakeProfit.updateMany({ where: { tradeManagementId: record.id, deletedAt: null }, data: { deletedAt: now } });
    await tx.tradeManagementRule.updateMany({ where: { tradeManagementId: record.id, deletedAt: null }, data: { deletedAt: now } });
    if (tm?.partialTakeProfits?.length) {
      await tx.partialTakeProfit.createMany({
        data: tm.partialTakeProfits.map((p, i) => ({
          tradeManagementId: record.id,
          trigger: p.trigger,
          percentToClose: p.percentToClose,
          reason: p.reason,
          sortOrder: i,
        })),
      });
    }
    if (tm?.customRules?.length) {
      await tx.tradeManagementRule.createMany({
        data: tm.customRules.map((r, i) => ({ tradeManagementId: record.id, text: r.text, sortOrder: i })),
      });
    }
  }

  // ── Sessions: reconcile by name ────────────────────────────────────────────
  const liveSessions = await tx.strategySession.findMany({ where: { strategyId, deletedAt: null }, orderBy: { sortOrder: "asc" } });
  const sessions = pairByKey(snap.sessions ?? [], liveSessions, (x) => nameKey(x.name), (r) => nameKey(r.name));
  for (const r of sessions.unmatched) {
    await tx.strategySession.update({ where: { id: r.id }, data: { deletedAt: now } });
  }
  for (const [i, { item, row }] of sessions.matched.entries()) {
    const data = {
      name: item.name,
      color: item.color,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      enabled: item.enabled,
      sortOrder: i,
    };
    if (row) await tx.strategySession.update({ where: { id: row.id }, data });
    else await tx.strategySession.create({ data: { userId, strategyId, ...data } });
  }

  // ── Checklist items: reconcile by kind + name, keeping ids ─────────────────
  const liveItems = await tx.strategyChecklistItem.findMany({ where: { strategyId, deletedAt: null }, orderBy: { sortOrder: "asc" } });
  type SnapItem = StrategyVersionConfluenceSnapshot & { kind: "CONFLUENCE" | "EXECUTION" };
  const snapItems: SnapItem[] = [
    ...(snap.confluences ?? []).map((c) => ({ ...c, kind: "CONFLUENCE" as const })),
    ...(snap.execution ?? []).map((c) => ({ ...c, kind: "EXECUTION" as const })),
  ];
  const items = pairByKey(snapItems, liveItems, (x) => `${x.kind}:${nameKey(x.name)}`, (r) => `${r.kind}:${nameKey(r.name)}`);
  for (const r of items.unmatched) {
    await tx.strategyChecklistItem.update({ where: { id: r.id }, data: { deletedAt: now } });
  }
  const sourceConfluenceIds = new Set((snap.confluences ?? []).map((c) => c.id).filter((id): id is string => Boolean(id)));
  const idMap = new Map<string, string>(); // snapshot item id → target item id
  type TargetItem = { id: string; name: string; kind: "CONFLUENCE" | "EXECUTION"; mandatory: boolean; weight: number | null };
  const targetItems: TargetItem[] = [];
  const pendingPairs: { targetId: string; snapPairId: string }[] = [];
  const sortByKind = { CONFLUENCE: 0, EXECUTION: 0 };
  for (const { item, row } of items.matched) {
    const isConfluence = item.kind === "CONFLUENCE";
    const data = {
      name: item.name,
      color: item.color,
      icon: item.icon ?? null,
      category: item.category,
      description: item.description,
      weight: item.weight,
      mandatory: item.mandatory,
      // Pre-direction snapshots have no applicability → BOTH.
      directionApplicability: isConfluence ? (item.directionApplicability ?? "BOTH") : ("BOTH" as const),
      pairId: isConfluence ? (item.pairId ?? null) : null,
      validationCriteria: item.validationCriteria,
      enabled: item.enabled,
      sortOrder: sortByKind[item.kind]++,
    };
    const target = row
      ? await tx.strategyChecklistItem.update({ where: { id: row.id }, data })
      : await tx.strategyChecklistItem.create({ data: { userId, strategyId, kind: item.kind, ...data } });
    if (item.id) idMap.set(item.id, target.id);
    targetItems.push({ id: target.id, name: item.name, kind: item.kind, mandatory: item.mandatory, weight: item.weight });
    // pairId is normally a free-form group token shared by both halves of a
    // pair; if it instead names a confluence id, point it at the target copy.
    if (isConfluence && item.pairId && sourceConfluenceIds.has(item.pairId)) {
      pendingPairs.push({ targetId: target.id, snapPairId: item.pairId });
    }
  }
  for (const p of pendingPairs) {
    await tx.strategyChecklistItem.update({ where: { id: p.targetId }, data: { pairId: idMap.get(p.snapPairId) ?? null } });
  }

  const resolveItem = (cond: { checklistItemId: string; name: string; kind?: "CONFLUENCE" | "EXECUTION" }) => {
    const mapped = idMap.get(cond.checklistItemId);
    if (mapped) return targetItems.find((n) => n.id === mapped) ?? null;
    // Legacy snapshots: execution items had no id. Fall back to a unique
    // name (+ kind when known) match among the target's items.
    const candidates = targetItems.filter((n) => n.name === cond.name && (!cond.kind || n.kind === cond.kind));
    return candidates.length === 1 ? candidates[0] : null;
  };

  // ── Setup types: reconcile by name; scenarios by direction + name ─────────
  const liveTypes = await tx.strategySetupType.findMany({
    where: { strategyId, deletedAt: null },
    include: { scenarios: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
  });
  // Snapshot names are unique among live types already; stay defensive.
  const seenNames = new Set<string>();
  const snapTypes = (snap.setupTypes ?? []).filter((t) => {
    const k = nameKey(t.name);
    if (seenNames.has(k)) return false;
    seenNames.add(k);
    return true;
  });
  const types = pairByKey(snapTypes, liveTypes, (x) => nameKey(x.name), (r) => nameKey(r.name));
  // Archive first: names are unique among LIVE setup types.
  for (const r of types.unmatched) {
    await tx.strategySetupType.update({ where: { id: r.id }, data: { deletedAt: now } });
  }
  for (const [i, { item: st, row }] of types.matched.entries()) {
    const setupType = row
      ? await tx.strategySetupType.update({ where: { id: row.id }, data: { name: st.name, description: st.description, sortOrder: i } })
      : await tx.strategySetupType.create({ data: { userId, strategyId, name: st.name, description: st.description, sortOrder: i } });

    const scen = pairByKey(
      st.scenarios,
      row?.scenarios ?? [],
      (x) => `${x.direction}:${nameKey(x.name ?? "")}`,
      (r) => `${r.direction}:${nameKey(r.name)}`,
    );
    for (const r of scen.unmatched) {
      await tx.strategySetupScenario.update({ where: { id: r.id }, data: { deletedAt: now } });
    }
    for (const [j, { item: sc, row: scRow }] of scen.matched.entries()) {
      const data = {
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
      };
      const scenario = scRow
        ? await tx.strategySetupScenario.update({ where: { id: scRow.id }, data })
        : await tx.strategySetupScenario.create({ data: { setupTypeId: setupType.id, ...data } });
      if (scRow) await tx.strategySetupScenarioCondition.deleteMany({ where: { scenarioId: scenario.id } });

      const seen = new Set<string>();
      const rows: Prisma.StrategySetupScenarioConditionCreateManyInput[] = [];
      for (const cond of sc.conditions ?? []) {
        const item = resolveItem(cond);
        if (!item) {
          report.droppedConditions.push({ setupType: st.name, scenario: sc.name || sc.direction, condition: cond.name });
          continue;
        }
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        // Full-fidelity snapshots carry the raw overrides. Legacy ones only
        // have EFFECTIVE values: keep an override only where it differed
        // from the target item's own value.
        const hasRaw = cond.mandatoryOverride !== undefined || cond.weightOverride !== undefined;
        rows.push({
          scenarioId: scenario.id,
          checklistItemId: item.id,
          mandatoryOverride: hasRaw ? (cond.mandatoryOverride ?? null) : cond.mandatory !== item.mandatory ? cond.mandatory : null,
          weightOverride: hasRaw ? (cond.weightOverride ?? null) : cond.weight !== item.weight ? cond.weight : null,
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
