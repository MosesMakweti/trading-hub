import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/preparation.actions", () => ({ savePreparationScheduleAction: vi.fn(), addPreparationExceptionAction: vi.fn() }));

import { PreparationScheduleCard } from "@/components/settings/preparation-schedule-card";
import type { PreparationSettingsDTO } from "@/types/preparation";

/** Preparation Phase 3 — Settings → Routine → Preparation Schedule (first render). */

const NY = "America/New_York";
const settings = (over: Partial<PreparationSettingsDTO> = {}): PreparationSettingsDTO => ({
  todayKey: "2026-10-07",
  nextEffectiveFrom: "2026-10-08",
  current: null,
  upcoming: null,
  defaults: { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] },
  trader: { timezone: NY, configured: true, pendingTimezone: null },
  upcomingExceptions: [],
  ...over,
});
const render = (s: PreparationSettingsDTO) => renderToStaticMarkup(createElement(PreparationScheduleCard, { initial: s }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("Preparation Schedule card", () => {
  it("no schedule: explains the target, prefills the defaults, no exceptions section", () => {
    const html = render(settings());
    const t = text(html);
    expect(t).toContain("Not set up. Today shows no Preparation Score until you save a schedule.");
    expect(t).toContain("This is when you aim to have your pre-session preparation completed, in America/New_York.");
    expect(html).toMatch(/<label[^>]*for="prep-target"[^>]*>Target preparation time<\/label>/);
    expect(html).toContain('type="time"');
    expect(html).toContain('value="08:00"');
    expect(t).toContain("Start Preparation Schedule");
    expect(t).toContain("Changes take effect Thu, Oct 8");
    expect(t).not.toContain("Days off & extra days");
  });

  it("weekday toggles have names and pressed states", () => {
    const html = render(settings());
    expect(html).toContain('aria-label="Monday" title="Monday"');
    expect(html).toMatch(/aria-pressed="true" aria-label="Friday"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Saturday"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Sunday"/);
  });

  it("current vs upcoming, and the upcoming version prefills the form", () => {
    const html = render(
      settings({
        current: { timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" },
        upcoming: { timezone: NY, targetMinutes: 465, weekdays: [1, 3, 5], effectiveFrom: "2026-10-08" },
      }),
    );
    const t = text(html);
    expect(t).toContain("Current Mon–Fri · Target 08:00 · America/New_York");
    expect(t).toContain("Upcoming Mon, Wed, Fri · Target 07:45 · America/New_York");
    expect(t).toContain("Changes take effect: Thu, Oct 8");
    expect(html).toContain('value="07:45"');
    expect(html).toMatch(/aria-pressed="false" aria-label="Tuesday"/);
    expect(t).toContain("Save schedule");
  });

  it("lists upcoming exceptions with their meaning", () => {
    const t = text(
      render(
        settings({
          current: { timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" },
          upcomingExceptions: [
            { id: "a", dateKey: "2026-10-12", kind: "DAY_OFF", note: "Travel" },
            { id: "b", dateKey: "2026-10-18", kind: "EXTRA_DAY", note: null },
          ],
        }),
      ),
    );
    expect(t).toContain("Oct 12 Day off Travel Day off — does not affect your Preparation Streak.");
    expect(t).toContain("Oct 18 Extra trading day This day will count toward your Preparation Streak.");
  });

  describe("trading timezone not configured yet (Phase 3.1)", () => {
    const unset = { timezone: "UTC", configured: false, pendingTimezone: null };

    it("does not present the UTC fallback as the trader's choice: nothing selected, Save disabled", () => {
      const html = render(settings({ trader: unset }));
      expect(html).toMatch(/<option value="" disabled="" selected="">Choose your timezone…<\/option>/);
      expect(html).not.toMatch(/<option value="UTC" selected=""/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start Preparation Schedule<\/button>/);
      expect(text(html)).toContain("in your trading timezone.");
    });

    it("warns that saving establishes the trading timezone", () => {
      const t = text(render(settings({ trader: unset })));
      expect(t).toContain("You haven't set a trading timezone yet (UTC is used until you do).");
      expect(t).toContain("Saving this schedule sets your trading timezone to the zone you choose, from your next local day.");
    });

    it("a trader with an existing UTC-fallback schedule still gets no UTC preselection", () => {
      const html = render(settings({ trader: unset, current: { timezone: "UTC", targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" } }));
      expect(html).not.toMatch(/<option value="UTC" selected=""/);
      expect(text(html)).toContain("You haven't set a trading timezone yet");
    });

    it("configured (or scheduled) traders are unchanged: their zone is selected and there is no 'not set' warning", () => {
      for (const trader of [
        { timezone: NY, configured: true, pendingTimezone: null },
        { timezone: "UTC", configured: false, pendingTimezone: NY },
      ]) {
        const html = render(settings({ trader }));
        expect(html).toMatch(/<option value="America\/New_York" selected=""/);
        expect(html).not.toContain("prep-timezone-unset");
        expect(html).not.toContain("Choose your timezone…");
      }
    });
  });
});
