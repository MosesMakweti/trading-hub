import { canonicalJson } from "@/lib/canonical-json";
import { computeSetupStats, groupStats, type GroupStats, type SetupStats, type StatRow } from "@/domain/simulation/study-stats";

/**
 * Baseline-vs-experiment result comparison (pure).
 *
 * Results are only presented as directly comparable when the sessions were
 * run under the same historical conditions: the same instrument → dataset
 * pins, period, starting balance, currency and frozen trading rules/costs.
 * Anything else is reported as a difference, never silently averaged away.
 */

export interface SessionConditions {
  accountId: string;
  name: string;
  /** symbol → dataset id */
  pins: Record<string, string>;
  periodStart: string;
  periodEnd: string;
  startingBalance: string;
  currency: string;
  rules: unknown;
}

export interface ConditionDifference {
  field: "Instruments & datasets" | "Period" | "Starting balance" | "Currency" | "Costs & rules";
  baseline: string[];
  experiment: string[];
}

const describe = {
  pins: (c: SessionConditions) => Object.entries(c.pins).sort().map(([s, d]) => `${s} (${d.slice(-6)})`).join(", "),
  period: (c: SessionConditions) => `${c.periodStart} → ${c.periodEnd}`,
  balance: (c: SessionConditions) => `${c.startingBalance} ${c.currency}`,
};

/** Differences between the conditions used by two groups of sessions. */
export function conditionDifferences(baseline: SessionConditions[], experiment: SessionConditions[]): ConditionDifference[] {
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const fields: { field: ConditionDifference["field"]; of: (c: SessionConditions) => string; show?: (c: SessionConditions) => string }[] = [
    { field: "Instruments & datasets", of: (c) => canonicalJson(c.pins), show: describe.pins },
    { field: "Period", of: describe.period },
    { field: "Starting balance", of: (c) => c.startingBalance, show: describe.balance },
    { field: "Currency", of: (c) => c.currency },
    { field: "Costs & rules", of: (c) => canonicalJson(c.rules), show: () => "custom costs/rules" },
  ];
  const out: ConditionDifference[] = [];
  for (const f of fields) {
    const a = uniq(baseline.map(f.of));
    const b = uniq(experiment.map(f.of));
    if (a.length + b.length === 0) continue;
    const same = a.length === 1 && b.length === 1 && a[0] === b[0];
    if (!same) {
      const show = f.show ?? f.of;
      out.push({ field: f.field, baseline: uniq(baseline.map(show)), experiment: uniq(experiment.map(show)) });
    }
  }
  return out;
}

export interface TradeRow extends StatRow {
  accountId: string;
  symbol: string;
  session: string | null;
  setupType: string | null;
  executionScore: number | null;
  followedRules: boolean | null;
}

export interface GroupResults {
  sessions: number;
  overall: SetupStats;
  averageExecutionScore: number | null;
  /** Share of evaluated trades where every automatic check passed (0–100). */
  ruleAdherence: number | null;
  evaluatedTrades: number;
  bySession: GroupStats[];
  byInstrument: GroupStats[];
  bySetupType: GroupStats[];
  byRuleAdherence: GroupStats[];
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);

export function groupResults(rows: TradeRow[], sessionCount: number): GroupResults {
  const scored = rows.map((r) => r.executionScore).filter((x): x is number => x != null);
  const evaluated = rows.filter((r) => r.followedRules != null);
  return {
    sessions: sessionCount,
    overall: computeSetupStats(rows),
    averageExecutionScore: mean(scored),
    ruleAdherence: evaluated.length ? Math.round((evaluated.filter((r) => r.followedRules).length / evaluated.length) * 100) : null,
    evaluatedTrades: evaluated.length,
    bySession: groupStats(rows, (r) => ({ key: r.session ?? "—", label: r.session ?? "Outside sessions / not evaluated" })),
    byInstrument: groupStats(rows, (r) => ({ key: r.symbol, label: r.symbol })),
    bySetupType: groupStats(rows, (r) => ({ key: r.setupType ?? "—", label: r.setupType ?? "No setup type" })),
    byRuleAdherence: groupStats(rows, (r) =>
      r.followedRules == null ? null : { key: String(r.followedRules), label: r.followedRules ? "Followed the rules" : "Broke a rule" },
    ),
  };
}

export interface ComparisonWarning {
  kind: "CONDITIONS_DIFFER" | "SMALL_SAMPLE" | "NO_RESULTS" | "MANY_VARIATIONS" | "PROFIT_ONLY";
  message: string;
}

/** Honest caveats for a baseline/experiment comparison. */
export function comparisonWarnings(input: {
  baseline: GroupResults;
  experiment: GroupResults;
  differences: ConditionDifference[];
  variationsTested: number;
}): ComparisonWarning[] {
  const w: ComparisonWarning[] = [];
  if (input.baseline.overall.resolved === 0 || input.experiment.overall.resolved === 0) {
    w.push({ kind: "NO_RESULTS", message: "One side has no closed trades with a stop yet — there is nothing to compare." });
  }
  if (input.differences.length) {
    w.push({
      kind: "CONDITIONS_DIFFER",
      message: `The sessions were not run under the same conditions (${input.differences.map((d) => d.field.toLowerCase()).join(", ")}). Differences in results may come from the data, not the strategy change. Use "Test on same conditions" for a fair comparison.`,
    });
  }
  for (const [label, g] of [["Baseline", input.baseline], ["Experiment", input.experiment]] as const) {
    if (g.overall.resolved > 0 && (g.overall.sample === "INSUFFICIENT" || g.overall.sample === "LOW")) {
      w.push({ kind: "SMALL_SAMPLE", message: `${label}: only ${g.overall.resolved} resolved trade${g.overall.resolved === 1 ? "" : "s"} — ratios this small are mostly noise.` });
    }
  }
  if (input.variationsTested >= 3) {
    w.push({
      kind: "MANY_VARIATIONS",
      message: `${input.variationsTested} variations of this strategy have been tested on historical data. The more you try, the more likely the best one just fits this period — confirm on a period you haven't used.`,
    });
  }
  w.push({ kind: "PROFIT_ONLY", message: "Judge a refinement on expectancy, drawdown, rule adherence and sample size together — not on net profit alone." });
  return w;
}
