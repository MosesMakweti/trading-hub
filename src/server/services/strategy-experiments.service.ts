import { Prisma, type StrategyExperiment } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { diffStrategyVersions } from "@/domain/strategies/version-diff";
import { publishStrategyVersionInTx } from "@/server/services/strategies.service";
import { StrategyLabError } from "@/server/services/strategy-errors";
import {
  buildSnapshot,
  loadStrategyTree,
  materializeSnapshot,
  nameWithSuffix,
  TREE_TX_OPTIONS,
  writeSnapshotInto,
} from "@/server/services/strategy-tree";
import type { StrategyVersionSnapshot } from "@/types/strategies";
import type {
  ExperimentSessionDTO,
  StrategyExperimentDetailDTO,
  StrategyExperimentDTO,
} from "@/types/strategy-experiments";

/**
 * Strategy development experiments (Backtesting terminal).
 *
 * An experiment's configuration is a real, hidden Strategy row (the "working
 * strategy", `isExperiment = true`) created from the baseline through the
 * same snapshot → materialize path as duplicate/restore. Every Strategy Lab
 * editor, validator and scoring rule therefore applies to it unchanged — there
 * is no second strategy model. The baseline is NEVER modified by editing an
 * experiment; only `saveExperimentAsVersion` writes back, explicitly, and it
 * always publishes (immutable versions) rather than silently overwriting.
 *
 * Every function is scoped by `userId`; a DB trigger additionally refuses an
 * experiment whose strategies belong to another user.
 */

const experimentInclude = {
  baselineStrategy: { select: { id: true, name: true, deletedAt: true } },
  _count: { select: { sessions: true } },
} satisfies Prisma.StrategyExperimentInclude;
type ExperimentRow = Prisma.StrategyExperimentGetPayload<{ include: typeof experimentInclude }>;

function toDTO(e: ExperimentRow): StrategyExperimentDTO {
  return {
    id: e.id,
    name: e.name,
    label: e.mode === "BUILD" ? "New strategy draft" : `Experiment ${e.sequence}`,
    mode: e.mode,
    status: e.status,
    baseline:
      e.baselineStrategy && !e.baselineStrategy.deletedAt
        ? { id: e.baselineStrategy.id, name: e.baselineStrategy.name, versionAtFork: e.baselineVersion }
        : null,
    workingStrategyId: e.workingStrategyId,
    hypothesis: e.hypothesis,
    expectedEffect: e.expectedEffect,
    actualOutcome: e.actualOutcome,
    notes: e.notes,
    resultVersion: e.resultVersion,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    closedAt: e.closedAt?.toISOString() ?? null,
    sessionCount: e._count.sessions,
  };
}

async function requireExperiment(db: TransactionClient, userId: string, id: string) {
  const e = await db.strategyExperiment.findFirst({ where: { id, userId }, include: experimentInclude });
  if (!e) throw new StrategyLabError("Experiment not found.", "NOT_FOUND");
  return e;
}

function assertActive(e: Pick<StrategyExperiment, "status">) {
  if (e.status !== "ACTIVE") {
    throw new StrategyLabError("This experiment is closed — it was already saved, promoted or discarded.", "CONFLICT");
  }
}

