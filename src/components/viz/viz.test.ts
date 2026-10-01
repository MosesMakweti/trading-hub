import { describe, expect, it } from "vitest";

import {
  daySpan,
  formatDateLong,
  formatDateRange,
  formatDateTick,
  formatMoney,
  formatMoneyCompact,
  formatPct,
  formatR,
  formatTick,
} from "./format";
import { annotateSeries, baselineOffset, maxAbs, niceTicks, paddedDomain, shares, timeTickIndices } from "./series";
import { dayTint, identityColorMap, polarityOf, SERIES, seriesColor, VIZ } from "./tokens";

describe("viz/format", () => {
  it("formats R with a true minus and explicit plus", () => {
    expect(formatR(1.254)).toBe("+1.25R");
    expect(formatR(-0.5)).toBe("−0.50R");
    expect(formatR(0)).toBe("0.00R");
    expect(formatR(-0.0001)).toBe("0.00R"); // rounds to zero → no sign
    expect(formatR(null)).toBe("—");
    expect(formatR(2, 1, false)).toBe("2.0R");
  });

  it("formats money and percent", () => {
    expect(formatMoney(12480)).toBe("$12,480");
    expect(formatMoney(-1204.4)).toBe("−$1,204");
    expect(formatMoney(350, { signed: true })).toBe("+$350");
    expect(formatPct(3.24, 1, true)).toBe("+3.2%");
    expect(formatPct(-1, 1)).toBe("−1.0%");
    expect(formatPct(Number.NaN)).toBe("—");
  });

  it("compacts money for axis ticks", () => {
    expect(formatMoneyCompact(950)).toBe("$950");
    expect(formatMoneyCompact(1240)).toBe("$1.2k");
    expect(formatMoneyCompact(12_400)).toBe("$12k");
    expect(formatMoneyCompact(1_300_000)).toBe("$1.3M");
    expect(formatMoneyCompact(-2500)).toBe("−$2.5k");
    expect(formatMoneyCompact(0.2, { signed: true })).toBe("$0");
  });

  it("formats axis ticks per unit", () => {
    expect(formatTick(2, "r")).toBe("2R");
    expect(formatTick(-1.5, "r")).toBe("−1.5R");
    expect(formatTick(0, "r")).toBe("0R");
    expect(formatTick(12.5, "percent")).toBe("12.5%");
    expect(formatTick(3000, "money")).toBe("$3k");
  });

  it("picks date tick granularity from the span", () => {
    expect(formatDateTick("2026-09-18", 30)).toBe("Sep 18");
    expect(formatDateTick("2026-09-18", 365)).toBe("Sep '26");
    expect(formatDateTick("2026-09-18", 1200)).toBe("2026");
    expect(daySpan("2026-09-01", "2026-10-01")).toBe(30);
  });

  it("formats long dates and ranges without timezone drift", () => {
    expect(formatDateLong("2026-10-02")).toBe("Fri, Oct 2, 2026");
    expect(formatDateRange("2026-09-02", "2026-10-01")).toBe("Sep 2 – Oct 1, 2026");
    expect(formatDateRange("2025-12-20", "2026-01-05")).toBe("Dec 20, 2025 – Jan 5, 2026");
  });
});

