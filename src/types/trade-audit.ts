/**
 * Weekly Trade Audit DTOs — the serializable shapes the Edge Review page
 * renders. See docs/WEEKLY_TRADE_AUDIT.md. Client components import these
 * as types only.
 */

export const NO_TRADE_REASONS = ["NO_VALID_SETUP", "MISSED_OPPORTUNITY", "STAYED_OUT", "NOT_TRADING"] as const;
export type NoTradeReasonValue = (typeof NO_TRADE_REASONS)[number];

export const AUDIT_VERDICTS = ["VALID", "INVALID", "UNSURE"] as const;
export type AuditVerdictValue = (typeof AUDIT_VERDICTS)[number];

export const AUDIT_INVALID_REASONS = [
  "NO_VALID_SETUP",
  "EARLY_ENTRY",
  "OUTSIDE_CONDITIONS",
  "REVENGE",
  "OVERTRADING",
  "RISK_VIOLATION",
  "OTHER",
] as const;
export type AuditInvalidReasonValue = (typeof AUDIT_INVALID_REASONS)[number];

export const AUDIT_EXECUTION_ISSUES = [
  "ENTRY_TIMING",
  "NO_CONFIRMATION",
  "STOP_PLACEMENT",
  "TRADE_MANAGEMENT",
  "EXIT_DECISION",
  "PREMATURE_EXIT",
  "INTERFERENCE",
  "OTHER",
] as const;
export type AuditExecutionIssueValue = (typeof AUDIT_EXECUTION_ISSUES)[number];

export const AUDIT_WEAKNESSES = [
  "IMPATIENCE",
  "FEAR_HESITATION",
  "FOMO",
  "REVENGE_EMOTION",
  "OVERCONFIDENCE",
  "LACK_OF_DISCIPLINE",
  "STRATEGY_GAP",
  "RISK_MANAGEMENT",
  "FOCUS",
  "OTHER",
] as const;
export type AuditWeaknessValue = (typeof AUDIT_WEAKNESSES)[number];

export const MISS_REASONS = [
  "FEAR",
  "HESITATION",
  "FOMO_ELSEWHERE",
  "DISTRACTED",
  "MISSED_ALERT",
  "LATE_CONFIRMATION",
  "RISK_CONCERNS",
  "TECHNICAL_ISSUE",
  "RULE_UNCERTAINTY",
  "INTENTIONAL_SKIP",
  "OTHER",
] as const;
export type MissReasonValue = (typeof MISS_REASONS)[number];

