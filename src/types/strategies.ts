import type { StrategyStatusValue } from "@/lib/validation/strategies";

/** Serializable strategy shape passed from server components to client components. */
export interface StrategyDTO {
  id: string;
  name: string;
  description: string | null;
  applicableAssets: string[];
  status: StrategyStatusValue;
  version: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Section 1 — Arsenal. Rich-text fields are Tiptap JSON documents (or null). */
export interface ArsenalConceptDTO {
  id: string;
  name: string;
  definition: unknown;
  purpose: unknown;
  howIIdentify: unknown;
  whyItMatters: unknown;
  whenIUse: unknown;
  whenIIgnore: unknown;
  examples: unknown;
  personalNotes: unknown;
}

/** Section 2 — Framework. An ordered decision step; description/notes are Tiptap JSON. */
export interface FrameworkStepDTO {
  id: string;
  title: string;
  description: unknown;
  notes: unknown;
}

/** Section 3 — Timeframe workspace. A checkpoint within a timeframe. */
export interface CheckpointDTO {
  id: string;
  title: string;
  description: unknown;
  notes: unknown;
}

export interface TimeframeDTO {
  id: string;
  name: string;
  checkpoints: CheckpointDTO[];
}

/** Section 4 — Entry Models. Rich-text fields are Tiptap JSON documents (or null). */
export interface EntryModelDTO {
  id: string;
  name: string;
  description: unknown;
  conditions: unknown;
  confirmationChecklist: unknown;
  invalidation: unknown;
  stopPlacement: unknown;
  targetLogic: unknown;
  notes: unknown;
}

/** Section 5 — Trade Management. A 1:1 record plus two child lists. */
export interface PartialTakeProfitDTO {
  id: string;
  trigger: string | null;
  percentToClose: number | null;
  reason: string | null;
}

export interface CustomRuleDTO {
  id: string;
  text: string;
}

export interface TradeManagementDTO {
  id: string;
  takeProfitPhilosophy: unknown;
  initialStopPlacement: unknown;
  breakEvenRules: unknown;
  trailingStopRules: unknown;
  scalingInRules: unknown;
  scalingOutRules: unknown;
  maxHoldingTime: string | null;
  maxRiskPercent: number | null;
  partialTakeProfits: PartialTakeProfitDTO[];
  customRules: CustomRuleDTO[];
}

// A lightweight, read-only view of a strategy surfaced inside the Journal when a
// trade references it (Phase 7). Deliberately excludes Arsenal — the Journal
// references a strategy's process, it never copies its knowledge base.
export interface StrategyReferenceDTO {
  id: string;
  name: string;
  version: number;
  applicableAssets: string[];
  entryModels: string[]; // names, in order
  frameworkSteps: string[]; // step titles, in order
  tradeManagement: {
    maxRiskPercent: number | null;
    maxHoldingTime: string | null;
    customRules: string[];
    partialTakeProfits: { trigger: string | null; percentToClose: number | null }[];
  } | null;
}

// ── Strategy version history (Future integration) ────────────────────────────
// A published, immutable snapshot of the full strategy tree at a point in time.
// Stored as JSON on StrategyVersion.snapshot; reuses the section DTOs so it is a
// faithful record (viewable/restorable later), not just names.
export interface StrategyVersionSnapshot {
  name: string;
  description: string | null;
  applicableAssets: string[];
  status: StrategyStatusValue;
  arsenalConcepts: ArsenalConceptDTO[];
  frameworkSteps: FrameworkStepDTO[];
  timeframes: TimeframeDTO[];
  entryModels: EntryModelDTO[];
  tradeManagement: TradeManagementDTO | null;
}

// Compact, at-a-glance description of a snapshot (what the history list shows).
export interface StrategyVersionSummary {
  applicableAssets: string[];
  arsenalCount: number;
  frameworkStepTitles: string[];
  timeframeCount: number;
  checkpointCount: number;
  entryModelNames: string[];
  customRuleCount: number;
  partialTpCount: number;
}

export interface StrategyVersionDTO {
  id: string;
  version: number;
  note: string | null;
  createdAt: string; // ISO
  summary: StrategyVersionSummary;
}

// ── Pattern Library (Future integration) ─────────────────────────────────────
// A cross-strategy catalog entry: one entry model surfaced alongside the strategy
// it belongs to, so a trader can browse/search their whole library of setups.
export interface PatternDTO {
  id: string;
  name: string;
  strategyId: string;
  strategyName: string;
  strategyStatus: StrategyStatusValue;
  descriptionPreview: string;
  conditionsPreview: string;
}

// ── Strategy version comparison (diff) ───────────────────────────────────────
export interface ListDiff {
  added: string[];
  removed: string[];
}
export interface ScalarChange<T> {
  from: T;
  to: T;
}
export interface StrategyVersionDiff {
  nameChange: ScalarChange<string> | null;
  statusChange: ScalarChange<StrategyStatusValue> | null;
  descriptionChanged: boolean;
  applicableAssets: ListDiff;
  arsenalConcepts: ListDiff;
  frameworkSteps: ListDiff & { reordered: boolean };
  timeframes: ListDiff;
  entryModels: ListDiff;
  tradeManagement: {
    maxRiskPercent: ScalarChange<number | null> | null;
    maxHoldingTime: ScalarChange<string | null> | null;
    customRuleCountDelta: number;
    partialTpCountDelta: number;
  };
  hasChanges: boolean;
}
