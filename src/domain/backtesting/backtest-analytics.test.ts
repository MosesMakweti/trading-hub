import { describe, expect, it } from "vitest";

import { buildCanonicalTradeRow, type CanonicalTradeRowInput } from "@/domain/analytics/canonical-dataset";
import { summarizeBacktestRun, type BacktestOpportunityInput } from "./backtest-analytics";
import { summarizePeriod } from "@/domain/journal/period-summary";

/**
 * Exact-value fixtures for Backtesting Analytics, built through the REAL
 * canonical row builder with price-derived settlement inputs (settled +
 * settledRealizedR, as settlement-basis.ts produces for a closed backtest
 * trade). R sequence (chronological): +2, −1, +1.5, −1, +3, open, cancelled.
 */
let seq = 0;
function row(overrides: Partial<CanonicalTradeRowInput> & { dateKey: string; r?: number | null; open?: boolean; cancelled?: boolean }) {
  seq += 1;
  const { r = null, open = false, cancelled = false, ...rest } = overrides;
  return buildCanonicalTradeRow({
    tradeId: `t${seq}`,
    direction: "LONG",
    assetSymbol: "EURUSD",
    strategyId: "s1",
    strategyName: "London V3",
    session: "London",
    reviewLifecycleStatus: cancelled ? "CANCELLED_NEVER_TRIGGERED" : open ? null : "FULLY_CLOSED",
    validationState: null,
    overrideReason: null,
    setupTypeName: null,
    validationScore: null,
    dailyBiasSnapshot: null,
    plannedR: 2,
    actualRR: r,
    actualEntry: cancelled ? null : 1.1,
    actualStopLoss: 1.095,
    actualExit: null,
    resolvedInitialStop: 1.095,
    partials: [],
    settled: !open && !cancelled && r != null,
    settledRealizedR: open ? null : r,
    settledPnl: null,
    preTradeMoodTags: [],
    moodIntensity: null,
    behaviourLabels: [],
    adherencePercent: null,
    confluencePercent: null,
    executionPercent: null,
    tradeQualityPercent: null,
    psychologyPercent: null,
    ...rest,
  });
}

// 2024-05-13 Mon, 14 Tue, 15 Wed, 16 Thu, 17 Fri; 2024-06-03 Mon.
const rows = [
  row({ dateKey: "2024-05-13", r: 2, timeframe: "15m", confluences: ["HTF bias", "Liquidity sweep · Bullish"], executionConfirmations: ["MSS"], setupValid: true, preTradeMoodTags: ["CALM"], psychologyPercent: 90, adherencePercent: 100 }),
  row({ dateKey: "2024-05-14", r: -1, direction: "SHORT", session: "New York", timeframe: "5m", confluences: ["HTF bias"], setupValid: false, preTradeMoodTags: ["FOMO"], psychologyPercent: 40, adherencePercent: 50 }),
  row({ dateKey: "2024-05-15", r: 1.5, timeframe: "15m", confluences: ["Liquidity sweep · Bullish"], executionConfirmations: ["MSS"], setupValid: true, adherencePercent: 100 }),
  row({ dateKey: "2024-05-16", r: -1, assetSymbol: "GBPUSD", timeframe: "15m", setupValid: true, preTradeMoodTags: ["FOMO"] }),
  row({ dateKey: "2024-06-03", r: 3, timeframe: "1h", confluences: ["HTF bias"], setupValid: true }),
  row({ dateKey: "2024-06-03", open: true }),
  row({ dateKey: "2024-06-03", cancelled: true }),
];

const opportunities: BacktestOpportunityInput[] = [
  { status: "EXECUTED", setupValid: true, missReason: null, missedOutcome: null, missedRealizedR: null },
  { status: "EXECUTED", setupValid: true, missReason: null, missedOutcome: null, missedRealizedR: null },
  { status: "MISSED", setupValid: true, missReason: "HESITATION", missedOutcome: "MISSED_WIN", missedRealizedR: 2 },
  { status: "MISSED", setupValid: true, missReason: "FEAR", missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null },
  { status: "MISSED", setupValid: false, missReason: "OTHER", missedOutcome: null, missedRealizedR: null }, // invalid → excluded
  { status: "INVALIDATED", setupValid: true, missReason: null, missedOutcome: null, missedRealizedR: null },
];