describe("viz/series", () => {
  const pts = (values: number[]) => values.map((value, i) => ({ x: `d${i}`, value }));

  it("annotates change, peak and distance from peak", () => {
    const { points, summary } = annotateSeries(pts([1, 3, 2, 4, 1.5]));
    expect(points.map((p) => p.change)).toEqual([1, 2, -1, 2, -2.5]);
    expect(points.map((p) => p.peak)).toEqual([1, 3, 3, 4, 4]);
    expect(points.map((p) => p.fromPeak)).toEqual([0, 0, 1, 0, 2.5]);
    expect(points.map((p) => p.isNewHigh)).toEqual([true, true, false, true, false]);
    expect(summary).toMatchObject({
      start: 0,
      end: 1.5,
      change: 1.5,
      high: { index: 3, value: 4 },
      low: { index: 0, value: 1 },
      maxDrawdown: { peakIndex: 3, troughIndex: 4, amount: 2.5 },
      ups: 3,
      downs: 2,
    });
  });

  it("measures from a money baseline and treats the opening level as a peak", () => {
    const { points, summary } = annotateSeries(pts([9800, 9600, 10200]), 10_000);
    expect(points[0].change).toBe(-200);
    expect(points[1].fromPeak).toBe(400);
    expect(summary?.maxDrawdown).toEqual({ peakIndex: -1, troughIndex: 1, amount: 400 });
    expect(summary?.change).toBe(200);
  });

  it("returns no drawdown for a monotonic series and handles empty input", () => {
    expect(annotateSeries(pts([1, 2, 3])).summary?.maxDrawdown).toBeNull();
    expect(annotateSeries([])).toEqual({ points: [], summary: null });
  });

  it("computes the baseline gradient offset from the top", () => {
    expect(baselineOffset(-2, 6, 0)).toBe(0.75);
    expect(baselineOffset(1, 5, 0)).toBe(1); // entirely above → all "above" colour
    expect(baselineOffset(-5, -1, 0)).toBe(0); // entirely below
    expect(baselineOffset(3, 3, 0)).toBe(1);
  });

  it("rounds axes to nice ticks", () => {
    expect(niceTicks(-0.3, 5.9)).toEqual({ domain: [-2, 6], ticks: [-2, 0, 2, 4, 6] });
    expect(niceTicks(98_200, 106_400)).toEqual({ domain: [97_500, 107_500], ticks: [97_500, 100_000, 102_500, 105_000, 107_500] });
    expect(niceTicks(0, 0.9).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(3, 3).domain[0]).toBeLessThan(3);
  });

  it("places time ticks on calendar boundaries without repeats", () => {
    const keys = ["2026-04-02", "2026-04-20", "2026-05-03", "2026-05-30", "2026-06-01", "2026-09-25"];
    expect(timeTickIndices(keys)).toEqual([0, 2, 4, 5]); // Apr, May, Jun, Sep
    const week = ["2026-09-14", "2026-09-16", "2026-09-21", "2026-09-22", "2026-09-28"];
    expect(timeTickIndices(week)).toEqual([0, 2, 4]); // Mondays' weeks
    expect(timeTickIndices(keys, 2)).toEqual([0, 4]);
    expect(timeTickIndices([])).toEqual([]);
  });

  it("pads domains, finds max magnitude and computes shares", () => {
    expect(paddedDomain([0, 10], { pad: 0.1 })).toEqual([-1, 11]);
    expect(paddedDomain([5, 6], { include: 0, pad: 0 })).toEqual([0, 6]);
    expect(maxAbs([-3, 2, Number.NaN])).toBe(3);
    expect(shares([3, 1, 0, -2])).toEqual([75, 25, 0, 0]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });
});

describe("viz/tokens", () => {
  it("assigns identity colours by stable key order and folds the tail into neutral", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    const map = identityColorMap(keys);
    expect(map.get("a")).toBe(SERIES[0]);
    expect(map.get("f")).toBe(SERIES[5]);
    expect(map.get("g")).toBe(VIZ.neutral);
    // Duplicate keys don't consume a slot.
    expect(identityColorMap(["a", "a", "b"]).get("b")).toBe(SERIES[1]);
    expect(seriesColor(-1)).toBe(VIZ.neutral);
  });

  it("classifies polarity with an epsilon", () => {
    expect(polarityOf(0.5)).toBe("profit");
    expect(polarityOf(-0.5)).toBe("loss");
    expect(polarityOf(0)).toBe("neutral");
    expect(polarityOf(null)).toBe("neutral");
  });

  it("scales day tints with magnitude and caps them for legibility", () => {
    expect(dayTint(0)).toBeUndefined();
    expect(dayTint(null)).toBeUndefined();
    expect(dayTint(1.5)).toBe(`color-mix(in oklch, ${VIZ.profit} 19%, var(--card))`);
    expect(dayTint(-9)).toBe(`color-mix(in oklch, ${VIZ.loss} 30%, var(--card))`);
  });
});
