/**
 * Weekly Trade Audit — the deterministic weekly summary (pure).
 *
 * Built ONLY from facts already recorded (trade results) and the trader's own
 * review entries (verdicts, issues, weaknesses, missed setups). No price
 * hindsight, no AI text. The central idea is decision quality over profit:
 * every judged trade lands in a process × outcome matrix, so a profitable
 * rule-break is shown as "bad process, good outcome", never as a good trade,
 * and a losing valid trade is "good process, bad outcome", never a mistake.
 */
import {
  EXECUTION_ISSUE_LABEL,
  INVALID_REASON_LABEL,
  MISS_REASON_LABEL,
  WEAKNESS_LABEL,
} from "@/domain/trade-audit/labels";
import type {
  AuditExecutionIssueValue,
  AuditInvalidReasonValue,
  AuditVerdictValue,
  AuditWeaknessValue,
  DailyAuditStatusValue,
  MissReasonValue,
  TradeOutcome,
} from "@/types/trade-audit";

export interface SummaryTradeInput {
  id: string;
  outcome: TradeOutcome;
  realizedR: number | null;
  pnl: number | null;
  systemFlagCount: number;
}

export interface SummaryAssessmentInput {
  tradeId: string;
  verdict: AuditVerdictValue | null;
  invalidReasons: AuditInvalidReasonValue[];
  executionIssues: AuditExecutionIssueValue[];
  executionQuality: number | null;
  weaknesses: AuditWeaknessValue[];
}

export interface SummaryMissInput {
  missReason: MissReasonValue | null;
  weaknesses: AuditWeaknessValue[];
  /** true = retrospective (recorded in review); false = recorded live. */
  retrospective: boolean;
}

export interface SummaryInput {
  trades: SummaryTradeInput[];
  assessments: SummaryAssessmentInput[];
  misses: SummaryMissInput[];
  days: { status: DailyAuditStatusValue }[];
}

export interface Tally<K extends string> {
  key: K;
  label: string;
  count: number;
}

export interface MatrixCell {
  count: number;
  r: number;
}

export interface DimensionEvidence {
  key: "executionQuality" | "tradeSelection" | "patience" | "strategyAdherence" | "riskManagement" | "tradeManagement";
  label: string;
  issues: number;
  /** One-line evidence shown next to the trader's rating. */
  evidence: string;
}

export interface WeeklyAuditSummary {
  trades: { total: number; executed: number; wins: number; losses: number; breakeven: number; pending: number; netR: number; netPnl: number | null };
  judged: { valid: number; invalid: number; unsure: number; unassessed: number };
  matrix: {
    goodProcessGoodOutcome: MatrixCell;
    goodProcessBadOutcome: MatrixCell;
    badProcessGoodOutcome: MatrixCell;
    badProcessBadOutcome: MatrixCell;
  };
  ruleViolations: number;
  systemFlaggedTrades: number;
  missed: { total: number; retrospective: number; live: number; byReason: Tally<MissReasonValue>[] };
  invalidReasons: Tally<AuditInvalidReasonValue>[];
  executionIssues: Tally<AuditExecutionIssueValue>[];
  weaknesses: (Tally<AuditWeaknessValue> & { repeated: boolean })[];
  averageExecutionQuality: number | null;
  days: { total: number; completed: number; inProgress: number };
  dimensions: DimensionEvidence[];
  drafts: {
    executionSummary: string;
    decisionSummary: string;
    strongestArea: string;
    biggestWeakness: string;
    recurringPatterns: string;
  };
}

