"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import * as experiments from "@/server/services/strategy-experiments.service";
import { cloneSessionConditions } from "@/server/services/simulation/sim-strategy.service";
import { loadStrategyWorkspace, type StrategyWorkspaceData } from "@/server/services/strategy-workspace.service";
import { StrategyLabError, toStrategyActionError } from "@/server/services/strategy-errors";
import { SimError } from "@/server/services/simulation/sim-account.service";
import type { StrategyVersionSnapshot } from "@/types/strategies";
import type { StrategyExperimentDetailDTO, StrategyExperimentDTO } from "@/types/strategy-experiments";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max).nullish();

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof SimError) return { success: false, error: error.message };
  return { success: false, error: toStrategyActionError(error, fallback) };
}
const invalid = (e: z.ZodError): Fail => ({ success: false, error: e.issues[0]?.message ?? "Invalid input." });

function revalidateLab(strategyId?: string | null) {
  revalidatePath("/backtesting/lab");
  revalidatePath("/strategy-lab");
  if (strategyId) revalidatePath(`/strategy-lab/${strategyId}`);
}

// ── Terminal context ─────────────────────────────────────────────────────────

export interface TerminalStrategyContext {
  accountId: string;
  /** What the session froze when it was created (read-only; drives attribution). */
  session: {
    strategyId: string | null;
    strategyName: string | null;
    strategyVersion: number | null;
    snapshot: StrategyVersionSnapshot | null;
    experimentId: string | null;
  };
  /** The experiment this session tests, if any (any status). */
  experiment: StrategyExperimentDetailDTO | null;
  /** The Strategy Lab strategy experiments here are compared against. */
  baseline: { id: string; name: string } | null;
  /** Other ACTIVE experiments of that baseline (to switch between variations). */
  variations: StrategyExperimentDTO[];
}

/** Everything the embedded Strategy Builder needs for one session. */
export async function getTerminalStrategyContextAction(input: unknown): Promise<Ok<{ context: TerminalStrategyContext }> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ accountId: id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const account = await prisma.simAccount.findFirst({
      where: { id: parsed.data.accountId, userId: user.id },
      select: { id: true, strategyId: true, strategyNameSnapshot: true, strategyVersionSnapshot: true, strategySnapshot: true, experimentId: true },
    });
    if (!account) throw new StrategyLabError("Session not found.", "NOT_FOUND");

    const experiment = account.experimentId ? await experiments.getExperiment(user.id, account.experimentId) : null;
    // Baseline: the experiment's baseline, else the session's own (non-experiment) strategy.
    let baseline: TerminalStrategyContext["baseline"] = experiment?.baseline ? { id: experiment.baseline.id, name: experiment.baseline.name } : null;
    if (!experiment && account.strategyId) {
      const s = await prisma.strategy.findFirst({
        where: { id: account.strategyId, userId: user.id, deletedAt: null, isExperiment: false },
        select: { id: true, name: true },
      });
      baseline = s;
    }
    const variations = baseline ? await experiments.listExperiments(user.id, { baselineStrategyId: baseline.id, status: ["ACTIVE"] }) : [];

    return {
      success: true,
      context: {
        accountId: account.id,
        session: {
          strategyId: account.strategyId,
          strategyName: account.strategyNameSnapshot,
          strategyVersion: account.strategyVersionSnapshot,
          snapshot: account.strategySnapshot as unknown as StrategyVersionSnapshot | null,
          experimentId: account.experimentId,
        },
        experiment,
        baseline,
        variations,
      },
    };
  } catch (error) {
    return fail(error, "Couldn't load the strategy.");
  }
}

/** The editable workspace of a strategy (or an experiment's working strategy). */
export async function loadStrategyWorkspaceAction(input: unknown): Promise<Ok<{ data: StrategyWorkspaceData }> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ strategyId: id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = await loadStrategyWorkspace(user.id, parsed.data.strategyId);
  if (!data) return { success: false, error: "That strategy is no longer available." };
  return { success: true, data };
}

export async function getExperimentAction(input: unknown): Promise<Ok<{ experiment: StrategyExperimentDetailDTO }> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ experimentId: id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, experiment: await experiments.getExperiment(user.id, parsed.data.experimentId) };
  } catch (error) {
    return fail(error, "Couldn't load the experiment.");
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function forkExperimentAction(input: unknown): Promise<Ok<{ experiment: StrategyExperimentDTO }> | Fail> {
  const user = await requireUser();
  const parsed = z
    .object({ strategyId: id, fromExperimentId: id.nullish(), name: text(120), hypothesis: text(4000) })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const experiment = await experiments.forkExperiment(user.id, parsed.data.strategyId, parsed.data);
    revalidateLab();
    return { success: true, experiment };
  } catch (error) {
    return fail(error, "Couldn't start the experiment.");
  }
}

export async function createBuildExperimentAction(input: unknown): Promise<Ok<{ experiment: StrategyExperimentDTO }> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ name: z.string().trim().min(1, "Give the new strategy a name.").max(120), hypothesis: text(4000) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const experiment = await experiments.createBuildExperiment(user.id, parsed.data);
    revalidateLab();
    return { success: true, experiment };
  } catch (error) {
    return fail(error, "Couldn't start the new strategy.");
  }
}

export async function updateExperimentLogAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = z
    .object({
      experimentId: id,
      name: z.string().max(120).optional(),
      hypothesis: text(4000),
      expectedEffect: text(4000),
      actualOutcome: text(4000),
      notes: text(4000),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const { experimentId, ...log } = parsed.data;
    await experiments.updateExperimentLog(user.id, experimentId, log);
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't save the log.");
  }
}

export async function discardExperimentAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ experimentId: id }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await experiments.discardExperiment(user.id, parsed.data.experimentId);
    revalidateLab();
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't discard the experiment.");
  }
}

export async function promoteExperimentAction(input: unknown): Promise<Ok<{ strategyId: string; name: string }> | Fail> {
  const user = await requireUser();
  const parsed = z.object({ experimentId: id, name: text(120) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const r = await experiments.promoteExperiment(user.id, parsed.data.experimentId, parsed.data);
    revalidateLab(r.strategyId);
    return { success: true, ...r };
  } catch (error) {
    return fail(error, "Couldn't create the strategy.");
  }
}

export async function saveExperimentAsVersionAction(
  input: unknown,
): Promise<Ok<experiments.SaveAsVersionResult> | (Fail & { conflict?: boolean })> {
  const user = await requireUser();
  const parsed = z.object({ experimentId: id, note: text(500), acceptBaselineChanges: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const r = await experiments.saveExperimentAsVersion(user.id, parsed.data.experimentId, parsed.data);
    revalidateLab(r.baselineStrategyId);
    return { success: true, ...r };
  } catch (error) {
    const conflict = error instanceof StrategyLabError && error.code === "CONFLICT";
    return { ...fail(error, "Couldn't save the version."), conflict };
  }
}

/** A new session on identical historical conditions, testing another configuration. */
export async function cloneSessionAction(input: unknown): Promise<Ok<{ accountId: string }> | Fail> {
  const user = await requireUser();
  const parsed = z
    .object({
      accountId: id,
      target: z.union([z.object({ experimentId: id }), z.object({ strategyId: id }), z.object({ none: z.literal(true) })]),
      name: text(120),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const account = await cloneSessionConditions(user.id, parsed.data.accountId, parsed.data.target, parsed.data.name);
    revalidatePath("/backtesting/lab");
    return { success: true, accountId: account.id };
  } catch (error) {
    return fail(error, "Couldn't start the session.");
  }
}
