import { describe, expect, it } from "vitest";

import {
  buildCanonicalPsychologyAnswers,
  deriveBiasAlignment,
  deriveFomoAnswer,
  psychologyKeySources,
} from "@/domain/psychology/review-adapter";
import { scorePsychology } from "@/domain/psychology/scoring";
import { deriveReviewState, closedMomentFrom, type ReviewStateFacts } from "./review-state";
import {
  exitAdherenceEvidence,
  filterSuggestionsToCatalog,
  riskAdherenceEvidence,
  stopWidened,
  suggestBehaviourLabelNames,
  type ExitEvidenceInput,
  type RiskEvidenceInput,
} from "./review-evidence";
import { buildPlanVsActual, deriveReviewResult, formatPriceDelta, type PlanVsActualInput } from "./review-summary";
import { deriveLifecycleWithReview } from "./trade-lifecycle";

const COMPLETE_ANSWERS = {
  tradeIntent: "PLANNED",
  adherenceAnswers: { followedStrategy: true, followedEntryModel: true, followedTradeManagement: false, remainedPatient: true },
  psychologyComplete: true,
  wouldTakeAgain: true,
};

function facts(overrides: Partial<ReviewStateFacts> = {}): ReviewStateFacts {
  return {
    cancelled: false,
    hasActualEntry: true,
    hasLegacyResult: false,
    closed: true,
    closedMoment: new Date("2026-10-03T10:00:00Z"),
    reviewedAt: null,
    answers: COMPLETE_ANSWERS,
    ...overrides,
  };
}

// ── Psychology adapter ───────────────────────────────────────────────────────

describe("psychology adapter (V3 → canonical questionnaire)", () => {
  const human = {
    riskManaged: "yes",
    followedExitPlan: "yes",
    influencedBySomeoneElseProfit: "no",
    influencedByOnlineOpinion: "no",
    outcomeWillInfluenceNext: "no",
    monitoringObsession: 20,
  };

  it("derives FOMO from Trade Intent — FOMO → yes, any other motive → no, none → missing", () => {
    expect(deriveFomoAnswer("FOMO")).toBe("yes");
    expect(deriveFomoAnswer("REVENGE")).toBe("no");
    expect(deriveFomoAnswer("PLANNED")).toBe("no");
    expect(deriveFomoAnswer(null)).toBeNull();
  });

  it("ignores a trader-supplied fomo answer — the motive is answered once", () => {
    const p = buildCanonicalPsychologyAnswers({
      tradeIntent: "PLANNED",
      direction: "LONG",
      dailyBiasSnapshot: "LONG",
      trader: { ...human, fomo: "yes" },
    });
    expect(p.answers.fomo).toBe("no");
    // FOMO counted once: PLANNED → +1 for fomo, not a separate -1.
    expect(scorePsychology(Object.entries(p.answers).map(([key, value]) => ({ key, value }))).rawScore).toBe(8);
  });

  it("derives bias alignment from direction vs the frozen daily bias", () => {
    expect(deriveBiasAlignment("LONG", "LONG")).toBe("ALIGNED");
    expect(deriveBiasAlignment("SHORT", "SHORT")).toBe("ALIGNED");
    expect(deriveBiasAlignment("LONG", "SHORT")).toBe("CONFLICT");
    expect(deriveBiasAlignment("SHORT", "LONG")).toBe("CONFLICT");
    expect(deriveBiasAlignment("LONG", "NEUTRAL")).toBe("UNKNOWN");
    expect(deriveBiasAlignment("LONG", null)).toBe("UNKNOWN");
  });

  it("fills alignedWithBias from the derivation (conflict → no), ignoring a trader answer", () => {
    const p = buildCanonicalPsychologyAnswers({
      tradeIntent: "PLANNED",
      direction: "LONG",
      dailyBiasSnapshot: "SHORT",
      trader: { ...human, alignedWithBias: "yes" },
    });
    expect(p.answers.alignedWithBias).toBe("no");
    expect(p.sources.alignedWithBias).toBe("DERIVED");
  });

  it("neutral/missing bias → alignment is asked (HUMAN) and stays missing until answered", () => {
    expect(psychologyKeySources("LONG", "NEUTRAL").alignedWithBias).toBe("HUMAN");
    const p = buildCanonicalPsychologyAnswers({ tradeIntent: "PLANNED", direction: "LONG", dailyBiasSnapshot: null, trader: human });
    expect(p.complete).toBe(false);
    expect(p.missing).toEqual(["alignedWithBias"]);
  });

  it("evidence keys are never filled from a suggestion — missing data is never positive", () => {
    const p = buildCanonicalPsychologyAnswers({
      tradeIntent: "PLANNED",
      direction: "LONG",
      dailyBiasSnapshot: "LONG",
      trader: { influencedBySomeoneElseProfit: "no", influencedByOnlineOpinion: "no", outcomeWillInfluenceNext: "no", monitoringObsession: 10 },
    });
    expect(p.missing).toEqual(["riskManaged", "followedExitPlan"]);
    expect(p.answers.riskManaged).toBeUndefined();
  });

  it("missing intent leaves fomo missing (never assumed 'no')", () => {
    const p = buildCanonicalPsychologyAnswers({ tradeIntent: null, direction: "LONG", dailyBiasSnapshot: "LONG", trader: human });
    expect(p.missing).toEqual(["fomo"]);
  });

  it("human-only answers stay human; the 8-key score matches the legacy scorer exactly", () => {
    const sources = psychologyKeySources("LONG", "LONG");
    expect(sources).toMatchObject({
      fomo: "DERIVED",
      alignedWithBias: "DERIVED",
      riskManaged: "EVIDENCE",
      followedExitPlan: "EVIDENCE",
      influencedBySomeoneElseProfit: "HUMAN",
      influencedByOnlineOpinion: "HUMAN",
      outcomeWillInfluenceNext: "HUMAN",
      monitoringObsession: "HUMAN",
    });
    // Same answers as a legacy fully self-reported questionnaire → same score.
    const legacy = { fomo: "yes", alignedWithBias: "no", riskManaged: "no", followedExitPlan: "yes", influencedBySomeoneElseProfit: "no", influencedByOnlineOpinion: "yes", outcomeWillInfluenceNext: "maybe", monitoringObsession: 40 };
    const v3 = buildCanonicalPsychologyAnswers({
      tradeIntent: "FOMO",
      direction: "LONG",
      dailyBiasSnapshot: "SHORT",
      trader: { riskManaged: "no", followedExitPlan: "yes", influencedBySomeoneElseProfit: "no", influencedByOnlineOpinion: "yes", outcomeWillInfluenceNext: "maybe", monitoringObsession: 40 },
    });
    expect(v3.answers).toEqual(legacy);
    const score = (a: Record<string, string | number>) => scorePsychology(Object.entries(a).map(([key, value]) => ({ key, value })));
    expect(score(v3.answers)).toEqual(score(legacy));
    expect(score(legacy)).toEqual({ rawScore: -3, percent: 31.25, grade: "F" });
  });
});

