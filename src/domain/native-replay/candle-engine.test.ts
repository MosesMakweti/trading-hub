import { describe, expect, it } from "vitest";

import { aggregateCandles, type EngineCandle } from "./candle-engine";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "./timeframes";
import { formatWallClock } from "./wall-clock";
import { barsOf, walk, wc, type FixtureBar } from "./testing/m1-fixtures";

const view = (c: EngineCandle) => ({ t: formatWallClock(c.time), o: c.open, h: c.high, l: c.low, c: c.close, v: c.tickVolume, n: c.barCount, state: c.state });
const run = (list: FixtureBar[], timeframe: ReplayTimeframe, cutoff: string, spread = false) =>
  aggregateCandles(barsOf(list, { spread }), { timeframe, cutoff: wc(cutoff) }).map(view);

describe("aggregation golden tests (hand-calculated)", () => {
  // Ten M1 bars 09:00–09:09 (integer prices, e.g. 1.07843 → 107843).
  const tenBars: FixtureBar[] = [
    { t: "2024-05-14T09:00", o: 107843, h: 107850, l: 107840, c: 107848, v: 5 },
    { t: "2024-05-14T09:01", o: 107848, h: 107861, l: 107846, c: 107859, v: 7 },
    { t: "2024-05-14T09:02", o: 107859, h: 107860, l: 107831, c: 107835, v: 9 },
    { t: "2024-05-14T09:03", o: 107835, h: 107842, l: 107829, c: 107840, v: 4 },
    { t: "2024-05-14T09:04", o: 107840, h: 107845, l: 107838, c: 107844, v: 6 },
    { t: "2024-05-14T09:05", o: 107844, h: 107870, l: 107844, c: 107868, v: 11 },
    { t: "2024-05-14T09:06", o: 107868, h: 107869, l: 107852, c: 107855, v: 3 },
    { t: "2024-05-14T09:07", o: 107855, h: 107858, l: 107820, c: 107822, v: 8 },
    { t: "2024-05-14T09:08", o: 107822, h: 107830, l: 107815, c: 107829, v: 2 },
    { t: "2024-05-14T09:09", o: 107829, h: 107833, l: 107825, c: 107831, v: 1 },
  ];

  it("M5: two buckets with first-open / max-high / min-low / last-close / summed volume", () => {
    expect(run(tenBars, "M5", "2024-05-14T09:09")).toEqual([
      { t: "2024-05-14T09:00", o: 107843, h: 107861, l: 107829, c: 107844, v: 31, n: 5, state: "COMPLETED" },
      { t: "2024-05-14T09:05", o: 107844, h: 107870, l: 107815, c: 107831, v: 25, n: 5, state: "COMPLETED" },
    ]);
  });

  it("M15 / M30 / H1: one bucket, FORMING until its last minute is reached", () => {
    const one = { t: "2024-05-14T09:00", o: 107843, h: 107870, l: 107815, c: 107831, v: 56, n: 10, state: "FORMING" };
    expect(run(tenBars, "M15", "2024-05-14T09:09")).toEqual([one]);
    expect(run(tenBars, "M30", "2024-05-14T09:09")).toEqual([one]);
    expect(run(tenBars, "H1", "2024-05-14T09:09")).toEqual([one]);
    // Reaching the bucket's last minute completes it even though 09:10–09:14 had no bars (no ticks).
    expect(run(tenBars, "M15", "2024-05-14T09:14")[0].state).toBe("COMPLETED");
  });

  it("H4 boundary 03:59 | 04:00 and 07:59 | 08:00", () => {
    const bars: FixtureBar[] = [
      { t: "2024-05-14T00:00", o: 100, h: 110, l: 95, c: 105 },
      { t: "2024-05-14T03:59", o: 105, h: 120, l: 104, c: 118 },
      { t: "2024-05-14T04:00", o: 118, h: 119, l: 90, c: 92 },
      { t: "2024-05-14T07:59", o: 92, h: 97, l: 91, c: 96 },
      { t: "2024-05-14T08:00", o: 96, h: 101, l: 96, c: 100 },
    ];
    expect(run(bars, "H4", "2024-05-14T11:59")).toEqual([
      { t: "2024-05-14T00:00", o: 100, h: 120, l: 95, c: 118, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-05-14T04:00", o: 118, h: 119, l: 90, c: 96, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-05-14T08:00", o: 96, h: 101, l: 96, c: 100, v: 1, n: 1, state: "COMPLETED" },
    ]);
  });

  it("D1 boundary at server midnight", () => {
    const bars: FixtureBar[] = [
      { t: "2024-05-14T00:00", o: 200, h: 210, l: 198, c: 205 },
      { t: "2024-05-14T23:59", o: 205, h: 207, l: 190, c: 191 },
      { t: "2024-05-15T00:00", o: 191, h: 230, l: 191, c: 229 },
    ];
    expect(run(bars, "D1", "2024-05-15T00:00")).toEqual([
      { t: "2024-05-14T00:00", o: 200, h: 210, l: 190, c: 191, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-05-15T00:00", o: 191, h: 230, l: 191, c: 229, v: 1, n: 1, state: "FORMING" },
    ]);
  });

  it("W1: Saturday closes the week, Sunday opens the next", () => {
    const bars: FixtureBar[] = [
      { t: "2024-05-06T00:00", o: 300, h: 305, l: 299, c: 304 }, // Mon
      { t: "2024-05-10T23:59", o: 304, h: 340, l: 301, c: 333 }, // Fri
      { t: "2024-05-12T22:00", o: 333, h: 334, l: 280, c: 281 }, // Sun evening open
      { t: "2024-05-13T09:00", o: 281, h: 290, l: 279, c: 289 }, // Mon
    ];
    expect(run(bars, "W1", "2024-05-18T23:59")).toEqual([
      { t: "2024-05-05T00:00", o: 300, h: 340, l: 299, c: 333, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-05-12T00:00", o: 333, h: 334, l: 279, c: 289, v: 2, n: 2, state: "COMPLETED" },
    ]);
  });

  it("MN1: January → February (leap) → March, and December → January", () => {
    const bars: FixtureBar[] = [
      { t: "2023-12-29T10:00", o: 10, h: 12, l: 9, c: 11 },
      { t: "2024-01-02T00:00", o: 11, h: 15, l: 10, c: 14 },
      { t: "2024-01-31T23:59", o: 14, h: 16, l: 13, c: 15 },
      { t: "2024-02-01T00:00", o: 15, h: 18, l: 15, c: 17 },
      { t: "2024-02-29T23:59", o: 17, h: 17, l: 12, c: 13 },
      { t: "2024-03-01T00:00", o: 13, h: 14, l: 13, c: 14 },
    ];
    expect(run(bars, "MN1", "2024-03-01T00:00")).toEqual([
      { t: "2023-12-01T00:00", o: 10, h: 12, l: 9, c: 11, v: 1, n: 1, state: "COMPLETED" },
      { t: "2024-01-01T00:00", o: 11, h: 16, l: 10, c: 15, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-02-01T00:00", o: 15, h: 18, l: 12, c: 13, v: 2, n: 2, state: "COMPLETED" },
      { t: "2024-03-01T00:00", o: 13, h: 14, l: 13, c: 14, v: 1, n: 1, state: "FORMING" },
    ]);
  });

  it("spread is the minimum, never a sum; absent volume stays null", () => {
    const bars = barsOf(
      [
        { t: "2024-05-14T09:00", o: 1, h: 2, l: 1, c: 2, s: 7 },
        { t: "2024-05-14T09:01", o: 2, h: 3, l: 2, c: 3, s: 3 },
        { t: "2024-05-14T09:02", o: 3, h: 3, l: 2, c: 2, s: 5 },
      ],
      { spread: true },
    );
    expect(aggregateCandles(bars, { timeframe: "M5", cutoff: wc("2024-05-14T09:02") })[0].spread).toBe(3);
    const noVolume = { ...bars, tickVolume: null, spread: null };
    const [c] = aggregateCandles(noVolume, { timeframe: "M5", cutoff: wc("2024-05-14T09:02") });
    expect(c.tickVolume).toBeNull();
    expect(c.spread).toBeNull();
  });
});

describe("progressive candle formation — M30 09:00–09:29", () => {
  // Thirty hand-specified M1 bars. Running extremes are chosen so each
  // checkpoint changes high/low/close in a way that's easy to verify.
  const closes = [
    1000, 1004, 1002, 1008, 1006, // 09:00–09:04
    1001, 997, 999, 1003, 1005, // 09:05–09:09
    1010, 1012, 1009, 1007, 1011, // 09:10–09:14
    1013, 1015, 1014, // 09:15–09:17
    1020, 990, 1016, 1018, 1017, 1019, 1021, 1022, 1018, 1016, 1015, 1014, // 09:18–09:29
  ];
  const bars = walk("2024-05-14T09:00", closes, { wick: 1, volume: 10 });
  const at = (cutoff: string) => run(bars, "M30", cutoff);

  it("after 1 M1 (09:00): the candle is that single bar", () => {
    expect(at("2024-05-14T09:00")).toEqual([{ t: "2024-05-14T09:00", o: 1000, h: 1001, l: 999, c: 1000, v: 10, n: 1, state: "FORMING" }]);
  });

  it("after 5 M1 (09:04): high from 09:03, close of 09:04", () => {
    // highs: 1001,1005,1005,1009,1009 → 1009; lows: 999,999,1001,1001,1005 → 999
    expect(at("2024-05-14T09:04")).toEqual([{ t: "2024-05-14T09:00", o: 1000, h: 1009, l: 999, c: 1006, v: 50, n: 5, state: "FORMING" }]);
  });

  it("after 18 M1 (09:17): only 09:00–09:17 — not the 09:18 spike (1021) or 09:19 drop (989)", () => {
    // max high through 09:17 = 09:16 (1015+1=1016); min low = 09:06 (997-1=996); close 09:17 = 1014
    expect(at("2024-05-14T09:17")).toEqual([{ t: "2024-05-14T09:00", o: 1000, h: 1016, l: 996, c: 1014, v: 180, n: 18, state: "FORMING" }]);
  });

  it("after 30 M1 (09:29): the final, completed M30 candle", () => {
    // 09:18 high = 1021, 09:19 low = 989 (open 1020 → close 990, wick 1), close 09:29 = 1014
    expect(at("2024-05-14T09:29")).toEqual([{ t: "2024-05-14T09:00", o: 1000, h: 1023, l: 989, c: 1014, v: 300, n: 30, state: "COMPLETED" }]);
  });

  it("the same bucket keeps its identity (open time and open) as it develops", () => {
    const opens = ["09:00", "09:04", "09:17", "09:29"].map((m) => at(`2024-05-14T${m}`)[0]);
    expect(new Set(opens.map((c) => `${c.t}|${c.o}`)).size).toBe(1);
  });
});

describe("no lookahead", () => {
  const normal = walk("2024-05-14T09:00", Array.from({ length: 18 }, (_, i) => 1000 + (i % 3)), { wick: 1, volume: 10 });
  const future: FixtureBar[] = [
    { t: "2024-05-14T09:18", o: 1001, h: 99_999, l: 1, c: 50_000, v: 1_000_000 },
    { t: "2024-05-14T09:45", o: 50_000, h: 88_888, l: 2, c: 3, v: 2_000_000 },
    { t: "2024-05-14T13:00", o: 3, h: 77_777, l: 3, c: 77_000, v: 3_000_000 },
    { t: "2024-05-20T00:00", o: 77_000, h: 66_666, l: 4, c: 5, v: 4_000_000 },
  ];
  const all = [...normal, ...future];

  it("a spike one minute after the cutoff never reaches high, low, close or volume — any timeframe", () => {
    for (const tf of REPLAY_TIMEFRAMES) {
      const candles = run(all, tf, "2024-05-14T09:17");
      const last = candles[candles.length - 1];
      expect(last.h, tf).toBeLessThan(1010);
      expect(last.l, tf).toBeGreaterThan(990);
      expect(last.c, tf).toBe(normal[17].c);
      expect(candles.reduce((sum, c) => sum + (c.v ?? 0), 0), tf).toBe(180); // 18 visible bars × 10
      expect(candles.every((c) => c.h < 1010 && c.l > 990), tf).toBe(true);
    }
  });

  it("the engine ignores bars after the cutoff even when a caller passes them", () => {
    const bars = barsOf(all);
    const out = aggregateCandles(bars, { timeframe: "D1", cutoff: wc("2024-05-14T09:17") });
    expect(out).toHaveLength(1);
    expect(out[0].lastBarTime).toBe(wc("2024-05-14T09:17"));
  });
});

describe("cross-timeframe: one replay position for every timeframe", () => {
  const history = walk("2024-05-14T00:00", Array.from({ length: 9 * 60 + 38 }, (_, i) => 5000 + Math.round(20 * Math.sin(i / 17))), { wick: 3, volume: 1 });
  const plantedFuture: FixtureBar[] = [
    { t: "2024-05-14T09:38", o: 5000, h: 900_000, l: 1, c: 800_000, v: 9_000_000 },
    { t: "2024-05-14T10:00", o: 800_000, h: 950_000, l: 2, c: 7, v: 9_000_000 },
    { t: "2024-05-15T03:00", o: 7, h: 990_000, l: 1, c: 990_000, v: 9_000_000 },
  ];
  const cutoff = "2024-05-14T09:37";
  const lastVisible = history[history.length - 1];

  it("M1…H4 (and D1/W1/MN1) at 09:37 show nothing after 09:37", () => {
    const maxVisibleHigh = Math.max(...history.map((b) => b.h));
    const minVisibleLow = Math.min(...history.map((b) => b.l));
    for (const tf of ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"] as const) {
      const candles = run([...history, ...plantedFuture], tf, cutoff);
      const last = candles[candles.length - 1];
      expect(candles.every((c) => c.h <= maxVisibleHigh && c.l >= minVisibleLow), tf).toBe(true);
      expect(last.c, `${tf} close = M1 09:37 close`).toBe(lastVisible.c);
      expect(candles.reduce((s, c) => s + (c.v ?? 0), 0), tf).toBe(history.length);
      expect(last.state, tf).toBe(tf === "M1" ? "COMPLETED" : "FORMING");
    }
  });

  it("only the final bucket is ever FORMING", () => {
    for (const tf of REPLAY_TIMEFRAMES) {
      const candles = run(history, tf, cutoff);
      expect(candles.slice(0, -1).every((c) => c.state === "COMPLETED"), tf).toBe(true);
    }
  });
});
