import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/psychology-reset.actions", () => ({ setPsychologyResetEnabledAction: vi.fn() }));

import { ResetFlowView, type ResetFlowHandlers } from "@/components/psychology-reset/reset-flow-view";
import { PsychologyResetCard } from "@/components/settings/psychology-reset-card";
import { assessReset, currentFlow, type ResetAnswers } from "@/domain/psychology-reset";
import type { PsychologyResetSessionDTO } from "@/types/psychology-reset";

/** Trading Psychology Reset — first render (the markup the browser hydrates). No DOM environment in this repo. */

const noop: ResetFlowHandlers = { onAnswer: () => {}, onBack: () => {}, onFinishLater: () => {}, onComplete: () => {}, onClose: () => {} };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const ans = (pairs: Record<string, string>, notes: Record<string, string> = {}): ResetAnswers =>
  Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, { optionId: v, answeredAt: "2026-10-09T00:00:00.000Z", ...(notes[k] ? { note: notes[k] } : {}) }]));

function session(trigger: "LOSING_TRADE" | "MISSED_OPPORTUNITY", over: Partial<PsychologyResetSessionDTO> = {}): PsychologyResetSessionDTO {
  const flow = currentFlow(trigger);
  const answers = over.answers ?? {};
  return {
    id: "s1",
    trigger,
    flowVersion: flow.version,
    status: "IN_PROGRESS",
    currentStep: 0,
    answers,
    nextAction: null,
    deferred: false,
    createdAt: "2026-10-09T00:00:00.000Z",
    completedAt: null,
    context: { assetSymbol: "XAUUSD", direction: "LONG", dateKey: "2026-10-09" },
    assessment: assessReset(flow, answers),
    ...over,
  };
}
const render = (s: PsychologyResetSessionDTO, error: string | null = null) =>
  renderToStaticMarkup(createElement(ResetFlowView, { session: s, busy: false, error, handlers: noop }));

describe("losing-trade flow", () => {
  it("step 1: title, message, question, three answers as one radio group, progress 1 of 5, no Back", () => {
    const html = render(session("LOSING_TRADE"));
    const t = text(html);
    expect(t).toContain("Step 1 of 5");
    expect(t).toContain("After your XAUUSD long · Oct 9, 2026.");
    expect(t).toContain("Do you understand why this trade could lose?");
    expect(t).toContain("Every trade is a probability, not a promise.");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="0"');
    expect(t).not.toContain("Back");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Continue<\/button>/);
  });

  it("revisiting a step shows the saved answer, its branch guidance and its reflection", () => {
    const html = render(session("LOSING_TRADE", { currentStep: 0, answers: ans({ uncertainty: "violated_rules" }, { uncertainty: "Moved my stop" }) }));
    const t = text(html);
    expect(html).toMatch(/checked="" value="violated_rules"/);
    expect(t).toContain("A trade that broke your rules isn't validated or invalidated by its outcome");
    expect(t).toContain("Which rule, and what led to it? (optional)");
    expect(t).toContain("Moved my stop");
  });

  it("each step appears in order with Back available after the first", () => {
    const titles = currentFlow("LOSING_TRADE").steps.map((s) => s.title);
    titles.forEach((title, i) => {
      const t = text(render(session("LOSING_TRADE", { currentStep: i })));
      expect(t).toContain(title);
      expect(t).toContain(`Step ${i + 1} of 5`);
      if (i > 0) expect(t).toContain("Back");
    });
    expect(text(render(session("LOSING_TRADE", { currentStep: 4 })))).toContain("Review summary");
  });

  it("summary: answers, recommendation with reasons, the choice, and the not-a-certification note", () => {
    const answers = ans({ uncertainty: "violated_rules", probability: "compelled_recover", separate: "recover_prove", objectivity: "reacting", next_action: "resume_if_valid" });
    const flow = currentFlow("LOSING_TRADE");
    const t = text(render(session("LOSING_TRADE", { currentStep: 5, answers, assessment: assessReset(flow, answers) })));
    expect(t).toContain("Your reflection");
    expect(t).toContain("Recommended next step Stop trading for this session");
    expect(t).toContain("You reported breaking a rule and still feeling pulled toward trading.");
    expect(t).toContain("Your chosen next action Resume only if a valid setup appears and I am sufficiently calm.");
    expect(t).toContain("Your answers point to a more cautious step than the one you chose.");
    expect(t).toContain("It does not confirm that you are ready to trade");
    expect(t).toContain("Finish reset");
  });

  it("a reached day limit is shown first and stated to take precedence", () => {
    const answers = ans({ uncertainty: "valid_followed", probability: "accept", separate: "new_setup", objectivity: "independent", next_action: "stop_session" });
    const assessment = assessReset(currentFlow("LOSING_TRADE"), answers, { reached: true, messages: ["Daily risk limit reached: 2% used of 2%."] });
    const t = text(render(session("LOSING_TRADE", { currentStep: 5, answers, assessment })));
    expect(t).toContain("Today's limits still apply Daily risk limit reached: 2% used of 2%. Nothing in this reflection changes or overrides them.");
    expect(t).toContain("Confirmed: you are stopping for the rest of this session.");
  });

  it("completed: calm completion state (no celebration), Close only; errors are announced", () => {
    const answers = ans({ uncertainty: "valid_followed", probability: "accept", separate: "new_setup", objectivity: "no_setup", next_action: "cooldown" });
    const html = render(session("LOSING_TRADE", { status: "COMPLETED", currentStep: 5, answers, nextAction: "cooldown" }));
    expect(text(html)).toContain("Reset complete");
    expect(text(html)).not.toMatch(/congrat|well done|🎉/i);
    expect(text(html)).not.toContain("Finish later");
    expect(render(session("LOSING_TRADE"), "Couldn't save")).toMatch(/role="alert"[^>]*>Couldn&#x27;t save/);
  });
});

describe("missed-opportunity flow", () => {
  it("its own four steps; no trade-loss wording", () => {
    const t = text(render(session("MISSED_OPPORTUNITY")));
    expect(t).toContain("Step 1 of 4");
    expect(t).toContain("After a missed XAUUSD long setup");
    expect(t).toContain("You missed an opportunity. You do not owe the market a trade.");
    expect(t).not.toMatch(/losing trade|this loss/i);
  });
});

describe("settings toggle", () => {
  it("OFF by default state renders unchecked with an accessible name and description; ON renders checked", () => {
    const off = renderToStaticMarkup(createElement(PsychologyResetCard, { initialEnabled: false }));
    expect(off).toContain('role="switch"');
    expect(off).toMatch(/aria-checked="false"/);
    expect(off).toMatch(/aria-labelledby="[^"]+"/);
    expect(text(off)).toContain("Trading Psychology Reset");
    expect(text(off)).toContain("Receive a guided psychological reset after losing trades and missed opportunities.");
    expect(text(off)).toContain("Off by default. Turning it off stops future prompts; your past reflections are kept.");
    const on = renderToStaticMarkup(createElement(PsychologyResetCard, { initialEnabled: true }));
    expect(on).toMatch(/aria-checked="true"/);
  });
});