function tally<K extends string>(values: K[], labels: Record<K, string>): Tally<K>[] {
  const counts = new Map<K, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labels[key], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildWeeklySummary(input: SummaryInput): WeeklyAuditSummary {
  const assessmentByTrade = new Map(input.assessments.map((a) => [a.tradeId, a]));
  const executed = input.trades.filter((t) => t.outcome !== "CANCELLED");

  const wins = executed.filter((t) => t.outcome === "WIN").length;
  const losses = executed.filter((t) => t.outcome === "LOSS").length;
  const breakeven = executed.filter((t) => t.outcome === "BREAKEVEN").length;
  const pending = executed.filter((t) => t.outcome === "PENDING").length;
  const netR = round2(executed.reduce((s, t) => s + (t.realizedR ?? 0), 0));
  const pnlValues = executed.map((t) => t.pnl).filter((p): p is number => p != null);
  const netPnl = pnlValues.length > 0 ? round2(pnlValues.reduce((s, p) => s + p, 0)) : null;

  const judged = { valid: 0, invalid: 0, unsure: 0, unassessed: 0 };
  const cell = (): MatrixCell => ({ count: 0, r: 0 });
  const matrix = {
    goodProcessGoodOutcome: cell(),
    goodProcessBadOutcome: cell(),
    badProcessGoodOutcome: cell(),
    badProcessBadOutcome: cell(),
  };

  for (const t of input.trades) {
    const a = assessmentByTrade.get(t.id);
    const verdict = a?.verdict ?? null;
    if (verdict === "VALID") judged.valid += 1;
    else if (verdict === "INVALID") judged.invalid += 1;
    else if (verdict === "UNSURE") judged.unsure += 1;
    else judged.unassessed += 1;

    // Only judged trades with a DETERMINED result enter the matrix.
    if ((verdict === "VALID" || verdict === "INVALID") && (t.outcome === "WIN" || t.outcome === "LOSS" || t.outcome === "BREAKEVEN")) {
      const goodOutcome = t.outcome === "WIN";
      const target =
        verdict === "VALID"
          ? goodOutcome
            ? matrix.goodProcessGoodOutcome
            : matrix.goodProcessBadOutcome
          : goodOutcome
            ? matrix.badProcessGoodOutcome
            : matrix.badProcessBadOutcome;
      target.count += 1;
      target.r = round2(target.r + (t.realizedR ?? 0));
    }
  }

  const invalidReasons = tally(input.assessments.flatMap((a) => a.invalidReasons), INVALID_REASON_LABEL);
  const executionIssues = tally(input.assessments.flatMap((a) => a.executionIssues), EXECUTION_ISSUE_LABEL);
  const weaknesses = tally(
    [...input.assessments.flatMap((a) => a.weaknesses), ...input.misses.flatMap((m) => m.weaknesses)],
    WEAKNESS_LABEL,
  ).map((w) => ({ ...w, repeated: w.count >= 2 }));
  const missByReason = tally(
    input.misses.map((m) => m.missReason).filter((r): r is MissReasonValue => r != null),
    MISS_REASON_LABEL,
  );

  const qualities = input.assessments.map((a) => a.executionQuality).filter((q): q is number => q != null);
  const averageExecutionQuality = qualities.length > 0 ? round2(qualities.reduce((s, q) => s + q, 0) / qualities.length) : null;

  const countIssue = (keys: AuditExecutionIssueValue[]) => executionIssues.filter((i) => keys.includes(i.key)).reduce((s, i) => s + i.count, 0);
  const countInvalid = (keys: AuditInvalidReasonValue[]) => invalidReasons.filter((i) => keys.includes(i.key)).reduce((s, i) => s + i.count, 0);
  const countWeak = (keys: AuditWeaknessValue[]) => weaknesses.filter((i) => keys.includes(i.key)).reduce((s, i) => s + i.count, 0);

  const missed = { total: input.misses.length, retrospective: input.misses.filter((m) => m.retrospective).length, live: input.misses.filter((m) => !m.retrospective).length, byReason: missByReason };

  const patienceIssues = countIssue(["ENTRY_TIMING", "NO_CONFIRMATION"]) + countInvalid(["EARLY_ENTRY"]) + countWeak(["IMPATIENCE", "FOMO"]);
  const riskIssues = countInvalid(["RISK_VIOLATION", "OVERTRADING"]) + countIssue(["STOP_PLACEMENT"]) + countWeak(["RISK_MANAGEMENT"]);
  const managementIssues = countIssue(["TRADE_MANAGEMENT", "EXIT_DECISION", "PREMATURE_EXIT", "INTERFERENCE"]);
  const adherenceIssues = judged.invalid;
  const selectionIssues = judged.invalid + missed.total;
  const executionIssueCount = executionIssues.reduce((s, i) => s + i.count, 0);

  const dimensions: DimensionEvidence[] = [
    {
      key: "executionQuality",
      label: "Execution quality",
      issues: executionIssueCount,
      evidence: `${plural(executionIssueCount, "execution issue")}${averageExecutionQuality != null ? ` · avg ${averageExecutionQuality}/5` : ""}`,
    },
    { key: "tradeSelection", label: "Trade selection", issues: selectionIssues, evidence: `${plural(judged.invalid, "invalid trade")} · ${plural(missed.total, "missed setup")}` },
    { key: "patience", label: "Patience", issues: patienceIssues, evidence: `${plural(patienceIssues, "early / impatient decision")}` },
    { key: "strategyAdherence", label: "Strategy adherence", issues: adherenceIssues, evidence: `${judged.valid} valid · ${judged.invalid} invalid` },
    { key: "riskManagement", label: "Risk management", issues: riskIssues, evidence: `${plural(riskIssues, "risk issue")}` },
    { key: "tradeManagement", label: "Trade management", issues: managementIssues, evidence: `${plural(managementIssues, "management issue")}` },
  ];

  const days = {
    total: input.days.length,
    completed: input.days.filter((d) => d.status === "COMPLETED").length,
    inProgress: input.days.filter((d) => d.status === "IN_PROGRESS").length,
  };

  // ── Drafts (prefill only — the trader edits before finalizing) ───────────
  const judgedCount = judged.valid + judged.invalid;
  const executionSummary =
    executed.length === 0
      ? "No trades were executed this week."
      : `${plural(executed.length, "trade")} executed (${wins}W / ${losses}L${breakeven ? ` / ${breakeven}BE` : ""}${pending ? `, ${pending} open` : ""}), net ${netR >= 0 ? "+" : ""}${netR}R.` +
        (executionIssueCount > 0 ? ` Most frequent execution issue: ${executionIssues[0].label.toLowerCase()} (${executionIssues[0].count}×).` : " No execution issues recorded.") +
        (averageExecutionQuality != null ? ` Average execution quality ${averageExecutionQuality}/5.` : "");

  const decisionSummary =
    judgedCount === 0 && missed.total === 0
      ? "No trade decisions have been judged yet."
      : `${judged.valid} of ${judgedCount} judged trades met the strategy criteria; ${plural(judged.invalid, "trade")} should not have been taken${missed.total > 0 ? ` and ${plural(missed.total, "valid setup")} ${missed.total === 1 ? "was" : "were"} missed` : ""}.` +
        (matrix.badProcessGoodOutcome.count > 0 ? ` ${plural(matrix.badProcessGoodOutcome.count, "profitable trade")} broke the rules — treat ${matrix.badProcessGoodOutcome.count === 1 ? "it" : "them"} as mistakes, not wins.` : "") +
        (matrix.goodProcessBadOutcome.count > 0 ? ` ${plural(matrix.goodProcessBadOutcome.count, "losing trade")} followed the plan — acceptable losses.` : "");

  const withEvidence = dimensions.filter((d) => (d.key === "executionQuality" ? executed.length > 0 : judgedCount > 0 || missed.total > 0));
  const clean = withEvidence.filter((d) => d.issues === 0);
  const strongestArea =
    clean.length > 0
      ? `${clean[0].label} — no issues recorded this week (${clean[0].evidence}).`
      : withEvidence.length > 0
        ? `${[...withEvidence].sort((a, b) => a.issues - b.issues)[0].label} had the fewest recorded issues.`
        : "Not enough judged decisions yet to identify a strength.";

  const topWeakness = weaknesses[0];
  const topProblem = [...invalidReasons, ...executionIssues].sort((a, b) => b.count - a.count)[0];
  const biggestWeakness = topWeakness
    ? `${topWeakness.label} (${plural(topWeakness.count, "occurrence")}).`
    : topProblem
      ? `${topProblem.label} (${plural(topProblem.count, "occurrence")}) — no underlying weakness tagged yet.`
      : "No weakness recorded yet.";

  const repeated = [
    ...weaknesses.filter((w) => w.repeated).map((w) => `${w.label} ×${w.count}`),
    ...invalidReasons.filter((r) => r.count >= 2).map((r) => `${r.label} ×${r.count}`),
    ...executionIssues.filter((r) => r.count >= 2).map((r) => `${r.label} ×${r.count}`),
    ...missByReason.filter((r) => r.count >= 2).map((r) => `Missed: ${r.label.toLowerCase()} ×${r.count}`),
  ];
  const recurringPatterns = repeated.length > 0 ? `Repeated this week: ${repeated.join("; ")}.` : "No pattern repeated more than once this week.";

  return {
    trades: { total: input.trades.length, executed: executed.length, wins, losses, breakeven, pending, netR, netPnl },
    judged,
    matrix,
    ruleViolations: judged.invalid,
    systemFlaggedTrades: input.trades.filter((t) => t.systemFlagCount > 0).length,
    missed,
    invalidReasons,
    executionIssues,
    weaknesses,
    averageExecutionQuality,
    days,
    dimensions,
    drafts: { executionSummary, decisionSummary, strongestArea, biggestWeakness, recurringPatterns },
  };
}
