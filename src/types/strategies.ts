import type { TagColor } from "@prisma/client";

import type { StrategyStatusValue } from "@/lib/validation/strategies";
import type { ConfluenceDirectionValue } from "@/lib/validation/strategy-sot";

/** A colored checklist tag (confluence / execution confirmation) as the trade form sees it. */
export interface StrategyChecklistRef {
  /** DB id — used as stable identity for direction-aware scoring / snapshots. */
  id?: string;
  name: string;
  color: TagColor;
  category: string | null;
  weight: number | null;
  mandatory: boolean;
  /** CONFLUENCE only — LONG (BULLISH) / SHORT (BEARISH) / BOTH. Absent = BOTH. */
  directionApplicability?: ConfluenceDirectionValue;
  /** Optional organizational link between opposite versions of one condition. */
  pairId?: string | null;
}
export interface StrategyTagRef {
  name: string;
  color: TagColor;
}

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
  // Discrepancy-Gap benchmarks (D2) — the strategy's proven edge.
  expectedWinRate: number | null;
  expectedAvgRr: number | null;
  expectedExpectancy: number | null;
  minExecutionScore: number | null;
  // Counterfactual (Discrepancy Gap) limits — flag over-risk / overtrading days.
  maxDailyRiskPercent: number | null;
  maxTradesPerDay: number | null;
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
  // SOT: the strategy's enabled sessions / confluences / execution confirmations —
  // what the trade form offers to multi-select, and the "expected" set for adherence.
  sessions: StrategyTagRef[];
  confluences: StrategyChecklistRef[];
  execution: StrategyChecklistRef[];
  tradeManagement: {
    maxRiskPercent: number | null;
    maxHoldingTime: string | null;
    customRules: string[];
    partialTakeProfits: { trigger: string | null; percentToClose: number | null }[];
  } | null;
  /** Trade Idea Validation Shield (Stage 4) — the strategy's live Setup
   *  Types, name only. Empty when the strategy has none (legacy flow). */
  setupTypes: { id: string; name: string }[];
}

// ── Setup Types (Today ↔ Journal refinement, Stage 3) ────────────────────────
// A Setup Type curates a scoped subset of the strategy's own checklist items
// into a Bullish + Bearish scenario. Conditions REFERENCE an existing
// StrategyChecklistItem (never a copy); base*/override fields are both
// surfaced so the UI can show "inherited" vs. "overridden for this scenario".
export interface StrategySetupConditionDTO {
  id: string; // StrategySetupScenarioCondition id
  checklistItemId: string;
  name: string;
  color: TagColor;
  kind: "CONFLUENCE" | "EXECUTION";
  directionApplicability: ConfluenceDirectionValue;
  baseWeight: number | null;
  baseMandatory: boolean;
  weightOverride: number | null;
  mandatoryOverride: boolean | null;
  /** Effective values after applying the override, if any — what actually
   *  feeds the scoring engine. */
  effectiveWeight: number | null;
  effectiveMandatory: boolean;
  sortOrder: number;
}

export interface StrategySetupScenarioDTO {
  id: string;
  direction: "BULLISH" | "BEARISH";
  description: string | null;
  conditions: StrategySetupConditionDTO[];
}

export interface StrategySetupTypeDTO {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  /** Always exactly 2 — Bullish and Bearish, one of which may have zero
   *  conditions if the trader intentionally doesn't trade that side. */
  scenarios: StrategySetupScenarioDTO[];
}

// ── Strategy version history (Future integration) ────────────────────────────
// A published, immutable snapshot of the full strategy tree at a point in time.
// Stored as JSON on StrategyVersion.snapshot; reuses the section DTOs so it is a
// faithful record (viewable/restorable later), not just names.
export interface StrategyVersionSessionSnapshot {
  name: string;
  color: TagColor;
  startMinutes: number | null;
  endMinutes: number | null;
  enabled: boolean;
}

export interface StrategyVersionConfluenceSnapshot {
  /** Optional — pre-direction snapshots don't have it. */
  id?: string;
  name: string;
  color: TagColor;
  category: string | null;
  description: string | null;
  weight: number | null;
  mandatory: boolean;
  /** Optional — pre-direction snapshots read as BOTH. */
  directionApplicability?: ConfluenceDirectionValue;
  pairId?: string | null;
  validationCriteria: string | null;
  enabled: boolean;
}

// Setup Types frozen at publish time (Stage 3) — enough to reconstruct the
// setup exactly as it was: condition identity/name, its direction
// applicability, and its MANDATORY/WEIGHT AFTER any scenario override (never
// re-resolved from the live checklist item later, per historical integrity).
export interface StrategyVersionSetupConditionSnapshot {
  checklistItemId: string;
  name: string;
  directionApplicability: ConfluenceDirectionValue;
  mandatory: boolean;
  weight: number | null;
  sortOrder: number;
}
export interface StrategyVersionSetupScenarioSnapshot {
  direction: "BULLISH" | "BEARISH";
  description: string | null;
  conditions: StrategyVersionSetupConditionSnapshot[];
}
export interface StrategyVersionSetupTypeSnapshot {
  name: string;
  description: string | null;
  scenarios: StrategyVersionSetupScenarioSnapshot[];
}

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
  // SOT (added later — optional so pre-SOT snapshots still read): the strategy's
  // sessions + confluences/execution frozen at publish time.
  sessions?: StrategyVersionSessionSnapshot[];
  confluences?: StrategyVersionConfluenceSnapshot[];
  execution?: StrategyVersionConfluenceSnapshot[];
  // Setup Types (added later — optional so pre-Stage-3 snapshots still read).
  setupTypes?: StrategyVersionSetupTypeSnapshot[];
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
  sessionCount: number;
  confluenceCount: number;
  mandatoryConfluenceCount: number;
  executionCount: number;
  setupTypeCount: number;
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
  setupTypes: ListDiff;
  tradeManagement: {
    maxRiskPercent: ScalarChange<number | null> | null;
    maxHoldingTime: ScalarChange<string | null> | null;
    customRuleCountDelta: number;
    partialTpCountDelta: number;
  };
  hasChanges: boolean;
}
