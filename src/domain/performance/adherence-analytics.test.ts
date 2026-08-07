import { describe, expect, it } from "vitest";

import {
  confluenceCombinations,
  confluenceLeaderboard,
  setupQualityBuckets,
  setupQualityTrend,
  summarizeAdherence,
  type AdherenceTradePoint,
} from "./adherence-analytics";

const point = (over: Partial<AdherenceTradePoint>): AdherenceTradePoint => ({
  win: null,
  dateKey: "2026-01-15",
  confluences: [],
  confluencePercent: null,
  executionPercent: null,
  tradeQualityPercent: null,
  setupScore: null,
  setupRating: null,
  ...over,
});

describe("summarizeAdherence", () => {
  it("averages adherence fields over the points that have them", () => {
    const s = summarizeAdherence([
      point({ confluencePercent: 100, executionPercent: 50, tradeQualityPercent: 75 }),
      point({ confluencePercent: 50, executionPercent: null, tradeQualityPercent: 50 }),
    ]);
    expect(s.avgConfluenceAdherence).toBe(75); // (100 + 50) / 2
    expect(s.avgExecutionAdherence).toBe(50); // only the one non-null
    expect(s.avgTradeQuality).toBe(62.5); // (75 + 50) / 2
  });

  it("splits average confluence count by win vs loss (open trades excluded)", () => {
    const s = summarizeAdherence([
      point({ win: true, confluences: ["A", "B", "C"] }),
      point({ win: true, confluences: ["A"] }),
      point({ win: false, confluences: ["A", "B"] }),
      point({ win: null, confluences: ["A", "B", "C", "D"] }), // open — ignored in splits
    ]);
    expect(s.avgConfluencesOnWinners).toBe(2); // (3 + 1) / 2
    expect(s.avgConfluencesOnLosers).toBe(2); // 2 / 1
  });

  it("returns null averages when there is no data", () => {
    const s = summarizeAdherence([]);
    expect(s.avgConfluenceAdherence).toBeNull();
    expect(s.avgConfluencesOnWinners).toBeNull();
    expect(s.confluenceLeaderboard).toEqual([]);
    expect(s.confluenceCombinations).toEqual([]);
    expect(s.setupQualityBuckets).toEqual([]);
    expect(s.setupQualityTrend).toEqual([]);
  });
});

describe("setupQualityBuckets", () => {
  it("groups by rating band in quality order with win rate + avg score", () => {
    const buckets = setupQualityBuckets([
      point({ setupRating: "A+", setupScore: 100, win: true }),
      point({ setupRating: "A+", setupScore: 96, win: true }),
      point({ setupRating: "C", setupScore: 70, win: false }),
      point({ setupRating: "C", setupScore: 68, win: true }),
    ]);
    expect(buckets.map((b) => b.rating)).toEqual(["A+", "C"]); // quality order, empty bands dropped
    expect(buckets[0]).toMatchObject({ trades: 2, wins: 2, winRate: 100, avgScore: 98 });
    expect(buckets[1]).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50, avgScore: 69 });
  });

  it("ignores trades with no rating", () => {
    expect(setupQualityBuckets([point({ setupRating: null, setupScore: null })])).toEqual([]);
  });
});

describe("setupQualityTrend", () => {
  it("averages setup score per month, chronologically", () => {
    const trend = setupQualityTrend([
      point({ dateKey: "2026-02-03", setupScore: 80 }),
      point({ dateKey: "2026-01-20", setupScore: 60 }),
      point({ dateKey: "2026-01-05", setupScore: 90 }),
      point({ dateKey: "2026-02-28", setupScore: null }), // no score → excluded
    ]);
    expect(trend).toEqual([
      { month: "2026-01", avgScore: 75, trades: 2 },
      { month: "2026-02", avgScore: 80, trades: 1 },
    ]);
  });
});

describe("confluenceCombinations", () => {
  it("groups by the exact confluence set and ranks by win rate (min 2 trades)", () => {
    const board = confluenceCombinations([
      point({ win: true, confluences: ["Liquidity Sweep", "MSS", "FVG"] }),
      point({ win: true, confluences: ["FVG", "MSS", "Liquidity Sweep"] }), // same combo, reordered
      point({ win: false, confluences: ["Liquidity Sweep", "MSS"] }),
      point({ win: true, confluences: ["Liquidity Sweep", "MSS"] }),
    ]);
    const triple = board.find((b) => b.confluences.length === 3)!;
    const double = board.find((b) => b.confluences.length === 2)!;
    expect(triple).toMatchObject({ trades: 2, wins: 2, winRate: 100 });
    expect(triple.confluences).toEqual(["FVG", "Liquidity Sweep", "MSS"]); // sorted
    expect(double).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50 });
    expect(board[0]).toBe(triple); // higher win rate first
  });

  it("excludes combinations seen on fewer than minTrades", () => {
    const board = confluenceCombinations([point({ win: true, confluences: ["A", "B"] })]);
    expect(board).toEqual([]);
  });
});

describe("confluenceLeaderboard", () => {
  it("ranks confluences by win rate, then volume, and de-dupes within a trade", () => {
    const board = confluenceLeaderboard([
      point({ win: true, confluences: ["FVG", "MSS"] }),
      point({ win: true, confluences: ["FVG", "fvg"] }), // duplicate collapses
      point({ win: false, confluences: ["MSS"] }),
    ]);
    const fvg = board.find((b) => b.name === "FVG")!;
    const mss = board.find((b) => b.name === "MSS")!;
    expect(fvg).toMatchObject({ trades: 2, wins: 2, losses: 0, winRate: 100 });
    expect(mss).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50 });
    expect(board[0].name).toBe("FVG"); // higher win rate ranks first
  });

  it("leaves winRate null for confluences with no decided trades", () => {
    const board = confluenceLeaderboard([point({ win: null, confluences: ["Liquidity"] })]);
    expect(board[0]).toMatchObject({ name: "Liquidity", trades: 1, winRate: null });
  });
});
