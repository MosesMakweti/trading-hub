import { describe, expect, it } from "vitest";

import { dec } from "@/domain/execution/precision";
import { crossesWeekend, currentFloors, evaluateMinute, evaluatePayout, initialRuleState, passConditions, type RuleState } from "./prop-rules";
import { parseRules, type SimRulesInput } from "./rules";

const START = 25_000;
const rules = (r: SimRulesInput) => parseRules(r);
const at = (minute: number, day: number, balance: number, equity: number, adverse = equity, openPositions = 0) => ({
  minute, tradingDay: day, balance: dec(balance), equity: dec(equity), adverseEquity: dec(adverse), openPositions,
});
const fresh = (): RuleState => initialRuleState(START, 0);

describe("maximum loss models", () => {
  it("STATIC: floor = start − 10% = 22,500, and never moves", () => {
    const r = rules({ maxLoss: { limitPercent: 10, model: "STATIC" } });
    const s = fresh();
    expect(evaluateMinute(r, s, at(1, 0, 30_000, 30_000)).kind).toBe("CONTINUE");
    expect(currentFloors(r, s).maxLossFloor!.toFixed(2)).toBe("22500.00");
    expect(evaluateMinute(r, s, at(2, 0, 25_000, 22_500)).kind).toBe("CONTINUE"); // at the floor is not below it
    expect(evaluateMinute(r, s, at(3, 0, 25_000, 22_600, 22_499.99))).toMatchObject({ kind: "BREACH", rule: "MAX_LOSS", basis: "EQUITY" });
  });

  it("EOD_TRAILING: the floor moves only at the daily reset, to the previous day's end value − 5% of start", () => {
    const r = rules({ maxLoss: { limitPercent: 5, model: "EOD_TRAILING", basis: "EQUITY" } });
    const s = fresh();
    evaluateMinute(r, s, at(10, 0, 25_000, 27_000)); // intraday peak — ignored by EOD trailing
    expect(currentFloors(r, s).maxLossFloor!.toFixed(2)).toBe("23750.00");
    evaluateMinute(r, s, at(20, 0, 26_000, 26_000)); // day 0 ends at 26,000
    evaluateMinute(r, s, at(1500, 1, 26_000, 26_000)); // reset → high-water 26,000
    expect(currentFloors(r, s).maxLossFloor!.toFixed(2)).toBe("24750.00");
    expect(evaluateMinute(r, s, at(1501, 1, 26_000, 25_000, 24_749))).toMatchObject({ kind: "BREACH", rule: "MAX_LOSS" });
  });

  it("INTRADAY_TRAILING: the floor follows the highest equity at any minute", () => {
    const r = rules({ maxLoss: { limitPercent: 5, model: "INTRADAY_TRAILING" } });
    const s = fresh();
    evaluateMinute(r, s, at(1, 0, 25_000, 26_500));
    expect(currentFloors(r, s).maxLossFloor!.toFixed(2)).toBe("25250.00");
    expect(evaluateMinute(r, s, at(2, 0, 25_000, 25_300, 25_249))).toMatchObject({ kind: "BREACH", rule: "MAX_LOSS" });
  });

  it("a trailing floor locked at the start stops rising at 25,000", () => {
    const r = rules({ maxLoss: { limitPercent: 5, model: "INTRADAY_TRAILING", trailingLockAtStart: true } });
    const s = fresh();
    evaluateMinute(r, s, at(1, 0, 25_000, 30_000));
    expect(currentFloors(r, s).maxLossFloor!.toFixed(2)).toBe("25000.00");
  });

  it("BALANCE basis ignores floating losses; EQUITY basis uses the minute's worst price", () => {
    const bal = rules({ maxLoss: { limitPercent: 10, basis: "BALANCE" } });
    expect(evaluateMinute(bal, fresh(), at(1, 0, 25_000, 20_000, 19_000, 1)).kind).toBe("CONTINUE");
    const eq = rules({ maxLoss: { limitPercent: 10, basis: "EQUITY" } });
    expect(evaluateMinute(eq, fresh(), at(1, 0, 25_000, 23_000, 22_000, 1))).toMatchObject({ kind: "BREACH", measured: dec(22_000) });
  });
});

describe("daily loss", () => {
  const dayStarting = (r: ReturnType<typeof rules>, balance: number, equity: number) => {
    const s = fresh();
    evaluateMinute(r, s, at(10, 0, balance, equity));
    evaluateMinute(r, s, at(1500, 1, balance, equity));
    return s;
  };

  it("INITIAL_BALANCE: day-start balance − 5% of the phase start (26,000 − 1,250 = 24,750)", () => {
    const r = rules({ dailyLoss: { limitPercent: 5, reference: "INITIAL_BALANCE" } });
    const s = dayStarting(r, 26_000, 26_000);
    expect(currentFloors(r, s).dailyLossFloor!.toFixed(2)).toBe("24750.00");
    expect(evaluateMinute(r, s, at(1501, 1, 26_000, 24_800, 24_749.99))).toMatchObject({ kind: "BREACH", rule: "DAILY_LOSS" });
  });

  it("DAY_START_BALANCE: 26,000 × 95% = 24,700", () => {
    const r = rules({ dailyLoss: { limitPercent: 5, reference: "DAY_START_BALANCE" } });
    expect(currentFloors(r, dayStarting(r, 26_000, 26_400)).dailyLossFloor!.toFixed(2)).toBe("24700.00");
  });

  it("DAY_START_HIGHER: max(26,000, 26,400) × 95% = 25,080", () => {
    const r = rules({ dailyLoss: { limitPercent: 5, reference: "DAY_START_HIGHER" } });
    expect(currentFloors(r, dayStarting(r, 26_000, 26_400)).dailyLossFloor!.toFixed(2)).toBe("25080.00");
  });

  it("resets at the configured broker hour, not at midnight", () => {
    const r = rules({ dailyResetHour: 17, dailyLoss: { limitPercent: 5, reference: "DAY_START_BALANCE" } });
    const s = initialRuleState(START, -1); // minute 0 is before the 17:00 reset of day 0
    evaluateMinute(r, s, at(1019, -1, 26_000, 26_000));
    expect(s.dayStartBalance).toBe("25000.00");
    evaluateMinute(r, s, at(1020, 0, 26_000, 26_000));
    expect(s.dayStartBalance).toBe("26000.00");
  });
});

