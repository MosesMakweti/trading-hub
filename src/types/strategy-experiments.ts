import type { StrategyVersionDiff } from "@/types/strategies";

export type ExperimentMode = "REFINEMENT" | "BUILD";
export type ExperimentStatus = "ACTIVE" | "SAVED_AS_VERSION" | "PROMOTED" | "DISCARDED";

/** One test session (SimAccount) run against an experiment or its baseline. */
export interface ExperimentSessionDTO {
  accountId: string;
  name: string;
  status: string;
  assets: string[];
  periodStart: string; // yyyy-mm-dd
  periodEnd: string;
  strategyVersion: number | null;
  createdAt: string;
}

export interface StrategyExperimentDTO {
  id: string;
  name: string;
  /** "Experiment 3" — per-baseline sequence. */
  label: string;
  mode: ExperimentMode;
  status: ExperimentStatus;
  baseline: { id: string; name: string; versionAtFork: number | null } | null;
  workingStrategyId: string;
  hypothesis: string | null;
  expectedEffect: string | null;
  actualOutcome: string | null;
  notes: string | null;
  resultVersion: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  sessionCount: number;
}

export interface StrategyExperimentDetailDTO extends StrategyExperimentDTO {
  /** Experiment configuration vs the baseline AS FORKED (null in BUILD mode / closed). */
  changesFromBaseline: StrategyVersionDiff | null;
  /** The baseline edited since the fork? (affects saving back as a version). */
  baselineChangedSinceFork: boolean;
  sessions: ExperimentSessionDTO[];
}
