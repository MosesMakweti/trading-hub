// Deviation engine — explains WHY a trade's actual result differed from its plan,
// by comparing planned-vs-actual entry / exit / risk and attributing an estimated
// R-cost to each deviation. The largest is the trade's "primary deviation", which
// the Psychology Lab classifies into a behavioural cause and aggregates over time.
//
// Pure + framework-free. Costs are estimates in R (1R = the planned entry→stop
// distance), robust to missing inputs (a deviation whose inputs are absent is
// simply not produced). NOT a market prediction.

export type DeviationCause =
  | "late-entry" // chased a worse entry (FOMO / impatience)
  | "early-entry" // jumped in ahead of the plan
  | "premature-exit" // closed a winner before target (fear / hesitation)
  | "loss-overrun" // let a loss run past the stop (rule skipping)
  | "increased-risk"; // sized above the plan (revenge / over-confidence)

export const DEVIATION_LABEL: Record<DeviationCause, string> = {
  "late-entry": "Late / chased entry",
  "early-entry": "Early entry",
  "premature-exit": "Premature exit",
  "loss-overrun": "Loss overrun",
  "increased-risk": "Increased risk",
};

export interface DeviationInput {
  direction: "LONG" | "SHORT";
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTarget: number | null;
  actualEntry: number | null;
  actualExit: number | null;
  actualRR: number | null;
  plannedRiskPercent?: number | null;
  actualRiskPercent?: number | null;
}

export interface Deviation {
  cause: DeviationCause;
  label: string;
  costR: number; // estimated R cost (≥ 0)
}

export interface TradeDeviations {
  deviations: Deviation[]; // material deviations, largest first
  primary: Deviation | null;
}

// Deviations below this R-cost are noise — not surfaced.
const MIN_COST_R = 0.05;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Signed "how much worse than plan" in price units, oriented by trade direction. */
function worseBy(direction: "LONG" | "SHORT", planned: number, actual: number): number {
  // For a LONG a higher fill is worse; for a SHORT a lower fill is worse.
  return direction === "LONG" ? actual - planned : planned - actual;
}

export function computeDeviations(input: DeviationInput): TradeDeviations {
  const { direction, plannedEntry, plannedStopLoss, plannedTarget, actualEntry, actualExit, actualRR } = input;
  const deviations: Deviation[] = [];

  const riskDistance =
    plannedEntry != null && plannedStopLoss != null ? Math.abs(plannedEntry - plannedStopLoss) : null;

  const add = (cause: DeviationCause, costR: number) => {
    if (costR >= MIN_COST_R) deviations.push({ cause, label: DEVIATION_LABEL[cause], costR: round2(costR) });
  };

  // Entry: a worse-than-planned fill = chased / late entry.
  if (riskDistance && riskDistance > 0 && plannedEntry != null && actualEntry != null) {
    const slip = worseBy(direction, plannedEntry, actualEntry);
    if (slip > 0) add("late-entry", slip / riskDistance);
  }

  // Exit: winners closed before target = premature; losers run past the stop = overrun.
  if (riskDistance && riskDistance > 0 && actualExit != null && actualRR != null) {
    if (actualRR > 0 && plannedTarget != null) {
      const missed = worseBy(direction, actualExit, plannedTarget); // target is "ahead" of exit
      if (missed > 0) add("premature-exit", missed / riskDistance);
    } else if (actualRR < 0 && plannedStopLoss != null) {
      const overrun = worseBy(direction, actualExit, plannedStopLoss); // exit ran past the stop
      if (overrun > 0) add("loss-overrun", overrun / riskDistance);
    }
  }

  // Risk: sized above the planned/strategy budget.
  if (
    input.plannedRiskPercent != null &&
    input.plannedRiskPercent > 0 &&
    input.actualRiskPercent != null &&
    input.actualRiskPercent > input.plannedRiskPercent
  ) {
    add("increased-risk", (input.actualRiskPercent - input.plannedRiskPercent) / input.plannedRiskPercent);
  }

  deviations.sort((a, b) => b.costR - a.costR);
  return { deviations, primary: deviations[0] ?? null };
}

export interface DeviationCauseStat {
  cause: DeviationCause;
  label: string;
  occurrences: number;
  totalCostR: number;
  avgCostR: number;
}

/** Aggregates trades' PRIMARY deviations into per-cause occurrence + R-cost stats,
 *  ranked by total cost — the Psychology Lab's "what is execution costing me?" view. */
export function aggregateDeviationCauses(primaries: (Deviation | null)[]): DeviationCauseStat[] {
  const byCause = new Map<DeviationCause, { occurrences: number; totalCostR: number }>();
  for (const p of primaries) {
    if (!p) continue;
    const stat = byCause.get(p.cause) ?? { occurrences: 0, totalCostR: 0 };
    stat.occurrences += 1;
    stat.totalCostR = round2(stat.totalCostR + p.costR);
    byCause.set(p.cause, stat);
  }

  return [...byCause.entries()]
    .map(([cause, s]) => ({
      cause,
      label: DEVIATION_LABEL[cause],
      occurrences: s.occurrences,
      totalCostR: s.totalCostR,
      avgCostR: round2(s.totalCostR / s.occurrences),
    }))
    .sort((a, b) => b.totalCostR - a.totalCostR);
}
