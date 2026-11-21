import { describe, expect, it } from "vitest";

import { buildGalleryComparisons, filterComparisons, galleryFilterOptions, NO_STRATEGY, orderActualImages } from "@/domain/trade-audit/gallery";
import type { AuditDayDTO, AuditImageDTO, AuditTradeDTO, ExpectedTradeDTO, LiveMissedOpportunityDTO, TradeAssessmentDTO } from "@/types/trade-audit";

const img = (id: string, category: string | null, provenance: AuditImageDTO["provenance"] = "SESSION"): AuditImageDTO => ({
  attachmentId: id,
  url: `/api/media/${id}`,
  fileName: `${id}.png`,
  caption: null,
  category,
  provenance,
  annotation: null,
  removable: provenance === "REVIEW",
});

const trade = (o: Partial<AuditTradeDTO>): AuditTradeDTO => ({
  id: "t1", tradeNumber: 1, dateKey: "2026-11-17", assetSymbol: "EURUSD", direction: "SHORT", strategyId: "s1", strategyName: "London Sweep",
  setupName: null, session: null, timeframe: null, entryTime: null, closedAt: null, plannedEntry: 1.0864, plannedStopLoss: 1.0879, plannedTarget: 1.0819,
  actualEntry: 1.0864, actualStopLoss: 1.0879, actualExit: 1.0821, positionSize: null, risk: null, plannedR: null, realizedR: 2.4, pnl: 240,
  outcome: "WIN", reasonForTrade: null, executionNotes: null, systemFlags: [], images: [], ...o,
});

const assessment = (tradeId: string, o: Partial<TradeAssessmentDTO>): TradeAssessmentDTO => ({
  id: `a-${tradeId}`, tradeId, dateKey: "2026-11-17", verdict: null, invalidReasons: [], executionIssues: [], executionQuality: null, mistake: null,
  weaknesses: [], underlyingWeakness: null, improvement: null, assessedAt: null, images: [], ...o,
});

const expected = (o: Partial<ExpectedTradeDTO>): ExpectedTradeDTO => ({
  id: "e1", dateKey: "2026-11-17", assetSymbol: "EURUSD", direction: "SHORT", intendedEntry: 1.0858, stopLoss: 1.0879, target: 1.0819,
  intendedRiskPercent: null, strategyId: "s1", strategyName: "London Sweep", setupName: "15m BOS retest", timeframe: null, linkedTradeId: null,
  validityReason: "Waited for the close", criteriaMet: ["Sweep", "BOS"], missReason: null, missNote: null, weaknesses: [], underlyingWeakness: null,
  improvement: null, images: [], ...o,
});

const live = (o: Partial<LiveMissedOpportunityDTO>): LiveMissedOpportunityDTO => ({
  id: "o1", dateKey: "2026-11-18", assetSymbol: "GBPUSD", direction: "LONG", plannedEntry: 1.27, plannedStopLoss: 1.268, plannedTarget: 1.275,
  strategyName: null, setupValid: true, setupScore: 87.5, missReason: "MISSED_ALERT", missNote: null, images: [], ...o,
});

const day = (dateKey: string, o: Partial<AuditDayDTO>): AuditDayDTO => ({
  dateKey, schedule: "SCHEDULED", status: "NOT_STARTED", dailyAuditId: null, noTradeReason: null, wentWell: null, wentWrong: null,
  couldDoBetter: null, mainLesson: null, trades: [], assessments: {}, expectedTrades: [], liveMissed: [], dayImages: [], changes: [], ...o,
});