const summary = summarizeBacktestRun(rows, opportunities, { startingBalance: 10_000, riskPercentPerTrade: 1, currency: "USD" });

describe("overview", () => {
  it("computes exact core statistics over finalized trades only", () => {
    const o = summary.overview;
    expect(o).toMatchObject({ totalTrades: 6, finalizedTrades: 5, openTrades: 1, cancelledIdeas: 1, wins: 3, losses: 2, breakevens: 0 });
    expect(o.winRate).toBe(60);
    expect(o.netR).toBeCloseTo(4.5);
    expect(o.averageR).toBeCloseTo(0.9);
    expect(o.expectancy).toBeCloseTo(0.9); // 0.6 × 2.1667 + 0.4 × (−1)
    expect(o.profitFactor).toBeCloseTo(6.5 / 2);
    expect(o.averageWinnerR).toBeCloseTo(6.5 / 3);
    expect(o.averageLoserR).toBeCloseTo(-1);
    expect(o.bestTradeR).toBe(3);
    expect(o.worstTradeR).toBe(-1);
    expect(o.longestWinStreak).toBe(1);
    expect(o.longestLossStreak).toBe(1);
  });
});

describe("cumulative R + drawdown", () => {
  it("follows simulated chronology with running peak and drawdown", () => {
    expect(summary.curve.map((p) => p.cumulativeR)).toEqual([2, 1, 2.5, 1.5, 4.5]);
    expect(summary.curve.map((p) => p.drawdownR)).toEqual([0, -1, 0, -1, 0]);
    expect(summary.curve.map((p) => p.index)).toEqual([1, 2, 3, 4, 5]);
    expect(summary.drawdown).toEqual({ maxDrawdownR: -1, peakR: 2, troughR: 1, currentDrawdownR: 0 });
  });

  it("orders by simulated date, never input order", () => {
    const shuffled = [rows[4], rows[0], rows[2], rows[1], rows[3]];
    const s = summarizeBacktestRun(shuffled, [], { startingBalance: null, riskPercentPerTrade: null, currency: null });
    expect(s.curve.map((p) => p.dateKey)).toEqual(["2024-05-13", "2024-05-14", "2024-05-15", "2024-05-16", "2024-06-03"]);
  });
});

describe("breakdowns", () => {
  const byKey = (stats: { key: string; totalR: number; finalizedCount: number }[]) =>
    Object.fromEntries(stats.map((s) => [s.key, [s.totalR, s.finalizedCount]]));

  it("asset, session, direction, timeframe, weekday, month", () => {
    expect(byKey(summary.breakdowns.asset)).toEqual({ EURUSD: [5.5, 4], GBPUSD: [-1, 1] });
    expect(byKey(summary.breakdowns.session)).toMatchObject({ London: [5.5, 4], "New York": [-1, 1] });
    expect(byKey(summary.breakdowns.direction)).toMatchObject({ LONG: [5.5, 4], SHORT: [-1, 1] });
    expect(byKey(summary.breakdowns.timeframe)).toEqual({ "15m": [2.5, 3], "5m": [-1, 1], "1h": [3, 1] });
    const weekday = byKey(summary.breakdowns.weekday);
    expect(weekday["1"]).toEqual([5, 2]); // Mondays: +2 (13 May) + +3 (3 Jun)
    expect(weekday["2"]).toEqual([-1, 1]);
    expect(byKey(summary.breakdowns.month)).toEqual({ "2024-05": [1.5, 4], "2024-06": [3, 1] });
    expect(summary.breakdowns.strategy).toEqual([]); // single strategy → not shown
  });

  it("confluences keep direction-specific variants separate; confirmations are descriptive groups", () => {
    expect(byKey(summary.confluences)).toEqual({ "HTF bias": [4, 3], "Liquidity sweep · Bullish": [3.5, 2] });
    expect(byKey(summary.executionConfirmations)).toEqual({ MSS: [3.5, 2] });
  });
});

