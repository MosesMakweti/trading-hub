import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { buildFullStrategy, checklistInput, comparableSnapshot } from "@/server/testing/strategy-fixture";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import * as strategies from "@/server/services/strategies.service";
import * as sot from "@/server/services/strategy-sot.service";
import * as st from "@/server/services/strategy-setup-types.service";
import * as tm from "@/server/services/strategy-trade-management.service";
import * as entryModels from "@/server/services/strategy-entry-models.service";
import * as experiments from "@/server/services/strategy-experiments.service";
import { cloneSessionConditions, createLabSession } from "@/server/services/simulation/sim-strategy.service";
import { loadStrategyWorkspace } from "@/server/services/strategy-workspace.service";

/**
 * Backtesting strategy development: isolated experiments built on the
 * Strategy Lab tree (Part L scenarios 1–4, 6–13, 16, 18–19).
 */

const userIds: string[] = [];
let datasetId = "";
let datasetUser = "";
beforeAll(async () => {
  const u = await createTestUser("experiments-data");
  userIds.push(u.id);
  datasetUser = u.id;
  const ds = await importHistoricalDataset(u.id, {
    bytes: new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 5 }).text),
    fileName: "EURUSD_M1_202405130000_202405172359.csv",
  });
  datasetId = ds.id;
});
afterAll(() => deleteTestUsers(...userIds));

const session = (over: Record<string, unknown> = {}) => ({
  name: "Session",
  datasets: [{ assetSymbol: "EURUSD", datasetId }],
  periodStart: "2024-05-13",
  periodEnd: "2024-05-17",
  startingBalance: 10000,
  currency: "USD",
  ...over,
});

async function snapshotOf(userId: string, strategyId: string) {
  return (await strategies.captureStrategySnapshot(userId, strategyId))!.snapshot;
}

describe("strategy selection when starting a session (Part D)", () => {
  it("EXISTING loads the full Strategy Lab strategy and freezes it on the session", async () => {
    const userId = datasetUser;
    const { strategyId } = await buildFullStrategy(userId, "Loaded");
    const { account, experimentId } = await createLabSession(userId, session({ strategyMode: "EXISTING", strategyId }));
    expect(experimentId).toBeNull();
    expect(account.strategyId).toBe(strategyId);
    const frozen = account.strategySnapshot as never;
    expect(comparableSnapshot(frozen)).toEqual(comparableSnapshot(await snapshotOf(userId, strategyId)));
  });

  it("NONE keeps discretionary backtesting without a strategy", async () => {
    const { account } = await createLabSession(datasetUser, session({ strategyMode: "NONE" }));
    expect(account.strategyId).toBeNull();
    expect(account.experimentId).toBeNull();
  });

  it("BUILD starts a blank strategy that is hidden from the library until saved", async () => {
    const userId = datasetUser;
    const { account, experimentId } = await createLabSession(userId, session({ strategyMode: "BUILD", newStrategyName: "Fresh idea" }));
    const exp = await experiments.getExperiment(userId, experimentId!);
    expect(exp.mode).toBe("BUILD");
    expect(account.strategyId).toBe(exp.workingStrategyId);
    expect((await strategies.listStrategies(userId)).map((s) => s.id)).not.toContain(exp.workingStrategyId);

    const promoted = await experiments.promoteExperiment(userId, exp.id, { name: "Fresh idea v1" });
    const library = await strategies.listStrategies(userId);
    expect(library.find((s) => s.id === promoted.strategyId)?.name).toBe("Fresh idea v1");
  });

  it("a failed session creation leaves no orphan experiment behind", async () => {
    const userId = datasetUser;
    const { strategyId } = await buildFullStrategy(userId, "Orphan check");
    const before = await prisma.strategyExperiment.count({ where: { userId, status: "ACTIVE" } });
    await expect(
      createLabSession(userId, session({ strategyMode: "REFINE", strategyId, periodStart: "2030-01-01", periodEnd: "2030-01-02" })),
    ).rejects.toThrow();
    expect(await prisma.strategyExperiment.count({ where: { userId, status: "ACTIVE" } })).toBe(before);
  });
});

