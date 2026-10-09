import { describe, expect, it } from "vitest";

import { assessReset, currentFlow, flowFor, isComplete, validateAnswer, type ResetAnswers } from "@/domain/psychology-reset";

/** Trading Psychology Reset — content order and the (advisory) recommendation. Pure. */

const answers = (pairs: Record<string, string>): ResetAnswers =>
  Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, { optionId: v, answeredAt: "2026-10-09T00:00:00.000Z" }]));

describe("flow content", () => {
  it("losing-trade sequence: five questions in the specified order, the last being the next action", () => {
    const f = currentFlow("LOSING_TRADE");
    expect(f.steps.map((s) => s.title)).toEqual([
      "Do you understand why this trade could lose?",
      "Was this trade ever guaranteed to win?",
      "The trade is over. You do not need to repair it.",
      "Every moment is unique.",
      "Your next decision is still within your control.",
    ]);
    expect(f.steps[0].options.map((o) => o.label)).toEqual([
      "My setup was valid, I followed my plan, and the trade lost.",
      "I violated one or more of my trading rules.",
      "I'm not yet sure whether my execution followed my plan.",
    ]);
    expect(f.steps[4].options.map((o) => o.caution)).toEqual([0, 1, 2]);
  });

  it("missed-opportunity sequence: four questions in order; no wording implies a financial loss", () => {
    const f = currentFlow("MISSED_OPPORTUNITY");
    expect(f.steps.map((s) => s.title)).toEqual([
      "You missed an opportunity. You do not owe the market a trade.",
      "You do not need to catch every move.",
      "The next opportunity is a new event.",
      "Patience is part of trading.",
    ]);
    expect(f.steps[0].question).toBe("Why did you miss this opportunity?");
    const text = JSON.stringify(f).toLowerCase();
    expect(text).not.toMatch(/losing trade|you lost money|your loss/);
  });

  it("a rule-breaking answer is never reframed as a valid trade", () => {
    const rule = currentFlow("LOSING_TRADE").steps[0].options.find((o) => o.id === "violated_rules")!;
    expect(rule.feedback).not.toMatch(/valid setup|you did nothing wrong|followed your plan/i);
    expect(rule.signals).toContain("RULE_BREAK");
  });

  it("copy never encourages bigger size, deposits or recovery trades, and never promises outcomes", () => {
    const text = JSON.stringify([currentFlow("LOSING_TRADE"), currentFlow("MISSED_OPPORTUNITY")]).toLowerCase();
    for (const bad of ["increase your size", "double", "deposit", "make it back", "guaranteed profit", "you will win", "will be profitable"]) expect(text).not.toContain(bad);
  });

  it("validates answers against the stored version", () => {
    const f = flowFor("LOSING_TRADE", 1)!;
    expect(validateAnswer(f, "uncertainty", "valid_followed")).toBeNull();
    expect(validateAnswer(f, "uncertainty", "accept")).toMatch(/Choose one/);
    expect(validateAnswer(f, "nope", "accept")).toMatch(/Unknown/);
    expect(validateAnswer(f, "uncertainty", "valid_followed", "x".repeat(501))).toMatch(/500/);
    expect(flowFor("LOSING_TRADE", 99)).toBeNull();
  });
});

describe("recommendation", () => {
  const loss = currentFlow("LOSING_TRADE");
  const calm = { uncertainty: "valid_followed", probability: "accept", separate: "new_setup", objectivity: "independent" };

  it("a calm, rule-following trader may continue — only with a valid setup", () => {
    const a = assessReset(loss, answers({ ...calm, next_action: "resume_if_valid" }));
    expect([a.recommendation, a.lessCautiousThanRecommended, a.limitPrecedence]).toEqual(["CONTINUE_WITH_RULES", false, null]);
    expect(isComplete(loss, answers({ ...calm, next_action: "resume_if_valid" }))).toBe(true);
  });

  it("an urge to recover, FOMO, reacting or struggling → cooldown", () => {
    for (const patch of [{ probability: "compelled_recover" }, { separate: "recover_prove" }, { separate: "fomo" }, { objectivity: "reacting" }, { probability: "struggling" }, { separate: "unsure_feeling" }]) {
      expect(assessReset(loss, answers({ ...calm, ...patch })).recommendation).toBe("COOLDOWN");
    }
  });

  it("a rule break while still activated → stop; a calm rule break → review, not stop", () => {
    expect(assessReset(loss, answers({ ...calm, uncertainty: "violated_rules", probability: "compelled_recover" })).recommendation).toBe("STOP_SESSION");
    const calmBreak = assessReset(loss, answers({ ...calm, uncertainty: "violated_rules" }));
    expect(calmBreak.recommendation).toBe("CONTINUE_WITH_RULES");
    expect(calmBreak.reasons.join(" ")).toMatch(/Review that trade/);
  });

  it("the trader's choice is shown against the recommendation, never overridden", () => {
    const a = assessReset(loss, answers({ ...calm, separate: "fomo", next_action: "resume_if_valid" }));
    expect(a.chosen?.optionId).toBe("resume_if_valid");
    expect(a.lessCautiousThanRecommended).toBe(true);
    expect(assessReset(loss, answers({ ...calm, separate: "fomo", next_action: "stop_session" })).lessCautiousThanRecommended).toBe(false);
  });

  it("a reached day limit takes precedence over everything (stop), regardless of calm answers", () => {
    const a = assessReset(loss, answers({ ...calm, next_action: "resume_if_valid" }), { reached: true, messages: ["Maximum trades reached: 3 of 3."] });
    expect(a.recommendation).toBe("STOP_SESSION");
    expect(a.limitPrecedence?.messages).toEqual(["Maximum trades reached: 3 of 3."]);
    expect(a.lessCautiousThanRecommended).toBe(true);
  });

  it("missed flow: disciplined non-participation vs an execution issue; chasing → cooldown", () => {
    const missed = currentFlow("MISSED_OPPORTUNITY");
    const base = { accept_missed: "criteria_not_met", release_regret: "fresh_setup", new_event: "independent", next_action: "wait_valid" };
    expect(assessReset(missed, answers(base)).recommendation).toBe("CONTINUE_WITH_RULES");
    const exec = assessReset(missed, answers({ ...base, accept_missed: "hesitated" }));
    expect([exec.recommendation, exec.reasons.join(" ")]).toEqual(["CONTINUE_WITH_RULES", "You noted an execution issue. It is worth reviewing later, calmly."]);
    expect(assessReset(missed, answers({ ...base, release_regret: "make_up_profit" })).recommendation).toBe("COOLDOWN");
    expect(assessReset(missed, answers({ ...base, new_event: "reacting" })).recommendation).toBe("COOLDOWN");
  });
});