describe("adherence, psychology, missed trades, simulation", () => {
  it("mandatory gate and adherence averages", () => {
    const gate = Object.fromEntries(summary.validation.mandatoryGate.map((g) => [g.key, [g.totalR, g.count]]));
    expect(gate).toEqual({ MANDATORY_MET: [5.5, 4], MANDATORY_MISSING: [-1, 1] });
    expect(summary.validation.averageAdherencePercent).toBeCloseTo(250 / 3);
    expect(summary.adherence.confluenceLeaderboard.find((c) => c.name === "HTF bias")).toMatchObject({ trades: 3, wins: 2, losses: 1 });
  });

  it("psychology is descriptive per tag", () => {
    const moods = Object.fromEntries(summary.psychology.moodTags.map((g) => [g.key, [g.totalR, g.count]]));
    expect(moods).toEqual({ CALM: [2, 1], FOMO: [-2, 2] });
    expect(summary.psychology.averagePsychologyPercent).toBe(65);
    expect(summary.psychology.psychologySample).toBe(2);
  });

  it("missed trades never invent R: only valid setups, outcomes as recorded", () => {
    expect(summary.missed).toMatchObject({ executedOpportunities: 2, missedOpportunities: 2, missRate: 50, invalidated: 1 });
    expect(summary.missed.outcomes).toEqual({ missedWin: 1, missedLoss: 0, missedBreakeven: 0, undetermined: 1 });
    expect(summary.missed.selfReportedMissedR).toBe(2);
  });

  it("simulated balance uses a fixed-risk model and stays secondary", () => {
    expect(summary.simulation).toMatchObject({ riskPerR: 100, endingBalance: 10_450, returnPercent: 4.5 });
    expect(summary.simulation?.maxDrawdownPercent).toBeCloseTo((-100 / 10_200) * 100);
  });
});

describe("empty and degenerate runs never produce NaN/Infinity", () => {
  it("brand-new run", () => {
    const s = summarizeBacktestRun([], [], { startingBalance: null, riskPercentPerTrade: null, currency: null });
    expect(s.overview).toMatchObject({ totalTrades: 0, winRate: null, expectancy: null, profitFactor: null, netR: 0 });
    expect(s.curve).toEqual([]);
    expect(s.drawdown).toBeNull();
    expect(s.missed.missRate).toBeNull();
    expect(s.simulation).toBeNull();
  });

  it("open trades only, and a single winning trade (no losses → profit factor null, not Infinity)", () => {
    const open = summarizeBacktestRun([row({ dateKey: "2024-05-13", open: true })], [], { startingBalance: null, riskPercentPerTrade: null, currency: null });
    expect(open.overview).toMatchObject({ totalTrades: 1, finalizedTrades: 0, winRate: null });
    const one = summarizeBacktestRun([row({ dateKey: "2024-05-13", r: 2 })], [], { startingBalance: 5000, riskPercentPerTrade: 0.5, currency: null });
    expect(one.overview.profitFactor).toBeNull();
    expect(one.drawdown).toEqual({ maxDrawdownR: 0, peakR: 2, troughR: 2, currentDrawdownR: 0 });
    expect(Number.isFinite(one.simulation!.maxDrawdownPercent)).toBe(true);
  });
});

describe("journal period summary", () => {
  it("sums weeks/months exactly from day summaries", () => {
    const days = [
      { dateKey: "2024-05-13", executedTradeCount: 1, totalRealizedR: 2, totalPnl: 0, wins: 1, losses: 0, breakevens: 0, missedCount: 1 },
      { dateKey: "2024-05-14", executedTradeCount: 2, totalRealizedR: -1, totalPnl: 0, wins: 0, losses: 1, breakevens: 1, missedCount: 0 },
      { dateKey: "2024-05-20", executedTradeCount: 0, totalRealizedR: 0, totalPnl: 0, wins: 0, losses: 0, breakevens: 0, missedCount: 2 },
      { dateKey: "2024-06-03", executedTradeCount: 1, totalRealizedR: 3, totalPnl: 0, wins: 1, losses: 0, breakevens: 0 },
    ];
    const week = new Set(["2024-05-13", "2024-05-14", "2024-05-15", "2024-05-16", "2024-05-17", "2024-05-18", "2024-05-19"]);
    expect(summarizePeriod(days, (k) => week.has(k))).toEqual({ trades: 3, totalR: 1, totalPnl: 0, wins: 1, losses: 1, breakevens: 1, missed: 1, tradingDays: 2 });
    expect(summarizePeriod(days, (k) => k.startsWith("2024-05"))).toMatchObject({ trades: 3, totalR: 1, missed: 3 });
    expect(summarizePeriod(days)).toMatchObject({ trades: 4, totalR: 4, tradingDays: 3, missed: 3 });
  });
});