describe("refinement experiments are isolated (Part F/G)", () => {
  it("edits to every section of an experiment never touch the baseline", async () => {
    const u = await createTestUser("exp-isolation");
    userIds.push(u.id);
    const userId = u.id;
    const { strategyId } = await buildFullStrategy(userId, "Baseline");
    const before = await snapshotOf(userId, strategyId);

    const exp = await experiments.forkExperiment(userId, strategyId, { hypothesis: "Losers lack displacement" });
    expect(exp.label).toBe("Experiment 1");
    const work = await loadStrategyWorkspace(userId, exp.workingStrategyId);
    expect(work).not.toBeNull();

    // Confluence added during a replay session.
    await sot.createChecklistItem(userId, exp.workingStrategyId, "CONFLUENCE", checklistInput({ name: "Displacement", weight: 30, mandatory: true }));
    // Entry model, session, execution, setup type + scenario, trade management.
    await entryModels.createEntryModel(userId, exp.workingStrategyId, "Breaker retest");
    await sot.createStrategySession(userId, exp.workingStrategyId, { name: "Asia", color: "GRAY", enabled: true });
    const exec = work!.execution[0];
    await sot.updateChecklistItem(userId, exec.id, checklistInput({ name: exec.name, mandatory: false, weight: 15 }));
    const type = work!.setupTypes[0];
    const bull = type.scenarios.find((s) => s.direction === "BULLISH")!;
    await st.updateScenarioDetails(userId, bull.id, { timeframes: ["M5"] });
    await st.createSetupType(userId, exp.workingStrategyId, { name: "Type B" });
    const rec = await tm.getOrCreateTradeManagement(userId, exp.workingStrategyId);
    await tm.updateTradeManagement(userId, rec.id, { maxTradesPerDay: 1, minExecutionScore: 85 });

    expect(comparableSnapshot(await snapshotOf(userId, strategyId))).toEqual(comparableSnapshot(before));

    const detail = await experiments.getExperiment(userId, exp.id);
    expect(detail.baselineChangedSinceFork).toBe(false);
    expect(detail.changesFromBaseline?.sections.map((s) => s.key).sort()).toEqual(
      ["confluences", "entryModels", "execution", "sessions", "setupTypes", "tradeManagement"].sort(),
    );

    // Multiple variations, numbered per baseline; a branch starts from another experiment.
    const b = await experiments.forkExperiment(userId, strategyId, { fromExperimentId: exp.id });
    expect(b.label).toBe("Experiment 2");
    const branched = await experiments.getExperiment(userId, b.id);
    expect(branched.changesFromBaseline?.hasChanges).toBe(true);
  });

  it("concurrent forks get distinct sequence numbers", async () => {
    const u = await createTestUser("exp-seq");
    userIds.push(u.id);
    const { strategyId } = await buildFullStrategy(u.id, "Seq");
    const all = await Promise.all([1, 2, 3].map(() => experiments.forkExperiment(u.id, strategyId)));
    expect(all.map((e) => e.label).sort()).toEqual(["Experiment 1", "Experiment 2", "Experiment 3"]);
  });
});

describe("saving experiments back (Part G4)", () => {
  it("save as new version: preserves the baseline's prior state, publishes the experiment, keeps referenced ids", async () => {
    const u = await createTestUser("exp-save");
    userIds.push(u.id);
    const userId = u.id;
    const { strategyId, items } = await buildFullStrategy(userId, "Baseline");
    await strategies.publishStrategyVersion(userId, strategyId, "v1");
    // Unpublished baseline edit BEFORE the fork → must be preserved as a version.
    await sot.createStrategySession(userId, strategyId, { name: "Unpublished", color: "GRAY", enabled: true });

    const exp = await experiments.forkExperiment(userId, strategyId);
    const work = (await loadStrategyWorkspace(userId, exp.workingStrategyId))!;
    const bullCopy = work.confluences.find((c) => c.name === "Bullish MSB")!;
    await sot.updateChecklistItem(userId, bullCopy.id, checklistInput({ name: "Bullish MSB", weight: 70, mandatory: true, directionApplicability: "BULLISH", pairId: "msb" }));
    await sot.createChecklistItem(userId, exp.workingStrategyId, "CONFLUENCE", checklistInput({ name: "Displacement", weight: 30 }));
    const liquidity = work.confluences.find((c) => c.name === "Liquidity sweep")!;
    await sot.deleteChecklistItem(userId, liquidity.id);
    const experimentSnap = await snapshotOf(userId, exp.workingStrategyId);

    const result = await experiments.saveExperimentAsVersion(userId, exp.id, { note: "Displacement" });
    expect(result).toEqual({ baselineStrategyId: strategyId, preservedVersion: 2, publishedVersion: 3 });

    // v1 untouched; v2 = baseline before applying; v3 = experiment.
    const v1 = (await strategies.getStrategyVersion(userId, strategyId, 1))!.snapshot;
    expect(v1.sessions?.map((x) => x.name)).not.toContain("Unpublished");
    const v2 = (await strategies.getStrategyVersion(userId, strategyId, 2))!.snapshot;
    expect(v2.sessions?.map((x) => x.name)).toContain("Unpublished");
    const v3 = (await strategies.getStrategyVersion(userId, strategyId, 3))!.snapshot;
    expect(comparableSnapshot(v3)).toEqual(comparableSnapshot(experimentSnap));

    // The baseline kept its identity: same strategy id, same name, and the
    // confluence ids that trades/plans reference are unchanged.
    const live = await sot.listStrategyChecklist(userId, strategyId, "CONFLUENCE");
    expect(live.find((c) => c.name === "Bullish MSB")?.id).toBe(items.bull.id);
    expect(live.find((c) => c.name === "Bullish MSB")?.weight).toBe(70);
    expect(live.map((c) => c.name)).not.toContain("Liquidity sweep");
    expect((await strategies.getStrategy(userId, strategyId))?.name).toBe("Baseline");

    // Setup-type conditions point only at the baseline's own live items.
    const conds = await prisma.strategySetupScenarioCondition.findMany({
      where: { scenario: { deletedAt: null, setupType: { strategyId, deletedAt: null } } },
      include: { checklistItem: true },
    });
    for (const c of conds) {
      expect(c.checklistItem.strategyId).toBe(strategyId);
      expect(c.checklistItem.deletedAt).toBeNull();
    }

    const closed = await experiments.getExperiment(userId, exp.id);
    expect(closed.status).toBe("SAVED_AS_VERSION");
    expect(closed.resultVersion).toBe(3);
    await expect(experiments.discardExperiment(userId, exp.id)).rejects.toThrow(/closed/);
  });

  it("refuses to save over baseline edits made after the fork unless confirmed", async () => {
    const u = await createTestUser("exp-conflict");
    userIds.push(u.id);
    const userId = u.id;
    const { strategyId } = await buildFullStrategy(userId, "Baseline");
    const exp = await experiments.forkExperiment(userId, strategyId);
    await sot.createStrategySession(userId, strategyId, { name: "Edited later", color: "GRAY", enabled: true });

    await expect(experiments.saveExperimentAsVersion(userId, exp.id)).rejects.toThrow(/edited after this experiment started/);
    const r = await experiments.saveExperimentAsVersion(userId, exp.id, { acceptBaselineChanges: true });
    const preserved = (await strategies.getStrategyVersion(userId, strategyId, r.preservedVersion!))!.snapshot;
    expect(preserved.sessions?.map((s) => s.name)).toContain("Edited later");
  });

  it("discard archives the working copy and leaves the baseline and past sessions intact", async () => {
    const userId = datasetUser;
    const { strategyId } = await buildFullStrategy(userId, "Discard me");
    const before = await snapshotOf(userId, strategyId);
    const { account, experimentId } = await createLabSession(userId, session({ strategyMode: "REFINE", strategyId }));
    await experiments.discardExperiment(userId, experimentId!);
    expect(comparableSnapshot(await snapshotOf(userId, strategyId))).toEqual(comparableSnapshot(before));
    const kept = await prisma.simAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(kept.strategySnapshot).not.toBeNull();
    await expect(createLabSession(userId, session({ strategyMode: "EXPERIMENT", experimentId }))).rejects.toThrow(/closed/);
  });
});

