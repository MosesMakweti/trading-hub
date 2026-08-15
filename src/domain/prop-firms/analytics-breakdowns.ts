/**
 * Prop Firms analytics (spec §9) — a PARALLEL path to domain/performance/
 * breakdowns.ts, never merged into it. System A's breakdowns aggregate over
 * the Performance Account's trade-level PnL; these aggregate over
 * TradeAccountExecution rows, which is a genuinely different unit (one
 * Trade Idea can have several executions across different accounts/firms).
 *
 * Anti-double-count rule, enforced by construction: every function here
 * takes an array of executions (never Trade rows) and groups/sums THOSE —
 * so a multi-account idea contributes once per execution, by design (spec:
 * execution-level stats may count separately "when explicitly selected").
 * A per-idea view (Journal) groups by tradeId instead, at the call site.
 */
export interface ExecutionAnalyticsPoint {
  tradeId: string;
  propFirmAccountId: string;
  accountDisplayName: string;
  firmId: string;
  firmName: string;
  marketCategory: "CFD" | "FUTURES";
  isFundedAccount: boolean;
  netPnl: number | null;
  actualR: number | null;
  plannedRiskAmount: number;
  riskPercentOfBase: number | null;
  status: "PLANNED" | "OPEN" | "CLOSED" | "CANCELLED";
  closedAt: string | null;
}

export interface LabeledPerf {
  label: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
  avgR: number | null;
}

function closedOnly(points: ExecutionAnalyticsPoint[]): ExecutionAnalyticsPoint[] {
  return points.filter((p) => p.status === "CLOSED" && p.netPnl != null);
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function perfFor(label: string, points: ExecutionAnalyticsPoint[]): LabeledPerf {
  const closed = closedOnly(points);
  const wins = closed.filter((p) => (p.netPnl ?? 0) > 0).length;
  return {
    label,
    trades: closed.length,
    netPnl: closed.reduce((s, p) => s + (p.netPnl ?? 0), 0),
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
    avgR: mean(closed.filter((p) => p.actualR != null).map((p) => p.actualR!)),
  };
}

function groupBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function performanceByFirm(points: ExecutionAnalyticsPoint[]): LabeledPerf[] {
  const byFirm = groupBy(points, (p) => p.firmId);
  return [...byFirm.entries()].map(([firmId, group]) => perfFor(group[0]?.firmName ?? firmId, group));
}

export function performanceByAccount(points: ExecutionAnalyticsPoint[]): LabeledPerf[] {
  const byAccount = groupBy(points, (p) => p.propFirmAccountId);
  return [...byAccount.entries()].map(([accountId, group]) => perfFor(group[0]?.accountDisplayName ?? accountId, group));
}

export function performanceByMarketCategory(points: ExecutionAnalyticsPoint[]): LabeledPerf[] {
  const byMarket = groupBy(points, (p) => p.marketCategory);
  return [...byMarket.entries()].map(([market, group]) => perfFor(market, group));
}

export function performanceByFundedOrChallenge(points: ExecutionAnalyticsPoint[]): LabeledPerf[] {
  const byFunded = groupBy(points, (p) => (p.isFundedAccount ? "FUNDED" : "CHALLENGE"));
  return [...byFunded.entries()].map(([label, group]) => perfFor(label, group));
}

export interface StageOutcomePoint {
  accountId: string;
  stageType: string;
  status: "PASSED" | "FAILED" | "BREACHED" | "RESET" | "ABANDONED" | "ACTIVE" | "PENDING" | "ARCHIVED";
  startDate: string | null;
  completionDate: string | null;
}

/** null when there are no resolved (non-active/pending) stages to divide by
 *  — never a fabricated 0%. */
export function challengePassRatePercent(stages: StageOutcomePoint[]): number | null {
  const resolved = stages.filter((s) => s.status === "PASSED" || s.status === "FAILED" || s.status === "BREACHED");
  if (resolved.length === 0) return null;
  const passed = resolved.filter((s) => s.status === "PASSED").length;
  return (passed / resolved.length) * 100;
}

/** Buckets negative outcomes by stage type — the closest honest proxy to
 *  "failure reasons" this app can support without a structured breach-reason
 *  field (completionNotes is free text, not queryable as a taxonomy). */
export function stageFailureReasons(stages: StageOutcomePoint[]): { reason: string; count: number }[] {
  const failures = stages.filter((s) => s.status === "FAILED" || s.status === "BREACHED");
  const byReason = groupBy(failures, (s) => `${s.stageType} — ${s.status}` as const);
  return [...byReason.entries()].map(([reason, group]) => ({ reason, count: group.length })).sort((a, b) => b.count - a.count);
}

/** Average calendar days from stage start to completion, PASSED stages only.
 *  Null when no passed stage has both dates recorded. */
export function avgTimeToPassDays(stages: StageOutcomePoint[]): number | null {
  const passed = stages.filter((s) => s.status === "PASSED" && s.startDate && s.completionDate);
  if (passed.length === 0) return null;
  const days = passed.map((s) => (new Date(s.completionDate!).getTime() - new Date(s.startDate!).getTime()) / 86_400_000);
  return mean(days);
}

export interface RuleBreachPoint {
  ruleKey: string;
  state: string;
}

/** Tallies how often each RuleKey's live evaluation came back BREACHED —
 *  feed it a flat array of already-evaluated rule-health results across
 *  whatever accounts/stages the caller is analyzing. */
export function ruleBreachFrequency(results: RuleBreachPoint[]): { ruleKey: string; breachCount: number }[] {
  const breaches = results.filter((r) => r.state === "BREACHED");
  const byRule = groupBy(breaches, (r) => r.ruleKey);
  return [...byRule.entries()].map(([ruleKey, group]) => ({ ruleKey, breachCount: group.length })).sort((a, b) => b.breachCount - a.breachCount);
}

export interface RiskOutcomeBucket {
  bucketLabel: string;
  minRiskPercent: number;
  maxRiskPercent: number;
  trades: number;
  avgActualR: number | null;
  winRate: number | null;
}

const RISK_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0-0.5%", min: 0, max: 0.5 },
  { label: "0.5-1%", min: 0.5, max: 1 },
  { label: "1-2%", min: 1, max: 2 },
  { label: "2%+", min: 2, max: Infinity },
];

/** Groups closed executions by their risk-% bucket and reports how outcomes
 *  varied — "did risking more actually pay off." Executions with no
 *  resolvable risk % are excluded (never guessed into a bucket). */
export function riskAllocationVsOutcome(points: ExecutionAnalyticsPoint[]): RiskOutcomeBucket[] {
  const closed = closedOnly(points).filter((p) => p.riskPercentOfBase != null);
  return RISK_BUCKETS.map(({ label, min, max }) => {
    const inBucket = closed.filter((p) => p.riskPercentOfBase! >= min && p.riskPercentOfBase! < max);
    const wins = inBucket.filter((p) => (p.netPnl ?? 0) > 0).length;
    return {
      bucketLabel: label,
      minRiskPercent: min,
      maxRiskPercent: max,
      trades: inBucket.length,
      avgActualR: mean(inBucket.filter((p) => p.actualR != null).map((p) => p.actualR!)),
      winRate: inBucket.length > 0 ? (wins / inBucket.length) * 100 : null,
    };
  }).filter((b) => b.trades > 0);
}
