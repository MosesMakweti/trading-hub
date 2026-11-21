/**
 * Weekly Trade Audit — Gallery View model (pure).
 *
 * The Gallery is a second VIEW of the same audit, not a second data model:
 * this derives an ordered list of ACTUAL ↔ EXPECTED comparisons from exactly
 * the `AuditDayDTO[]` the Audit View renders, so the two can never disagree.
 *
 * Pairing rules — every comparison keeps an explicit relationship, and
 * nothing is invented when it doesn't exist:
 *  - TRADE: an actual trade. Expected side = the setup(s) the trader
 *    explicitly paired with it in review (`AuditExpectedTrade.linkedTradeId`,
 *    "should have taken this instead") plus the review screenshots on the
 *    trade's own assessment. For a VALID trade with no paired setup the
 *    expected prices are the trade's own plan (labelled as such); for an
 *    INVALID one there is simply no expected setup — an empty state.
 *  - MISSED_REVIEW: a retrospective missed setup NOT paired with a trade —
 *    actual side "No trade taken".
 *  - MISSED_LIVE: a MISSED opportunity recorded during the session.
 * Actual images: the trade record's own screenshots, after-trade first.
 */
import type {
  AuditDayDTO,
  AuditImageDTO,
  AuditTradeDTO,
  AuditVerdictValue,
  ExpectedTradeDTO,
  LiveMissedOpportunityDTO,
  TradeAssessmentDTO,
  TradeOutcome,
} from "@/types/trade-audit";

export type GalleryOutcome = TradeOutcome | "NOT_TAKEN";

export interface GalleryImage extends AuditImageDTO {
  /** Short label for the image's source, e.g. "After-trade" or "Missed setup · EURUSD". */
  sourceLabel: string;
}

export interface ExpectedSetupSummary {
  source: "PAIRED_SETUP" | "REVIEW_SETUP" | "LIVE_SETUP" | "TRADE_PLAN" | "NONE";
  assetSymbol: string | null;
  direction: "LONG" | "SHORT" | null;
  strategyName: string | null;
  setupName: string | null;
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  qualification: { label: string; tone: "good" | "bad" | "neutral" };
  /** Strategy criteria / validity reasoning (details panel). */
  criteria: string[];
  validityReason: string | null;
  missReason: string | null;
  missNote: string | null;
}

export interface GalleryComparison {
  id: string;
  dateKey: string;
  kind: "TRADE" | "MISSED_REVIEW" | "MISSED_LIVE";
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  strategyName: string | null;
  outcome: GalleryOutcome;
  actual: {
    trade: AuditTradeDTO;
    assessment: TradeAssessmentDTO | null;
    verdict: AuditVerdictValue | null;
    images: GalleryImage[];
  } | null;
  expected: ExpectedSetupSummary;
  expectedImages: GalleryImage[];
  /** Review notes surfaced in the expandable details. */
  notes: { mistake: string | null; improvement: string | null; invalidReasons: string[]; systemFlags: string[] };
}

const CATEGORY_RANK = (category: string | null) => (category === "AFTER" ? 0 : category === "BEFORE" ? 1 : 2);
const CATEGORY_LABEL = (category: string | null) => (category === "AFTER" ? "After-trade" : category === "BEFORE" ? "Before-trade" : "Trade record");

/** Actual-side images: after-trade screenshots first, then the rest, stable. */
export function orderActualImages(images: AuditImageDTO[]): GalleryImage[] {
  return images
    .map((img, i) => ({ img, i }))
    .sort((a, b) => CATEGORY_RANK(a.img.category) - CATEGORY_RANK(b.img.category) || a.i - b.i)
    .map(({ img }) => ({ ...img, sourceLabel: CATEGORY_LABEL(img.category) }));
}

function reviewSetupSummary(e: ExpectedTradeDTO, source: "PAIRED_SETUP" | "REVIEW_SETUP"): ExpectedSetupSummary {
  return {
    source,
    assetSymbol: e.assetSymbol,
    direction: e.direction,
    strategyName: e.strategyName,
    setupName: e.setupName,
    entry: e.intendedEntry,
    stopLoss: e.stopLoss,
    target: e.target,
    qualification: {
      label: e.criteriaMet.length > 0 ? `Qualified — ${e.criteriaMet.length} criteria met (recorded in review)` : "Qualified — recorded in review",
      tone: "good",
    },
    criteria: e.criteriaMet,
    validityReason: e.validityReason,
    missReason: e.missReason,
    missNote: e.missNote,
  };
}

function liveSetupSummary(o: LiveMissedOpportunityDTO): ExpectedSetupSummary {
  const scored = o.setupValid ?? null;
  return {
    source: "LIVE_SETUP",
    assetSymbol: o.assetSymbol,
    direction: o.direction,
    strategyName: o.strategyName,
    setupName: null,
    entry: o.plannedEntry,
    stopLoss: o.plannedStopLoss,
    target: o.plannedTarget,
    qualification:
      scored === true
        ? { label: `Qualified at the time${o.setupScore != null ? ` (${Math.round(o.setupScore)}%)` : ""}`, tone: "good" }
        : scored === false
          ? { label: "Did not qualify at the time", tone: "bad" }
          : { label: "Recorded during session — not scored", tone: "neutral" },
    criteria: [],
    validityReason: null,
    missReason: o.missReason,
    missNote: o.missNote,
  };
}