export const ANNOTATION_KINDS = ["INTENDED_ENTRY", "ACTUAL_ENTRY", "STOP_LOSS", "TAKE_PROFIT", "STRUCTURE", "CONFIRMATION", "NOTE"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export interface AnnotationMarker {
  id: string;
  kind: AnnotationKind;
  /** Normalized 0–1 position within the image. */
  x: number;
  y: number;
  note: string | null;
}

/**
 * Where an image came from — the honesty axis the review depends on:
 *  SESSION      — attached to the trade/opportunity on or before its trading day
 *  POST_SESSION — attached to the trade/opportunity record, but after its day
 *  REVIEW       — uploaded during this audit
 * Review markers (`annotation`) are an independent, always-retrospective overlay.
 */
export type ImageProvenance = "SESSION" | "POST_SESSION" | "REVIEW";

export interface AuditImageDTO {
  attachmentId: string;
  url: string;
  fileName: string;
  caption: string | null;
  category: string | null;
  provenance: ImageProvenance;
  annotation: AnnotationMarker[] | null;
  /** Only review uploads can be removed from inside the audit. */
  removable: boolean;
}

export type TradeOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | "CANCELLED";

/** Facts Traditorium already recorded about a trade that are relevant to a
 *  "should I have taken it?" judgment. Hints only — never a verdict. */
export interface TradeSystemFlag {
  key: "VALIDATION_OVERRIDDEN" | "NOT_VALIDATED" | "LIMIT_OVERRIDE" | "BEHAVIOURAL_INTENT" | "INVALID_SETUP";
  label: string;
}

export interface AuditTradeDTO {
  id: string;
  tradeNumber: number | null;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  strategyId: string | null;
  strategyName: string | null;
  setupName: string | null;
  session: string | null;
  timeframe: string | null;
  /** "HH:MM" trader-local entry time (Trade.executionMinutes). */
  entryTime: string | null;
  closedAt: string | null;
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTarget: number | null;
  actualEntry: number | null;
  actualStopLoss: number | null;
  actualExit: number | null;
  /** Human label, e.g. "1.5 lots" — null when not recorded (never guessed). */
  positionSize: string | null;
  /** Human label, e.g. "1.00%" or "250.00" — null when not recorded. */
  risk: string | null;
  plannedR: number | null;
  realizedR: number | null;
  pnl: number | null;
  outcome: TradeOutcome;
  reasonForTrade: string | null;
  executionNotes: string | null;
  /** Setup Validation Shield state at the time (null = no Setup Type used).
   *  Optional: snapshots frozen before this field existed don't carry it. */
  validationState?: "VALIDATED" | "NOT_VALIDATED" | "OVERRIDDEN" | null;
  /** Strategy confluences the trader ticked when taking the trade. */
  confluences?: string[];
  systemFlags: TradeSystemFlag[];
  images: AuditImageDTO[];
}

export interface TradeAssessmentDTO {
  id: string;
  tradeId: string | null;
  dateKey: string;
  verdict: AuditVerdictValue | null;
  invalidReasons: AuditInvalidReasonValue[];
  executionIssues: AuditExecutionIssueValue[];
  executionQuality: number | null;
  mistake: string | null;
  weaknesses: AuditWeaknessValue[];
  underlyingWeakness: string | null;
  improvement: string | null;
  assessedAt: string | null;
  images: AuditImageDTO[];
}

export interface ExpectedTradeDTO {
  id: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  intendedEntry: number | null;
  stopLoss: number | null;
  target: number | null;
  intendedRiskPercent: number | null;
  strategyId: string | null;
  strategyName: string | null;
  setupName: string | null;
  timeframe: string | null;
  /** The actual trade (same day) this setup should have been taken INSTEAD of. */
  linkedTradeId: string | null;
  validityReason: string;
  criteriaMet: string[];
  missReason: MissReasonValue | null;
  missNote: string | null;
  weaknesses: AuditWeaknessValue[];
  underlyingWeakness: string | null;
  improvement: string | null;
  images: AuditImageDTO[];
}

/** A MISSED TradeOpportunity recorded live during the session — shown
 *  read-only next to the retrospective expected trades. */
export interface LiveMissedOpportunityDTO {
  id: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTarget: number | null;
  strategyName: string | null;
  /** Scored at the time against the strategy (null = never scored). */
  setupValid: boolean | null;
  setupScore: number | null;
  missReason: MissReasonValue | null;
  missNote: string | null;
  images: AuditImageDTO[];
}

/** What changed on a trade since it was assessed / since the week was finalized. */
export interface TradeChangeDTO {
  tradeId: string;
  label: string;
  kind: "EDITED" | "MOVED" | "REMOVED" | "ADDED";
  fields: string[];
}

export type DayScheduleKind = "SCHEDULED" | "DAY_OFF" | "UNSCHEDULED";
export type DailyAuditStatusValue = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface AuditDayDTO {
  dateKey: string;
  schedule: DayScheduleKind;
  status: DailyAuditStatusValue;
  dailyAuditId: string | null;
  noTradeReason: NoTradeReasonValue | null;
  wentWell: string | null;
  wentWrong: string | null;
  couldDoBetter: string | null;
  mainLesson: string | null;
  trades: AuditTradeDTO[];
  assessments: Record<string, TradeAssessmentDTO>;
  expectedTrades: ExpectedTradeDTO[];
  liveMissed: LiveMissedOpportunityDTO[];
  dayImages: AuditImageDTO[];
  changes: TradeChangeDTO[];
}

export interface AuditRatings {
  executionQualityRating: number | null;
  tradeSelectionRating: number | null;
  patienceRating: number | null;
  strategyAdherenceRating: number | null;
  riskManagementRating: number | null;
  tradeManagementRating: number | null;
}

export interface AuditAssessmentText {
  executionSummary: string | null;
  decisionSummary: string | null;
  strongestArea: string | null;
  biggestWeakness: string | null;
  recurringPatterns: string | null;
  mainLesson: string | null;
  nextWeekPriority: string | null;
}

export interface WeeklyAuditDTO extends AuditRatings, AuditAssessmentText {
  id: string;
  status: "IN_PROGRESS" | "FINALIZED";
  finalizedAt: string | null;
  reopenedAt: string | null;
}

export interface LegacyReflectionDTO {
  wentWell: unknown;
  toImprove: unknown;
  focusNextWeek: unknown;
}