// ── Review state ─────────────────────────────────────────────────────────────

describe("review state (interim vs final, explicit completion)", () => {
  it("open / partially closed → interim available, then interim reviewed", () => {
    expect(deriveReviewState(facts({ closed: false, closedMoment: null })).state).toBe("INTERIM_AVAILABLE");
    expect(deriveReviewState(facts({ closed: false, closedMoment: null, reviewedAt: new Date() })).state).toBe("INTERIM_REVIEWED");
  });

  it("closed, all required answered, reviewed after close → complete", () => {
    const r = deriveReviewState(facts({ reviewedAt: new Date("2026-10-03T11:00:00Z") }));
    expect(r.state).toBe("FINAL_REVIEW_COMPLETE");
  });

  it("an interim review (before the close) never satisfies the final review", () => {
    const r = deriveReviewState(facts({ reviewedAt: new Date("2026-10-03T09:00:00Z") }));
    expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
    expect(r.hasEarlierReview).toBe(true);
  });

  it.each([
    ["intent", { tradeIntent: null }],
    ["a process answer", { adherenceAnswers: { followedStrategy: true, followedEntryModel: true, remainedPatient: true } }],
    ["psychology", { psychologyComplete: false }],
    ["wouldTakeAgain", { wouldTakeAgain: null }],
  ])("missing %s → cannot be complete", (_label, patch) => {
    const r = deriveReviewState(facts({ reviewedAt: new Date("2026-10-03T11:00:00Z"), answers: { ...COMPLETE_ANSWERS, ...patch } }));
    expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("reflection text is not a requirement; text-stamped reviewedAt alone never completes", () => {
    // reviewedAt present (e.g. legacy text stamp) but no structured answers.
    const r = deriveReviewState(
      facts({ reviewedAt: new Date("2026-10-03T11:00:00Z"), answers: { tradeIntent: null, adherenceAnswers: {}, psychologyComplete: false, wouldTakeAgain: null } }),
    );
    expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
    expect(r.missing.map((m) => m.key)).toEqual([
      "tradeIntent",
      "adherence.followedStrategy",
      "adherence.followedEntryModel",
      "adherence.followedTradeManagement",
      "adherence.remainedPatient",
      "psychology",
      "wouldTakeAgain",
    ]);
  });

  it("legacy closed trade with no recorded close moment falls back to reviewedAt", () => {
    expect(deriveReviewState(facts({ closedMoment: null, reviewedAt: new Date() })).state).toBe("FINAL_REVIEW_COMPLETE");
  });

  it("cancelled idea → CANCELLED (no execution review); not entered → NOT_AVAILABLE", () => {
    expect(deriveReviewState(facts({ cancelled: true, hasActualEntry: false, closed: false })).state).toBe("CANCELLED");
    expect(deriveReviewState(facts({ hasActualEntry: false, closed: false })).state).toBe("NOT_AVAILABLE");
  });

  it("closedMomentFrom prefers closedAt, else the latest settle/exit time", () => {
    const a = new Date("2026-10-01T10:00:00Z");
    const b = new Date("2026-10-02T10:00:00Z");
    expect(closedMomentFrom(a, b, [])).toBe(a);
    expect(closedMomentFrom(null, a, [b])?.toISOString()).toBe(b.toISOString());
    expect(closedMomentFrom(null, null, [])).toBeNull();
  });

  it("lifecycle: REVIEWED only after the final review; interim saved shows on open trades", () => {
    const base = {
      cancelled: false,
      hasConfirmedPlan: true,
      planLocked: true,
      hasActualEntry: true,
      hasLegacyResult: false,
      settled: false,
      tradingReady: true,
    };
    const open = deriveLifecycleWithReview(
      { ...base, exitedPercent: 50 },
      { closedMoment: null, reviewedAt: new Date(), answers: COMPLETE_ANSWERS },
    );
    expect(open.lifecycle.state).toBe("PARTIALLY_CLOSED");
    expect(open.review.state).toBe("INTERIM_REVIEWED");
    expect(open.lifecycle.waitingFor).toContain("interim review saved");

    const closedAfterInterim = deriveLifecycleWithReview(
      { ...base, exitedPercent: 100, settled: true },
      { closedMoment: new Date("2026-10-03T10:00:00Z"), reviewedAt: new Date("2026-10-03T09:00:00Z"), answers: COMPLETE_ANSWERS },
    );
    expect(closedAfterInterim.lifecycle.state).toBe("REVIEW_NEEDED");
    expect(closedAfterInterim.lifecycle.waitingFor).toContain("final review required");

    const done = deriveLifecycleWithReview(
      { ...base, exitedPercent: 100, settled: true },
      { closedMoment: new Date("2026-10-03T10:00:00Z"), reviewedAt: new Date("2026-10-03T12:00:00Z"), answers: COMPLETE_ANSWERS },
    );
    expect(done.lifecycle.state).toBe("REVIEWED");
  });
});

// ── Result ───────────────────────────────────────────────────────────────────

describe("review result", () => {
  const summary = (o: Partial<{ settled: boolean; realizedRSoFar: number | null; pnl: number | null }>) => ({
    realizedRSoFar: 1.72,
    proportionClosedPercent: 100,
    remainingProportionPercent: 0,
    isFullyClosed: true,
    pnl: 430,
    settled: true,
    ...o,
  });

  it("settled → classified by the canonical settledWinLossClass", () => {
    const r = deriveReviewResult({ cancelled: false, hasActualEntry: true, closed: true, exitedPercent: 100, summary: summary({}) });
    expect(r).toMatchObject({ realizedR: 1.72, pnl: 430, settlement: "SETTLED", winLoss: "WIN", positionLabel: "Fully closed", remainingOpenPercent: 0 });
  });

  it("unsettled positive R is NOT classified a win", () => {
    const r = deriveReviewResult({
      cancelled: false,
      hasActualEntry: true,
      closed: false,
      exitedPercent: 50,
      summary: summary({ settled: false, realizedRSoFar: 0.8, pnl: null }),
    });
    expect(r.winLoss).toBeNull();
    expect(r.settlement).toBe("OPEN");
    expect(r.remainingOpenPercent).toBe(50);
    expect(r.positionLabel).toBe("Partially closed");
  });

  it("cancelled → no fabricated result", () => {
    const r = deriveReviewResult({ cancelled: true, hasActualEntry: false, closed: false, exitedPercent: null, summary: null });
    expect(r).toMatchObject({ realizedR: null, pnl: null, settlement: "CANCELLED", winLoss: null });
  });
});

// ── Plan vs actual ───────────────────────────────────────────────────────────

describe("plan vs actual", () => {
  const base: PlanVsActualInput = {
    direction: "LONG",
    assetSymbol: "EURUSD",
    plan: { entry: 1.085, stopLoss: 1.083, managementInstructions: [] },
    planConfirmedAfterEntry: false,
    actual: { entry: 1.08504, initialStop: 1.083 },
    exitFacts: ["TP1 50% ✓"],
    risk: { riskPercent: 1, defaultRiskPercent: 1, dayRiskLimitPercent: 2 },
    biasAlignment: "ALIGNED",
    dailyBiasSnapshot: "LONG",
    setup: { valid: true, rating: "A", validationState: "VALIDATED" },
    confluencePercent: 80,
    executionPercent: 100,
  };
  const row = (p: ReturnType<typeof buildPlanVsActual>, key: string) => p.rows.find((r) => r.key === key);

  it("shows facts (deltas in pips for FX), not verdicts", () => {
    const p = buildPlanVsActual(base);
    expect(p.hasPlan).toBe(true);
    expect(row(p, "entry")?.value).toBe("+0.4 pips from plan");
    expect(row(p, "stop")?.value).toBe("Same as plan");
    expect(row(p, "risk")?.value).toBe("1% · account default · daily limit 2%");
    expect(row(p, "bias")?.value).toBe("Aligned (long)");
    expect(row(p, "setup")?.value).toBe("valid · A");
    expect(row(p, "confluences")?.value).toBe("80%");
    expect(row(p, "execution")?.value).toBe("100%");
    expect(p.rows.some((r) => /bad|violation/i.test(r.value))).toBe(false);
  });

  it("bias conflict and missing bias are worded as facts", () => {
    expect(row(buildPlanVsActual({ ...base, biasAlignment: "CONFLICT", dailyBiasSnapshot: "SHORT" }), "bias")?.value).toBe(
      "Against today's short bias",
    );
    expect(row(buildPlanVsActual({ ...base, biasAlignment: "UNKNOWN", dailyBiasSnapshot: null }), "bias")?.value).toBe(
      "No bias recorded for this asset",
    );
  });

  it("planless trade says 'No confirmed plan' instead of deviations", () => {
    const p = buildPlanVsActual({ ...base, plan: null });
    expect(p.hasPlan).toBe(false);
    expect(row(p, "plan")?.value).toBe("No confirmed plan");
    expect(row(p, "entry")).toBeUndefined();
    expect(row(p, "stop")).toBeUndefined();
  });

  it("non-FX deltas are price differences at the instrument's precision", () => {
    expect(formatPriceDelta(-0.4, "XAUUSD")).toBe("−0.40");
  });
});

// ── Evidence ─────────────────────────────────────────────────────────────────

describe("risk-adherence evidence", () => {
  const base: RiskEvidenceInput = {
    direction: "LONG",
    riskPercent: 1,
    defaultRiskPercent: 1,
    initialStop: 1890,
    currentStop: 1890,
    dayRiskLimitPercent: 2,
    limitOverride: null,
  };

  it("default risk, unchanged stop → suggests yes", () => {
    const e = riskAdherenceEvidence(base);
    expect(e.suggestion).toBe("yes");
    expect(e.reason).toContain("within the confirmed daily limit");
  });

  it("widened stop → suggests no; tightened stop is not a breach", () => {
    expect(riskAdherenceEvidence({ ...base, currentStop: 1885 }).suggestion).toBe("no");
    expect(riskAdherenceEvidence({ ...base, currentStop: 1895 }).suggestion).toBe("yes");
    expect(stopWidened("SHORT", 1910, 1915)).toBe(true);
    expect(stopWidened("SHORT", 1910, null)).toBeNull();
  });

  it("no snapshot / above-default risk / daily-risk override → no suggestion (judgement)", () => {
    expect(riskAdherenceEvidence({ ...base, riskPercent: null }).suggestion).toBeNull();
    expect(riskAdherenceEvidence({ ...base, riskPercent: 2 }).suggestion).toBeNull();
    const ov = riskAdherenceEvidence({
      ...base,
      limitOverride: {
        reason: "A+ setup after earlier scratch trade",
        context: { kinds: ["DAILY_RISK"], maxTrades: null, executedCount: 2, riskLimitPercent: 2, riskUsedPercent: 2, projectedRiskPercent: 1 },
      },
    });
    expect(ov.suggestion).toBeNull();
    expect(ov.facts.join(" ")).toContain("A+ setup after earlier scratch trade");
  });
});

describe("exit-adherence evidence", () => {
  const base: ExitEvidenceInput = {
    direction: "LONG",
    closed: true,
    entry: 1900,
    initialStop: 1890,
    targets: [
      { targetOrder: 1, label: "TP1", price: 1910, closePercent: 50, managementInstruction: null, moveToBreakEven: true },
      { targetOrder: 2, label: "TP2", price: 1920, closePercent: 50, managementInstruction: null, moveToBreakEven: false },
    ],
    exits: [],
  };

  it("both targets taken as planned → yes", () => {
    const e = exitAdherenceEvidence({ ...base, exits: [{ price: 1910, percent: 50, targetOrder: null }, { price: 1920, percent: 50, targetOrder: null }] });
    expect(e.suggestion).toBe("yes");
    expect(e.facts).toEqual(["TP1 50% ✓", "TP2 50% ✓"]);
  });

  it("stopped at the initial stop with no target reached → yes (the stop is the plan)", () => {
    const e = exitAdherenceEvidence({ ...base, exits: [{ price: 1890, percent: 100, targetOrder: null }] });
    expect(e.suggestion).toBe("yes");
    expect(e.targets.map((t) => t.outcome)).toEqual(["NOT_REACHED", "NOT_REACHED"]);
  });

  it("TP1 then breakeven under a move-to-BE rule → yes", () => {
    const e = exitAdherenceEvidence({ ...base, exits: [{ price: 1910, percent: 50, targetOrder: 1 }, { price: 1900, percent: 50, targetOrder: null }] });
    expect(e.suggestion).toBe("yes");
  });

  it("target not reached is distinguished from target reached but exited differently", () => {
    // TP1 50% taken, remainder closed manually below TP2 → ambiguous (management call).
    const manual = exitAdherenceEvidence({ ...base, exits: [{ price: 1910, percent: 50, targetOrder: null }, { price: 1914, percent: 50, targetOrder: null }] });
    expect(manual.suggestion).toBeNull();
    expect(manual.targets[1].outcome).toBe("NOT_REACHED");
    expect(manual.facts).toContain("50% closed manually at 1914");
    // Everything closed beyond TP1 at TP2 — TP1's planned partial wasn't taken → no.
    const skipped = exitAdherenceEvidence({ ...base, exits: [{ price: 1920, percent: 100, targetOrder: null }] });
    expect(skipped.suggestion).toBe("no");
    expect(skipped.targets[0].outcome).toBe("EXCEEDED_NOT_TAKEN");
  });

  it("ambiguous / missing evidence stays unanswered", () => {
    expect(exitAdherenceEvidence({ ...base, targets: [] }).suggestion).toBeNull();
    expect(exitAdherenceEvidence({ ...base, closed: false, exits: [{ price: 1910, percent: 50, targetOrder: null }] }).suggestion).toBeNull();
  });
});

describe("behaviour-label suggestions", () => {
  const exitYes = exitAdherenceEvidence({
    direction: "LONG",
    closed: true,
    entry: 1900,
    initialStop: 1890,
    targets: [{ targetOrder: 1, label: "TP1", price: 1910, closePercent: 100, managementInstruction: null, moveToBreakEven: false }],
    exits: [{ price: 1910, percent: 100, targetOrder: null }],
  });
  const riskYes = { suggestion: "yes" as const, reason: "ok", facts: [] };

  it("suggests from facts + motive, filters to the trader's catalog, never auto-attaches", () => {
    const names = suggestBehaviourLabelNames({ tradeIntent: "FOMO", risk: riskYes, exit: exitYes, stopWidened: false });
    expect(names.map((n) => n.name)).toEqual(["FOMO trade", "Correct risk", "Took planned partial", "Followed exit plan"]);
    const catalog = [
      { id: "a", name: "FOMO trade" },
      { id: "b", name: "Correct risk" },
      { id: "c", name: "Took planned partial" },
    ];
    // "Followed exit plan" isn't in the catalog → dropped; "b" already attached → dropped.
    const out = filterSuggestionsToCatalog(names, catalog, ["b"]);
    expect(out.map((o) => o.labelId)).toEqual(["a", "c"]);
  });

  it("outcome never drives suggestions (no outcome input exists)", () => {
    const names = suggestBehaviourLabelNames({ tradeIntent: "PLANNED", risk: { suggestion: null, reason: "", facts: [] }, exit: exitYes, stopWidened: null });
    expect(names.some((n) => /winner|loss|early/i.test(n.name))).toBe(false);
  });
});