describe("gallery comparisons — explicit pairing, nothing invented", () => {
  it("pairs an invalid trade with the setup explicitly linked to it, and does not repeat that setup as a separate miss", () => {
    const t = trade({ images: [img("before", "BEFORE"), img("after", "AFTER")] });
    const e = expected({ linkedTradeId: "t1", images: [img("exp", "SETUP", "REVIEW")] });
    const [c, ...rest] = buildGalleryComparisons([
      day("2026-11-17", { trades: [t], assessments: { t1: assessment("t1", { verdict: "INVALID", images: [img("markup", "REVIEW", "REVIEW")] }) }, expectedTrades: [e] }),
    ]);
    expect(rest).toEqual([]);
    expect(c.kind).toBe("TRADE");
    expect(c.actual?.images.map((i) => i.attachmentId)).toEqual(["after", "before"]); // after-trade first
    expect(c.expected).toMatchObject({ source: "PAIRED_SETUP", entry: 1.0858, setupName: "15m BOS retest" });
    expect(c.expectedImages.map((i) => i.attachmentId)).toEqual(["exp", "markup"]);
  });

  it("shows an empty expected side for an invalid trade with no valid setup recorded", () => {
    const [c] = buildGalleryComparisons([day("2026-11-17", { trades: [trade({})], assessments: { t1: assessment("t1", { verdict: "INVALID" }) } })]);
    expect(c.expected.source).toBe("NONE");
    expect(c.expected.entry).toBeNull();
    expect(c.expectedImages).toEqual([]);
  });

  it("uses the trade's own plan as the expected prices for a valid trade (labelled, not invented)", () => {
    const [c] = buildGalleryComparisons([day("2026-11-17", { trades: [trade({})], assessments: { t1: assessment("t1", { verdict: "VALID" }) } })]);
    expect(c.expected).toMatchObject({ source: "TRADE_PLAN", entry: 1.0864, stopLoss: 1.0879, target: 1.0819 });
  });

  it("represents misses with no actual trade", () => {
    const comps = buildGalleryComparisons([
      day("2026-11-17", { expectedTrades: [expected({ id: "e2" })] }),
      day("2026-11-18", { liveMissed: [live({})] }),
    ]);
    expect(comps.map((c) => [c.kind, c.actual, c.outcome])).toEqual([
      ["MISSED_REVIEW", null, "NOT_TAKEN"],
      ["MISSED_LIVE", null, "NOT_TAKEN"],
    ]);
    expect(comps[1].expected.qualification).toMatchObject({ label: "Qualified at the time (88%)", tone: "good" });
  });

  it("ignores a link to a trade that isn't on that day (never pairs across trades)", () => {
    const comps = buildGalleryComparisons([day("2026-11-17", { trades: [trade({})], expectedTrades: [expected({ linkedTradeId: "elsewhere" })] })]);
    expect(comps.map((c) => c.kind)).toEqual(["TRADE", "MISSED_REVIEW"]);
    expect(comps[0].expected.source).toBe("NONE");
  });

  it("orders actual images after-trade first, keeping upload order within a category", () => {
    expect(orderActualImages([img("b1", "BEFORE"), img("a1", "AFTER"), img("x", null), img("a2", "AFTER")]).map((i) => i.attachmentId)).toEqual(["a1", "a2", "b1", "x"]);
  });
});

describe("gallery filters", () => {
  const comps = buildGalleryComparisons([
    day("2026-11-17", { trades: [trade({}), trade({ id: "t2", assetSymbol: "XAUUSD", outcome: "LOSS", strategyName: null })] }),
    day("2026-11-18", { liveMissed: [live({})] }),
  ]);

  it("filters by instrument, strategy, outcome and day", () => {
    expect(filterComparisons(comps, { asset: "XAUUSD", strategy: null, outcome: null, day: null }).map((c) => c.id)).toEqual(["t:t2"]);
    expect(filterComparisons(comps, { asset: null, strategy: "London Sweep", outcome: null, day: null }).map((c) => c.id)).toEqual(["t:t1"]);
    expect(filterComparisons(comps, { asset: null, strategy: NO_STRATEGY, outcome: null, day: null }).map((c) => c.id)).toEqual(["t:t2", "o:o1"]);
    expect(filterComparisons(comps, { asset: null, strategy: null, outcome: "NOT_TAKEN", day: null }).map((c) => c.id)).toEqual(["o:o1"]);
    expect(filterComparisons(comps, { asset: null, strategy: null, outcome: null, day: "2026-11-18" }).map((c) => c.id)).toEqual(["o:o1"]);
  });

  it("offers only values present this week", () => {
    expect(galleryFilterOptions(comps)).toEqual({
      assets: ["EURUSD", "GBPUSD", "XAUUSD"],
      strategies: ["London Sweep", NO_STRATEGY],
      outcomes: ["WIN", "LOSS", "NOT_TAKEN"],
      days: ["2026-11-17", "2026-11-18"],
    });
  });
});