describe("passing and failing", () => {
  const r = rules({ objective: { profitTargetPercent: 8, minTradingDays: 2, consistencyMaxDayPercent: 60, maxCalendarDays: 30 } });

  it("needs EVERY condition: target 27,000, flat, 2 trading days, best day ≤ 60% of profit", () => {
    const s = fresh();
    s.tradingDays = [0];
    // Day 0: +1,500 realized; at target? no (26,500).
    evaluateMinute(r, s, at(1, 0, 26_500, 26_500));
    // Day 1: +700 realized → 27,200 balance, but a position is still open.
    expect(evaluateMinute(r, s, at(1500, 1, 27_200, 27_300, 27_300, 1)).kind).toBe("CONTINUE");
    expect(passConditions(r, s, { balance: dec(27_200), openPositions: 1 }).unmet).toEqual([
      "Close every open position.",
      "Trade on 2 days (1 so far).",
      "Best day is 68.2% of profit; at most 60% allowed.",
    ]);
    s.tradingDays = [0, 1];
    // Day 2: +1,000 more → profits 1,500 / 700 / 1,000 → best day 46.9% ✓; flat ✓.
    expect(evaluateMinute(r, s, at(3000, 2, 28_200, 28_200))).toEqual({ kind: "PASS", minute: 3000 });
  });

  it("fails when the calendar-day limit ends first", () => {
    const s = fresh();
    expect(evaluateMinute(r, s, at(30 * 1440, 30, 25_100, 25_100))).toMatchObject({ kind: "FAIL" });
  });
});

describe("holding restrictions", () => {
  it("overnight: a position held through the reset breaches", () => {
    const r = rules({ holding: { allowOvernight: false } });
    const s = fresh();
    evaluateMinute(r, s, at(10, 0, 25_000, 25_000, 25_000, 1));
    expect(evaluateMinute(r, s, at(1500, 1, 25_000, 25_000, 25_000, 1), 1)).toMatchObject({ kind: "BREACH", rule: "OVERNIGHT_HOLDING" });
  });

  it("weekend: only a reset that crosses Saturday breaches", () => {
    // Day index d starts at minute d×1440 (reset 00:00); minute 0 = Thursday 1970-01-01, so day 2 = Saturday.
    expect(crossesWeekend(0, 1, 0)).toBe(false); // Thu → Fri
    expect(crossesWeekend(1, 4, 0)).toBe(true); // Fri → Mon
    const r = rules({ holding: { allowWeekend: false } });
    const s = initialRuleState(START, 1);
    expect(evaluateMinute(r, s, at(4 * 1440, 4, 25_000, 25_000, 25_000, 1), 1)).toMatchObject({ kind: "BREACH", rule: "WEEKEND_HOLDING" });
  });
});

describe("payouts", () => {
  const terms = { profitSplitPercent: 80, firstPayoutAfterDays: 14, cycleDays: 14, minPayoutAmount: 100, maxPayoutAmount: null, profitBufferPercent: 0, minTradingDaysPerCycle: 0 };

  it("the spec example: 27,000 on a 25,000 account at 80% → trader 1,600, firm 400, balance back to 25,000 via the ledger", () => {
    const p = evaluatePayout({ startingBalance: START, balance: 27_000, openPositions: 0, terms, daysSinceFunded: 20, daysSinceLastPayout: null, tradingDaysInCycle: 5 });
    expect(p.eligible).toBe(true);
    expect([p.eligibleProfit, p.grossPayout, p.traderShare, p.firmShare, p.balanceAfter].map((d) => d.toFixed(2))).toEqual(["2000.00", "2000.00", "1600.00", "400.00", "25000.00"]);
  });

  it("a 1% buffer stays in the account; a cap limits the gross; shares always sum to the gross", () => {
    const p = evaluatePayout({ startingBalance: START, balance: 27_000, openPositions: 0, terms: { ...terms, profitBufferPercent: 1, maxPayoutAmount: 1_500, profitSplitPercent: 85 }, daysSinceFunded: 20, daysSinceLastPayout: null, tradingDaysInCycle: 5 });
    expect([p.eligibleProfit, p.grossPayout, p.traderShare, p.firmShare, p.balanceAfter].map((d) => d.toFixed(2))).toEqual(["1750.00", "1500.00", "1275.00", "225.00", "25500.00"]);
  });

  it("lists every unmet condition: open positions, the waiting period, trading days, the minimum", () => {
    const p = evaluatePayout({ startingBalance: START, balance: 25_050, openPositions: 1, terms: { ...terms, minTradingDaysPerCycle: 4 }, daysSinceFunded: 3, daysSinceLastPayout: null, tradingDaysInCycle: 2 });
    expect(p.eligible).toBe(false);
    expect(p.reasons).toEqual([
      "Close every open position before requesting a payout.",
      "The first payout is available 14 days after funding (day 3).",
      "Trade on 4 days this cycle (2 so far).",
      "The minimum payout is 100.00.",
    ]);
  });
});
