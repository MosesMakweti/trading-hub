import { prisma } from "@/server/db";
import {
  comparisonWarnings,
  conditionDifferences,
  groupResults,
  type ComparisonWarning,
  type ConditionDifference,
  type GroupResults,
  type SessionConditions,
  type TradeRow,
} from "@/domain/simulation/strategy-comparison";
import { positionNetR } from "@/server/services/simulation/sim-study.service";
import { StrategyLabError } from "@/server/services/strategy-errors";
import { getExperiment } from "@/server/services/strategy-experiments.service";
import type { StrategyExperimentDetailDTO } from "@/types/strategy-experiments";

export interface ComparedSession extends SessionConditions {
  status: string;
  strategyVersion: number | null;
  closedTrades: number;
}

export interface ExperimentComparisonDTO {
  experiment: StrategyExperimentDetailDTO;
  baseline: { sessions: ComparedSession[]; results: GroupResults } | null;
  variation: { sessions: ComparedSession[]; results: GroupResults };
  differences: ConditionDifference[];
  /** True when every session on both sides used identical conditions. */
  comparable: boolean;
  warnings: ComparisonWarning[];
  /** Not available from the data the platform records. */
  unsupported: string[];
}

async function loadGroup(userId: string, where: { experimentId: string } | { strategyId: string; experimentId: null }) {
  const accounts = await prisma.simAccount.findMany({
    where: { userId, product: "STRATEGY_LAB", ...where },
    orderBy: { createdAt: "asc" },
    include: { pins: { select: { assetSymbol: true, datasetId: true } } },
  });
  const ids = accounts.map((a) => a.id);
  const positions = ids.length
    ? await prisma.simPosition.findMany({
        where: { accountId: { in: ids }, status: "CLOSED" },
        orderBy: { closedMinute: "asc" },
      })
    : [];

  const rows: TradeRow[] = positions.map((p) => ({
    executed: true,
    r: positionNetR(p),
    outcome: "UNRESOLVED",
    minute: p.closedMinute ?? p.openedMinute,
    accountId: p.accountId,
    symbol: p.symbol,
    session: p.strategySessionName,
    setupType: p.setupTypeName,
    executionScore: p.executionScore,
    followedRules: p.followedRules,
  }));
  const sessions: ComparedSession[] = accounts.map((a) => ({
    accountId: a.id,
    name: a.name,
    status: a.status,
    strategyVersion: a.strategyVersionSnapshot,
    pins: Object.fromEntries(a.pins.map((p) => [p.assetSymbol, p.datasetId])),
    periodStart: a.periodStart.toISOString().slice(0, 10),
    periodEnd: a.periodEnd.toISOString().slice(0, 10),
    startingBalance: a.startingBalance.toString(),
    currency: a.currency,
    rules: a.rules,
    closedTrades: positions.filter((p) => p.accountId === a.id).length,
  }));
  return { sessions, results: groupResults(rows, sessions.length) };
}

/**
 * Baseline vs experiment results. Baseline sessions are the Strategy Lab
 * sessions that tested the baseline strategy itself (not an experiment);
 * experiment sessions are those linked to this experiment. Every number comes
 * from closed simulated positions (ledger-derived net R) — never recomputed
 * against the current strategy, so later edits can't change past results.
 */
export async function getExperimentComparison(userId: string, experimentId: string): Promise<ExperimentComparisonDTO> {
  const experiment = await getExperiment(userId, experimentId);
  const variation = await loadGroup(userId, { experimentId });
  const baselineId = experiment.baseline?.id ?? null;
  const baseline = baselineId ? await loadGroup(userId, { strategyId: baselineId, experimentId: null }) : null;

  const differences = baseline ? conditionDifferences(baseline.sessions, variation.sessions) : [];
  const variationsTested = baselineId
    ? await prisma.strategyExperiment.count({ where: { userId, baselineStrategyId: baselineId, sessions: { some: {} } } })
    : 1;
  const warnings = baseline
    ? comparisonWarnings({ baseline: baseline.results, experiment: variation.results, differences, variationsTested })
    : [];

  return {
    experiment,
    baseline,
    variation,
    differences,
    comparable: baseline != null && baseline.sessions.length > 0 && variation.sessions.length > 0 && differences.length === 0,
    warnings,
    unsupported: ["Performance by market condition (no market-regime data is recorded for simulated trades)."],
  };
}

/** Ownership-checked guard used by pages. */
export async function requireExperimentComparison(userId: string, experimentId: string) {
  try {
    return await getExperimentComparison(userId, experimentId);
  } catch (error) {
    if (error instanceof StrategyLabError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}