/** Serialize experiment numbering per baseline (and per user for BUILD drafts). */
async function lockSequence(tx: TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`strategy-experiment:${key}`}))`;
}

/**
 * Refinement mode: forks `baselineStrategyId` (or, to branch, another ACTIVE
 * experiment's current configuration) into a new isolated experiment.
 */
export async function forkExperiment(
  userId: string,
  baselineStrategyId: string,
  input: { name?: string | null; hypothesis?: string | null; fromExperimentId?: string | null } = {},
): Promise<StrategyExperimentDTO> {
  const id = await prisma.$transaction(async (tx) => {
    const baseline = await loadStrategyTree(tx, userId, baselineStrategyId);
    if (!baseline || baseline.isExperiment) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");
    const baselineSnapshot = buildSnapshot(baseline);

    // Branching from an existing experiment starts from ITS configuration but
    // keeps the same baseline as the reference for comparisons.
    let startFrom: StrategyVersionSnapshot = baselineSnapshot;
    if (input.fromExperimentId) {
      const source = await requireExperiment(tx, userId, input.fromExperimentId);
      if (source.baselineStrategyId !== baselineStrategyId) {
        throw new StrategyLabError("That experiment belongs to a different strategy.", "INVALID");
      }
      const tree = await loadStrategyTree(tx, userId, source.workingStrategyId);
      if (!tree) throw new StrategyLabError("That experiment's configuration is no longer available.", "NOT_FOUND");
      startFrom = buildSnapshot(tree);
    }

    await lockSequence(tx, baselineStrategyId);
    const last = await tx.strategyExperiment.findFirst({
      where: { baselineStrategyId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const sequence = (last?.sequence ?? 0) + 1;
    const name = input.name?.trim() || `${baseline.name} · Experiment ${sequence}`;

    const working = await materializeSnapshot(tx, userId, startFrom, {
      name: nameWithSuffix(baseline.name, ` · Experiment ${sequence}`),
      status: "TESTING",
      isExperiment: true,
    });
    const created = await tx.strategyExperiment.create({
      data: {
        userId,
        name: name.slice(0, 120),
        mode: "REFINEMENT",
        sequence,
        baselineStrategyId,
        baselineVersion: baseline.version,
        baselineSnapshot: baselineSnapshot as unknown as Prisma.InputJsonValue,
        workingStrategyId: working.strategy.id,
        hypothesis: input.hypothesis?.trim() || null,
      },
    });
    return created.id;
  }, TREE_TX_OPTIONS);
  return toDTO(await requireExperiment(prisma, userId, id));
}

/** Strategy building mode: a blank strategy developed inside the terminal. */
export async function createBuildExperiment(
  userId: string,
  input: { name: string; hypothesis?: string | null },
): Promise<StrategyExperimentDTO> {
  const name = input.name.trim();
  if (!name) throw new StrategyLabError("Give the new strategy a name.", "INVALID");
  const id = await prisma.$transaction(async (tx) => {
    const blank: StrategyVersionSnapshot = {
      name,
      description: null,
      applicableAssets: [],
      status: "DRAFT",
      arsenalConcepts: [],
      frameworkSteps: [],
      timeframes: [],
      entryModels: [],
      tradeManagement: null,
    };
    const working = await materializeSnapshot(tx, userId, blank, { name, status: "DRAFT", isExperiment: true });
    const created = await tx.strategyExperiment.create({
      data: {
        userId,
        name: name.slice(0, 120),
        mode: "BUILD",
        workingStrategyId: working.strategy.id,
        hypothesis: input.hypothesis?.trim() || null,
      },
    });
    return created.id;
  });
  return toDTO(await requireExperiment(prisma, userId, id));
}

export async function listExperiments(
  userId: string,
  filter: { baselineStrategyId?: string; status?: StrategyExperiment["status"][] } = {},
): Promise<StrategyExperimentDTO[]> {
  const rows = await prisma.strategyExperiment.findMany({
    where: {
      userId,
      ...(filter.baselineStrategyId ? { baselineStrategyId: filter.baselineStrategyId } : {}),
      ...(filter.status ? { status: { in: filter.status } } : {}),
    },
    include: experimentInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toDTO);
}

/** The experiment's CURRENT configuration (null once closed and archived). */
export async function experimentSnapshot(userId: string, id: string): Promise<StrategyVersionSnapshot | null> {
  const e = await requireExperiment(prisma, userId, id);
  const tree = await loadStrategyTree(prisma, userId, e.workingStrategyId);
  return tree ? buildSnapshot(tree) : null;
}

export async function getExperiment(userId: string, id: string): Promise<StrategyExperimentDetailDTO> {
  const e = await requireExperiment(prisma, userId, id);
  const [workingTree, baselineTree, sessions] = await Promise.all([
    loadStrategyTree(prisma, userId, e.workingStrategyId),
    e.baselineStrategyId ? loadStrategyTree(prisma, userId, e.baselineStrategyId) : null,
    prisma.simAccount.findMany({
      where: { userId, experimentId: e.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, assets: true, periodStart: true, periodEnd: true, strategyVersionSnapshot: true, createdAt: true },
    }),
  ]);
  const baselineAtFork = e.baselineSnapshot as unknown as StrategyVersionSnapshot | null;
  const working = workingTree ? buildSnapshot(workingTree) : null;

  // Status and the auto-generated name differ by design; don't count them.
  const comparable = (s: StrategyVersionSnapshot, ref: StrategyVersionSnapshot) => ({ ...s, name: ref.name, status: ref.status });
  const changesFromBaseline = baselineAtFork && working ? diffStrategyVersions(baselineAtFork, comparable(working, baselineAtFork)) : null;
  const baselineChangedSinceFork =
    baselineAtFork && baselineTree
      ? diffStrategyVersions(baselineAtFork, comparable(buildSnapshot(baselineTree), baselineAtFork)).hasChanges
      : false;

  return {
    ...toDTO(e),
    changesFromBaseline,
    baselineChangedSinceFork,
    sessions: sessions.map(
      (a): ExperimentSessionDTO => ({
        accountId: a.id,
        name: a.name,
        status: a.status,
        assets: a.assets,
        periodStart: a.periodStart.toISOString().slice(0, 10),
        periodEnd: a.periodEnd.toISOString().slice(0, 10),
        strategyVersion: a.strategyVersionSnapshot,
        createdAt: a.createdAt.toISOString(),
      }),
    ),
  };
}

const logField = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim().slice(0, 4000) : null);

/** Experiment log — editable in any status (outcomes are often written later). */
export async function updateExperimentLog(
  userId: string,
  id: string,
  input: { name?: string; hypothesis?: string | null; expectedEffect?: string | null; actualOutcome?: string | null; notes?: string | null },
) {
  await requireExperiment(prisma, userId, id);
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new StrategyLabError("The experiment needs a name.", "INVALID");
  await prisma.strategyExperiment.updateMany({
    where: { id, userId },
    data: {
      ...(name ? { name: name.slice(0, 120) } : {}),
      hypothesis: logField(input.hypothesis),
      expectedEffect: logField(input.expectedEffect),
      actualOutcome: logField(input.actualOutcome),
      notes: logField(input.notes),
    },
  });
}

/** Discard: the working copy is archived; the baseline is untouched and past
 *  test sessions keep their frozen snapshots and results. */
export async function discardExperiment(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const e = await requireExperiment(tx, userId, id);
    assertActive(e);
    const now = new Date();
    await tx.strategy.updateMany({ where: { id: e.workingStrategyId, userId }, data: { deletedAt: now } });
    await tx.strategyExperiment.update({ where: { id }, data: { status: "DISCARDED", closedAt: now } });
  });
}

/** Create a new, standalone Strategy Lab strategy from the experiment. */
export async function promoteExperiment(userId: string, id: string, input: { name?: string | null } = {}) {
  return prisma.$transaction(async (tx) => {
    const e = await requireExperiment(tx, userId, id);
    assertActive(e);
    const working = await tx.strategy.findFirst({ where: { id: e.workingStrategyId, userId, deletedAt: null } });
    if (!working) throw new StrategyLabError("This experiment's configuration is no longer available.", "NOT_FOUND");
    const name = (input.name?.trim() || working.name).slice(0, 120);
    const last = await tx.strategy.findFirst({
      where: { userId, deletedAt: null, isExperiment: false },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await tx.strategy.update({
      where: { id: working.id },
      data: { isExperiment: false, name, status: "DRAFT", sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    await tx.strategyExperiment.update({ where: { id }, data: { status: "PROMOTED", closedAt: new Date() } });
    return { strategyId: working.id, name };
  }, TREE_TX_OPTIONS);
}

export interface SaveAsVersionResult {
  baselineStrategyId: string;
  /** The version holding the baseline's pre-experiment state (if it had unpublished changes). */
  preservedVersion: number | null;
  /** The new version published from the experiment. */
  publishedVersion: number;
}

/**
 * Applies the experiment's configuration to its baseline and publishes it as
 * a NEW version. Nothing is silently overwritten:
 *  - published versions are immutable and untouched;
 *  - if the baseline's current (unpublished) state isn't already a published
 *    version, it is published first, so it stays restorable;
 *  - if the baseline was edited after the fork, saving is refused unless the
 *    trader confirms (`acceptBaselineChanges`) — those edits are then kept in
 *    the preserved version, and the experiment's configuration wins.
 * Ids of confluences, sessions and setup types that already exist on the
 * baseline are preserved (writeSnapshotInto reconciles by name), so live
 * trades and plans referencing them stay linked.
 */
export async function saveExperimentAsVersion(
  userId: string,
  id: string,
  input: { note?: string | null; acceptBaselineChanges?: boolean } = {},
): Promise<SaveAsVersionResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const e = await requireExperiment(tx, userId, id);
      assertActive(e);
      if (e.mode !== "REFINEMENT" || !e.baselineStrategyId) {
        throw new StrategyLabError("This draft has no baseline strategy — create it as a new strategy instead.", "INVALID");
      }
      const baseline = await loadStrategyTree(tx, userId, e.baselineStrategyId);
      if (!baseline) throw new StrategyLabError("The baseline strategy no longer exists — create a new strategy instead.", "NOT_FOUND");
      const workingTree = await loadStrategyTree(tx, userId, e.workingStrategyId);
      if (!workingTree) throw new StrategyLabError("This experiment's configuration is no longer available.", "NOT_FOUND");

      const baselineNow = buildSnapshot(baseline);
      const baselineAtFork = e.baselineSnapshot as unknown as StrategyVersionSnapshot;
      const changedSinceFork = diffStrategyVersions(baselineAtFork, { ...baselineNow, name: baselineAtFork.name, status: baselineAtFork.status }).hasChanges;
      if (changedSinceFork && !input.acceptBaselineChanges) {
        throw new StrategyLabError(
          `${baseline.name} was edited after this experiment started. Review the differences, then confirm — its current state will be kept as a published version first.`,
          "CONFLICT",
        );
      }

      // Preserve the baseline's current state as a version unless the latest
      // published version already equals it.
      const latest = await tx.strategyVersion.findFirst({ where: { strategyId: baseline.id }, orderBy: { version: "desc" } });
      const latestSnap = latest?.snapshot as unknown as StrategyVersionSnapshot | undefined;
      let preservedVersion: number | null = null;
      if (!latestSnap || diffStrategyVersions(latestSnap, baselineNow).hasChanges) {
        const v = await publishStrategyVersionInTx(tx, userId, baseline.id, `Before applying "${e.name}"`);
        preservedVersion = v.version;
      }

      // Apply the experiment's configuration, keeping the baseline's identity.
      const experimentSnap = buildSnapshot(workingTree);
      await tx.strategy.update({
        where: { id: baseline.id },
        data: { description: experimentSnap.description, applicableAssets: experimentSnap.applicableAssets },
      });
      await writeSnapshotInto(tx, userId, baseline.id, { ...experimentSnap, name: baseline.name, status: baseline.status });

      const note = input.note?.trim() || `From ${e.name}${e.hypothesis ? ` — ${e.hypothesis}` : ""}`;
      const published = await publishStrategyVersionInTx(tx, userId, baseline.id, note);

      const now = new Date();
      await tx.strategy.updateMany({ where: { id: e.workingStrategyId, userId }, data: { deletedAt: now } });
      await tx.strategyExperiment.update({
        where: { id },
        data: { status: "SAVED_AS_VERSION", resultVersion: published.version, closedAt: now },
      });
      return { baselineStrategyId: baseline.id, preservedVersion, publishedVersion: published.version };
    }, TREE_TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw new StrategyLabError("The strategy changed at the same moment. Refresh and try again.", "CONFLICT");
    }
    throw error;
  }
}

/**
 * The strategy an editor id resolves to, for the terminal: the experiment's
 * working strategy when it is ACTIVE (editable), otherwise null.
 */
export async function activeExperimentForStrategy(userId: string, strategyId: string) {
  return prisma.strategyExperiment.findFirst({
    where: { userId, workingStrategyId: strategyId, status: "ACTIVE" },
    include: experimentInclude,
  });
}