describe("historical results keep their original snapshots (Part L #19)", () => {
  it("editing the experiment after a session started never changes that session's frozen strategy", async () => {
    const userId = datasetUser;
    const { strategyId } = await buildFullStrategy(userId, "Frozen");
    const { account, experimentId } = await createLabSession(userId, session({ strategyMode: "REFINE", strategyId }));
    const frozen = JSON.stringify(account.strategySnapshot);
    const exp = await experiments.getExperiment(userId, experimentId!);
    await sot.createChecklistItem(userId, exp.workingStrategyId, "CONFLUENCE", checklistInput({ name: "Later edit" }));
    const reread = await prisma.simAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(JSON.stringify(reread.strategySnapshot)).toBe(frozen);

    // A same-conditions re-run picks up the edited configuration.
    const rerun = await cloneSessionConditions(userId, account.id, { experimentId: exp.id });
    expect(rerun.periodStart.toISOString()).toBe(account.periodStart.toISOString());
    expect(rerun.rules).toEqual(account.rules);
    expect(JSON.stringify(rerun.strategySnapshot)).toContain("Later edit");
  });
});

describe("ownership (Part J / L #18)", () => {
  it("another user can't fork, read, edit, save, or test someone else's experiment", async () => {
    const owner = await createTestUser("exp-owner");
    const intruder = await createTestUser("exp-intruder");
    userIds.push(owner.id, intruder.id);
    const { strategyId } = await buildFullStrategy(owner.id, "Private");
    const exp = await experiments.forkExperiment(owner.id, strategyId);

    await expect(experiments.forkExperiment(intruder.id, strategyId)).rejects.toThrow(/not found/i);
    await expect(experiments.getExperiment(intruder.id, exp.id)).rejects.toThrow(/not found/i);
    await expect(experiments.updateExperimentLog(intruder.id, exp.id, { notes: "x" })).rejects.toThrow(/not found/i);
    await expect(experiments.saveExperimentAsVersion(intruder.id, exp.id)).rejects.toThrow(/not found/i);
    await expect(experiments.promoteExperiment(intruder.id, exp.id)).rejects.toThrow(/not found/i);
    await expect(sot.createChecklistItem(intruder.id, exp.workingStrategyId, "CONFLUENCE", checklistInput({ name: "x" }))).rejects.toThrow(/not found/i);
    await expect(loadStrategyWorkspace(intruder.id, exp.workingStrategyId)).resolves.toBeNull();
    await expect(createLabSession(intruder.id, session({ strategyMode: "EXPERIMENT", experimentId: exp.id }))).rejects.toThrow();

    // DB trigger backstop: an experiment row can't point at another user's strategy.
    await expect(
      prisma.strategyExperiment.create({ data: { userId: intruder.id, name: "x", mode: "REFINEMENT", workingStrategyId: exp.workingStrategyId } }),
    ).rejects.toThrow(/STRATEGY_EXPERIMENT_OWNER/);
  });
});
