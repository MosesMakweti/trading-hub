/** Weekly Trade Audit — human labels for the closed vocabularies (client-safe). */
import type {
  AnnotationKind,
  AuditExecutionIssueValue,
  AuditInvalidReasonValue,
  AuditVerdictValue,
  AuditWeaknessValue,
  MissReasonValue,
  NoTradeReasonValue,
} from "@/types/trade-audit";

export const NO_TRADE_REASON_LABEL: Record<NoTradeReasonValue, { label: string; hint: string }> = {
  NO_VALID_SETUP: { label: "No valid setup", hint: "The market never met my criteria — staying flat was correct." },
  MISSED_OPPORTUNITY: { label: "Missed an opportunity", hint: "A valid setup appeared and I didn't take it." },
  STAYED_OUT: { label: "Deliberately stayed out", hint: "Conditions were present but I chose not to trade (news, risk, state)." },
  NOT_TRADING: { label: "Not trading that day", hint: "Day off, travel, or otherwise away from the market." },
};

export const VERDICT_LABEL: Record<AuditVerdictValue, string> = {
  VALID: "Valid — should have been taken",
  INVALID: "Should NOT have been taken",
  UNSURE: "Unsure",
};

export const INVALID_REASON_LABEL: Record<AuditInvalidReasonValue, string> = {
  NO_VALID_SETUP: "No valid setup",
  EARLY_ENTRY: "Entered before confirmation",
  OUTSIDE_CONDITIONS: "Outside permitted conditions",
  REVENGE: "Revenge trade",
  OVERTRADING: "Excessive trading",
  RISK_VIOLATION: "Broke risk limits",
  OTHER: "Other",
};

export const EXECUTION_ISSUE_LABEL: Record<AuditExecutionIssueValue, string> = {
  ENTRY_TIMING: "Entry timing",
  NO_CONFIRMATION: "Didn't wait for confirmation",
  STOP_PLACEMENT: "Stop placement",
  TRADE_MANAGEMENT: "Trade management",
  EXIT_DECISION: "Exit decision",
  PREMATURE_EXIT: "Exited too early",
  INTERFERENCE: "Interfered with a valid position",
  OTHER: "Other",
};

export const WEAKNESS_LABEL: Record<AuditWeaknessValue, string> = {
  IMPATIENCE: "Impatience",
  FEAR_HESITATION: "Fear / hesitation",
  FOMO: "FOMO",
  REVENGE_EMOTION: "Revenge / frustration",
  OVERCONFIDENCE: "Overconfidence",
  LACK_OF_DISCIPLINE: "Lack of discipline",
  STRATEGY_GAP: "Strategy knowledge gap",
  RISK_MANAGEMENT: "Risk management",
  FOCUS: "Focus / distraction",
  OTHER: "Other",
};

export const MISS_REASON_LABEL: Record<MissReasonValue, string> = {
  FEAR: "Fear",
  HESITATION: "Hesitation",
  FOMO_ELSEWHERE: "Busy in another trade",
  DISTRACTED: "Distracted",
  MISSED_ALERT: "Wasn't watching / no alert",
  LATE_CONFIRMATION: "Saw it too late",
  RISK_CONCERNS: "Risk concerns",
  TECHNICAL_ISSUE: "Technical issue",
  RULE_UNCERTAINTY: "Unsure it qualified",
  INTENTIONAL_SKIP: "Deliberate skip",
  OTHER: "Other",
};

export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, { label: string; short: string; color: string }> = {
  INTENDED_ENTRY: { label: "Intended entry", short: "IE", color: "#3b82f6" },
  ACTUAL_ENTRY: { label: "Actual entry", short: "AE", color: "#8b5cf6" },
  STOP_LOSS: { label: "Stop loss", short: "SL", color: "#ef4444" },
  TAKE_PROFIT: { label: "Take profit", short: "TP", color: "#22c55e" },
  STRUCTURE: { label: "Market structure", short: "MS", color: "#f59e0b" },
  CONFIRMATION: { label: "Confirmation", short: "C", color: "#06b6d4" },
  NOTE: { label: "Note", short: "N", color: "#64748b" },
};
