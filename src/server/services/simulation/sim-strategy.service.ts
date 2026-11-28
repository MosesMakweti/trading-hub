import type { SimAccount } from "@prisma/client";

import { prisma } from "@/server/db";
import { createLabAccount, createSimAccount, type CreateLabAccountInput } from "@/server/services/simulation/sim-account.service";
import {
  createBuildExperiment,
  discardExperiment,
  forkExperiment,
} from "@/server/services/strategy-experiments.service";
import { StrategyLabError } from "@/server/services/strategy-errors";
import type { SimRules } from "@/domain/simulation/rules";

/**
 * The bridge between Strategy Lab and Backtesting sessions. Sessions never
 * get their own strategy model: they reference a Strategy Lab strategy (or an
 * experiment's working strategy) and freeze its snapshot at creation.
 */

export type SessionStrategyMode = "NONE" | "EXISTING" | "REFINE" | "EXPERIMENT" | "BUILD";

export interface CreateLabSessionInput extends Omit<CreateLabAccountInput, "experimentId"> {
  strategyMode?: SessionStrategyMode;
  experimentId?: string | null;
  newStrategyName?: string | null;
}

/**
 * Creates a Strategy Lab backtest session in one of the five strategy modes.
 * REFINE and BUILD create the experiment first; if the session itself then
 * can't be created (e.g. a dataset doesn't cover the period), that new
 * experiment is discarded again so nothing half-made is left behind.
 */
export async function createLabSession(userId: string, input: CreateLabSessionInput): Promise<{ account: SimAccount; experimentId: string | null }> {
  const mode: SessionStrategyMode = input.strategyMode ?? (input.experimentId ? "EXPERIMENT" : input.strategyId ? "EXISTING" : "NONE");
  const base = { ...input, strategyId: null as string | null, experimentId: null as string | null };
  let createdExperimentId: string | null = null;

  switch (mode) {
    case "NONE":
      break;
    case "EXISTING": {
      if (!input.strategyId) throw new StrategyLabError("Choose a strategy to test.", "INVALID");
      const s = await prisma.strategy.findFirst({ where: { id: input.strategyId, userId, isExperiment: false }, select: { id: true } });
      if (!s) throw new StrategyLabError("That strategy no longer exists.", "NOT_FOUND");
      base.strategyId = s.id;
      break;
    }
    case "REFINE": {
      if (!input.strategyId) throw new StrategyLabError("Choose the strategy to refine.", "INVALID");
      const e = await forkExperiment(userId, input.strategyId);
      createdExperimentId = e.id;
      base.experimentId = e.id;
      break;
    }
    case "EXPERIMENT":
      if (!input.experimentId) throw new StrategyLabError("Choose an experiment to test.", "INVALID");
      base.experimentId = input.experimentId;
      break;
    case "BUILD": {
      const e = await createBuildExperiment(userId, { name: input.newStrategyName?.trim() || `${input.name} strategy` });
      createdExperimentId = e.id;
      base.experimentId = e.id;
      break;
    }
  }

  try {
    const account = await createLabAccount(userId, base);
    return { account, experimentId: base.experimentId };
  } catch (error) {
    if (createdExperimentId) await discardExperiment(userId, createdExperimentId).catch(() => undefined);
    throw error;
  }
}

/**
 * Starts a NEW session under exactly the same historical conditions as
 * `accountId` (same instruments → datasets, period, balance, currency and
 * frozen rules), testing a different strategy configuration:
 *   { experimentId }  an ACTIVE experiment,
 *   { strategyId }    a Strategy Lab strategy (e.g. the baseline),
 *   { none: true }    no structured strategy.
 * This is how baseline-vs-experiment results stay comparable.
 */
export async function cloneSessionConditions(
  userId: string,
  accountId: string,
  target: { experimentId: string } | { strategyId: string } | { none: true },
  name?: string | null,
): Promise<SimAccount> {
  const source = await prisma.simAccount.findFirst({
    where: { id: accountId, userId },
    include: { pins: { select: { assetSymbol: true, datasetId: true } } },
  });
  if (!source) throw new StrategyLabError("Session not found.", "NOT_FOUND");
  if (source.product !== "STRATEGY_LAB") throw new StrategyLabError("Only Strategy Lab sessions can be re-run with another strategy.", "INVALID");

  let label = "no strategy";
  let strategyId: string | null = null;
  let experimentId: string | null = null;
  if ("experimentId" in target) {
    const e = await prisma.strategyExperiment.findFirst({ where: { id: target.experimentId, userId }, select: { id: true, name: true } });
    if (!e) throw new StrategyLabError("Experiment not found.", "NOT_FOUND");
    experimentId = e.id;
    label = e.name;
  } else if ("strategyId" in target) {
    const s = await prisma.strategy.findFirst({ where: { id: target.strategyId, userId, isExperiment: false }, select: { id: true, name: true } });
    if (!s) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");
    strategyId = s.id;
    label = s.name;
  }

  return createSimAccount(userId, {
    product: "STRATEGY_LAB",
    kind: source.kind,
    name: (name?.trim() || `${source.name} · ${label}`).slice(0, 120),
    description: source.description,
    strategyId,
    experimentId,
    datasets: source.pins.map((p) => ({ assetSymbol: p.assetSymbol, datasetId: p.datasetId })),
    periodStart: source.periodStart.toISOString().slice(0, 10),
    periodEnd: source.periodEnd.toISOString().slice(0, 10),
    startingBalance: Number(source.startingBalance.toString()),
    currency: source.currency,
    rules: source.rules as unknown as SimRules,
  });
}
