import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreparationSummary, ScoreBreakdown } from "@/components/today-v3/preparation-summary";
import { PreparationBreakNotice } from "@/components/today-v3/preparation-notice";
import { Popover } from "@/components/ui/popover";
import type { PreparationTodayDTO, PreparationViewDTO } from "@/types/preparation";

/**
 * Preparation Phase 3 — Today rendering (server render = the markup the
 * browser hydrates). The repository has no DOM test environment, so these
 * assert the first render; interaction is covered in the browser QA.
 */

const NY = "America/New_York";
type Scored = Extract<PreparationTodayDTO, { kind: "SCORED" }>;

const view = (today: PreparationTodayDTO, over: Partial<PreparationViewDTO> = {}): PreparationViewDTO => ({
  configured: true,
  serverNow: "2026-10-07T11:35:00.000Z",
  todayKey: "2026-10-07",
  timezone: NY,
  schedule: { timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" },
  pendingSchedule: null,
  today,
  streak: { current: 14, longest: 23, restartedToday: false },
  notice: null,
  ...over,
});
const scored = (over: Partial<Scored> = {}): Scored => ({
  kind: "SCORED",
  status: "LATE",
  score: 95,
  completionPoints: 70,
  timingPoints: 25,
  completionMax: 70,
  timingMax: 30,
  requiredTotal: 4,
  requiredDone: 4,
  targetAt: "2026-10-07T12:00:00.000Z",
  cutoffAt: "2026-10-07T18:00:00.000Z",
  readyAt: "2026-10-07T12:17:00.000Z",
  deviationMinutes: 17,
  bandLabel: "Late",
  corrected: null,
  ...over,
});
const render = (v: PreparationViewDTO) => renderToStaticMarkup(createElement(PreparationSummary, { view: v }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();

describe("Today Preparation summary", () => {
  it("pending: target in the schedule's zone + server-derived time remaining; no score yet", () => {
    const html = render(
      view({ kind: "PENDING", targetAt: "2026-10-07T12:00:00.000Z", cutoffAt: "2026-10-07T18:00:00.000Z", minutesToTarget: 25, requiredTotal: 4, requiredDone: 1 }),
    );
    expect(text(html)).toContain("Pre-session Target 08:00 · 25 min remaining");
    expect(html).not.toContain("/100");
    expect(html).toContain('aria-label="Preparation Streak: 14 days. Show details"');
  });

  it("pending past the target reads as late (still not a score)", () => {
    const html = render(
      view({ kind: "PENDING", targetAt: "2026-10-07T12:00:00.000Z", cutoffAt: "2026-10-07T18:00:00.000Z", minutesToTarget: -12, requiredTotal: 4, requiredDone: 3 }),
    );
    expect(text(html)).toContain("Target 08:00 · 12 min late");
  });

  it("scored late / 100 / incomplete / missed", () => {
    expect(text(render(view(scored())))).toContain("Routine complete · 17 min late");
    expect(render(view(scored()))).toContain('aria-label="Preparation score 95 out of 100, Late. Show breakdown"');

    const perfect = render(view(scored({ status: "ON_TIME", score: 100, timingPoints: 30, deviationMinutes: -3, bandLabel: "On time" })));
    expect(text(perfect)).toContain("On time · Routine complete");
    expect(text(perfect)).toContain("100 /100");

    const incomplete = render(view(scored({ status: "INCOMPLETE", score: 35, completionPoints: 35, timingPoints: 0, requiredDone: 2, readyAt: null, deviationMinutes: null, bandLabel: null })));
    expect(text(incomplete)).toContain("2 of 4 required · Missed cutoff");
    expect(text(incomplete)).toContain("35 /100");

    const missed = render(view(scored({ status: "MISSED", score: 0, completionPoints: 0, timingPoints: 0, requiredDone: 0, readyAt: null, deviationMinutes: null, bandLabel: null })));
    expect(text(missed)).toContain("Pre-session routine missed");
    expect(text(missed)).toContain("0 /100");
  });

  it("day off, unscheduled and not-yet-started states", () => {
    expect(text(render(view({ kind: "DAY_OFF" })))).toContain("Day off — doesn't affect your Preparation Streak");
    expect(text(render(view({ kind: "NOT_SCHEDULED" })))).toContain("Not a scheduled trading day");
    expect(text(render(view({ kind: "OUTSIDE_ERA", startsOn: "2026-10-08" })))).toContain("Preparation Schedule starts Thu, Oct 8");
  });

  it("restart feedback only when the read model says the streak restarted today", () => {
    const today = scored({ status: "ON_TIME", score: 100, timingPoints: 30 });
    expect(text(render(view(today, { streak: { current: 1, longest: 14, restartedToday: true } })))).toContain("New Preparation Streak started.");
    expect(render(view(today, { streak: { current: 1, longest: 14, restartedToday: false } }))).not.toContain("New Preparation Streak");
  });

  it("the breakdown shows the canonical points and times", () => {
    // PopoverTitle needs a Popover root: render the breakdown inside an open one.
    const html = renderToStaticMarkup(createElement(Popover, { open: true }, createElement(ScoreBreakdown, { today: scored(), timezone: NY })));
    const t = text(html);
    for (const s of ["Preparation 95 / 100", "Completion 70 / 70", "4 of 4 required items completed", "Timing 25 / 30", "Target 08:00", "Ready 08:17", "Deviation +17 min", "Status Late"]) {
      expect(t).toContain(s);
    }
    expect(t).not.toMatch(/pnl|win rate/i);
  });
});

describe("streak-break notice", () => {
  it("is factual, names the streak and the day, and offers Dismiss", () => {
    const html = renderToStaticMarkup(
      createElement(PreparationBreakNotice, {
        notice: { recordId: "r1", dateKey: "2026-10-05", status: "MISSED", endedLength: 14, longest: 14 },
        todayKey: "2026-10-07",
        onDismiss: () => {},
      }),
    );
    const t = text(html);
    expect(t).toContain("Your 14-day Preparation Streak ended");
    expect(t).toContain("Monday's pre-session routine wasn't completed.");
    expect(t).toContain("Best streak: 14 days");
    expect(t).toContain("Dismiss");
    expect(t.toLowerCase()).not.toMatch(/fail|undisciplined|bad trader/);
  });
});