const EMPTY_EXPECTED = (label: string): ExpectedSetupSummary => ({
  source: "NONE",
  assetSymbol: null,
  direction: null,
  strategyName: null,
  setupName: null,
  entry: null,
  stopLoss: null,
  target: null,
  qualification: { label, tone: "neutral" },
  criteria: [],
  validityReason: null,
  missReason: null,
  missNote: null,
});

export function buildGalleryComparisons(days: AuditDayDTO[]): GalleryComparison[] {
  const out: GalleryComparison[] = [];
  for (const day of days) {
    const tradeIds = new Set(day.trades.map((t) => t.id));
    const pairedByTrade = new Map<string, ExpectedTradeDTO[]>();
    for (const e of day.expectedTrades) {
      if (e.linkedTradeId && tradeIds.has(e.linkedTradeId)) pairedByTrade.set(e.linkedTradeId, [...(pairedByTrade.get(e.linkedTradeId) ?? []), e]);
    }

    for (const t of day.trades) {
      const assessment = day.assessments[t.id] ?? null;
      const verdict = assessment?.verdict ?? null;
      const paired = pairedByTrade.get(t.id) ?? [];
      const expectedImages: GalleryImage[] = [
        ...paired.flatMap((e) => e.images.map((img) => ({ ...img, sourceLabel: `Setup to take instead · ${e.assetSymbol}` }))),
        ...(assessment?.images ?? []).map((img) => ({ ...img, sourceLabel: "Review screenshot of this trade" })),
      ];
      let expected: ExpectedSetupSummary;
      if (paired.length > 0) {
        expected = reviewSetupSummary(paired[0], "PAIRED_SETUP");
      } else if (verdict === "VALID") {
        expected = {
          ...EMPTY_EXPECTED("Valid — met your strategy (your review)"),
          source: "TRADE_PLAN",
          assetSymbol: t.assetSymbol,
          direction: t.direction,
          strategyName: t.strategyName,
          setupName: t.setupName,
          entry: t.plannedEntry,
          stopLoss: t.plannedStopLoss,
          target: t.plannedTarget,
          criteria: t.confluences ?? [],
        };
        expected.qualification = { label: "Valid — met your strategy (your review)", tone: "good" };
      } else if (verdict === "INVALID") {
        expected = EMPTY_EXPECTED("Should not have been taken — no valid setup recorded instead");
        expected.qualification.tone = "bad";
      } else {
        expected = EMPTY_EXPECTED(verdict === "UNSURE" ? "Unsure — not settled in review" : "Not judged yet");
      }
      out.push({
        id: `t:${t.id}`,
        dateKey: day.dateKey,
        kind: "TRADE",
        assetSymbol: t.assetSymbol,
        direction: t.direction,
        strategyName: t.strategyName,
        outcome: t.outcome,
        actual: { trade: t, assessment, verdict, images: orderActualImages(t.images) },
        expected,
        expectedImages,
        notes: {
          mistake: assessment?.mistake ?? null,
          improvement: assessment?.improvement ?? null,
          invalidReasons: assessment?.invalidReasons ?? [],
          systemFlags: t.systemFlags.map((f) => f.label),
        },
      });
    }

    for (const e of day.expectedTrades) {
      if (e.linkedTradeId && tradeIds.has(e.linkedTradeId)) continue; // shown with its trade
      out.push({
        id: `e:${e.id}`,
        dateKey: day.dateKey,
        kind: "MISSED_REVIEW",
        assetSymbol: e.assetSymbol,
        direction: e.direction,
        strategyName: e.strategyName,
        outcome: "NOT_TAKEN",
        actual: null,
        expected: reviewSetupSummary(e, "REVIEW_SETUP"),
        expectedImages: e.images.map((img) => ({ ...img, sourceLabel: "Missed setup (recorded in review)" })),
        notes: { mistake: null, improvement: e.improvement, invalidReasons: [], systemFlags: [] },
      });
    }

    for (const o of day.liveMissed) {
      out.push({
        id: `o:${o.id}`,
        dateKey: day.dateKey,
        kind: "MISSED_LIVE",
        assetSymbol: o.assetSymbol,
        direction: o.direction,
        strategyName: o.strategyName,
        outcome: "NOT_TAKEN",
        actual: null,
        expected: liveSetupSummary(o),
        expectedImages: o.images.map((img) => ({ ...img, sourceLabel: "Missed setup (recorded during session)" })),
        notes: { mistake: null, improvement: null, invalidReasons: [], systemFlags: [] },
      });
    }
  }
  return out;
}

export interface GalleryFilters {
  asset: string | null;
  strategy: string | null;
  outcome: GalleryOutcome | null;
  day: string | null;
}

export const NO_STRATEGY = "__none__";

export function filterComparisons(comparisons: GalleryComparison[], f: GalleryFilters): GalleryComparison[] {
  return comparisons.filter(
    (c) =>
      (!f.asset || c.assetSymbol === f.asset) &&
      (!f.strategy || (f.strategy === NO_STRATEGY ? c.strategyName == null : c.strategyName === f.strategy)) &&
      (!f.outcome || c.outcome === f.outcome) &&
      (!f.day || c.dateKey === f.day),
  );
}

/** Values actually present this week — filters never offer empty options. */
export function galleryFilterOptions(comparisons: GalleryComparison[]) {
  const uniq = <T>(xs: T[]) => [...new Set(xs)];
  return {
    assets: uniq(comparisons.map((c) => c.assetSymbol)).sort(),
    strategies: uniq(comparisons.map((c) => c.strategyName ?? NO_STRATEGY)).sort(),
    outcomes: uniq(comparisons.map((c) => c.outcome)),
    days: uniq(comparisons.map((c) => c.dateKey)).sort(),
  };
}
