import { describe, expect, it } from "vitest";

import { toPreparationDTO } from "@/server/services/preparation.mapper";
import type { PreparationState } from "@/server/services/preparation.service";
import type { PreparationScoreBreakdown } from "@/domain/discipline";

/** Preparation Phase 3 — the server/client serialization boundary (pure). */

const now = new Date("2026-10-07T13:00:00.000Z");
const NY = "America/New_York";
const schedule = { timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" };

const base = (over: Partial<PreparationState>): PreparationState => ({
  configured: true,
  schedule,
  pendingSchedule: null,
  todayKey: "2026-10-07",
  scoring: { completionMax: 70, timingMax: 30 },
  today: { kind: "NOT_SCHEDULED" },
  streak: { current: 3, longest: 9, lastBreak: null, restartedAfterBreak: false },
  notice: null,
  ...over,
});

const breakdown = (over: Partial<PreparationScoreBreakdown> = {}): PreparationScoreBreakdown => ({
  status: "LATE",
  final: true,
  completionPoints: 70,
  timingPoints: 25,
  score: 95,
  requiredTotal: 4,
  requiredDone: 4,
  targetAt: new Date("2026-10-07T12:00:00.000Z"),
  cutoffAt: new Date("2026-10-07T18:00:00.000Z"),
  readyAt: new Date("2026-10-07T12:17:00.000Z"),
  deviationMs: 17 * 60_000,
  deviationMinutes: 17,
  bandLabel: "Late",
  scoringVersion: 1,
  ...over,
});

/** True when a value survives JSON unchanged and contains no Date/class instances. */
function isPlainJson(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === "object") return Object.getPrototypeOf(value) === Object.prototype && Object.values(value as object).every(isPlainJson);
  return false;
}

describe("toPreparationDTO", () => {
  it("no schedule → { configured: false } only (Today stays unchanged)", () => {
    const dto = toPreparationDTO(
      { configured: false, schedule: null, pendingSchedule: null, todayKey: null, scoring: null, today: { kind: "OUTSIDE_ERA" }, streak: { current: 0, longest: 0, lastBreak: null, restartedAfterBreak: false }, notice: null },
      now,
    );
    expect(dto).toEqual({ configured: false });
  });

  it("scored day: canonical values verbatim, instants as ISO strings, plain JSON throughout", () => {
    const dto = toPreparationDTO(base({ today: { kind: "SCORED", breakdown: breakdown(), corrected: null } }), now);
    expect(isPlainJson(dto)).toBe(true);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
    expect(dto).toMatchObject({
      configured: true,
      serverNow: "2026-10-07T13:00:00.000Z",
      timezone: NY,
      today: {
        kind: "SCORED",
        status: "LATE",
        score: 95,
        completionPoints: 70,
        timingPoints: 25,
        completionMax: 70,
        timingMax: 30,
        targetAt: "2026-10-07T12:00:00.000Z",
        readyAt: "2026-10-07T12:17:00.000Z",
        deviationMinutes: 17,
        bandLabel: "Late",
      },
      streak: { current: 3, longest: 9, restartedToday: false },
    });
    // The raw millisecond deviation never crosses the boundary.
    expect(JSON.stringify(dto)).not.toContain("deviationMs");
  });

  it("pending day carries the server-computed target context", () => {
    const dto = toPreparationDTO(
      base({
        today: {
          kind: "PENDING",
          pending: {
            status: "PENDING",
            final: false,
            requiredTotal: 4,
            requiredDone: 1,
            targetAt: new Date("2026-10-07T13:25:00.000Z"),
            cutoffAt: new Date("2026-10-07T19:25:00.000Z"),
            minutesToTarget: 25,
          },
        },
      }),
      now,
    );
    expect(dto.configured && dto.today).toEqual({
      kind: "PENDING",
      targetAt: "2026-10-07T13:25:00.000Z",
      cutoffAt: "2026-10-07T19:25:00.000Z",
      minutesToTarget: 25,
      requiredTotal: 4,
      requiredDone: 1,
    });
    expect(isPlainJson(dto)).toBe(true);
  });

  it("restartedToday only on the day that started a new streak", () => {
    const restarted = { current: 1, longest: 14, lastBreak: { dateKey: "2026-10-06", status: "MISSED" as const, endedLength: 14 }, restartedAfterBreak: true };
    const scoredToday = base({ streak: restarted, today: { kind: "SCORED", breakdown: breakdown({ status: "ON_TIME", timingPoints: 30, score: 100 }), corrected: null } });
    expect(toPreparationDTO(scoredToday, now).configured && toPreparationDTO(scoredToday, now)).toMatchObject({ streak: { restartedToday: true } });
    // Same streak, but today is a weekend (the new streak started earlier): no repeat.
    const later = base({ streak: restarted, today: { kind: "NOT_SCHEDULED" } });
    expect(toPreparationDTO(later, now)).toMatchObject({ streak: { restartedToday: false } });
    // Streak of 2 after a restart: no repeat either.
    const second = base({ streak: { ...restarted, current: 2 }, today: scoredToday.today });
    expect(toPreparationDTO(second, now)).toMatchObject({ streak: { restartedToday: false } });
  });

  it("notice, corrections and a not-yet-started schedule", () => {
    const notice = { recordId: "rec_1", dateKey: "2026-10-06", status: "MISSED" as const, endedLength: 14, longest: 14 };
    const dto = toPreparationDTO(
      base({ notice, today: { kind: "SCORED", breakdown: breakdown({ status: "MISSED", score: 0, completionPoints: 0, timingPoints: 0, readyAt: null, deviationMs: null, deviationMinutes: null, bandLabel: null }), corrected: { status: "DAY_OFF", score: 0 } } }),
      now,
    );
    expect(dto).toMatchObject({ notice, today: { status: "MISSED", corrected: { status: "DAY_OFF", score: 0 }, readyAt: null } });
    const upcoming = toPreparationDTO(base({ schedule: null, pendingSchedule: { ...schedule, effectiveFrom: "2026-10-08" }, today: { kind: "OUTSIDE_ERA" } }), now);
    expect(upcoming).toMatchObject({ timezone: NY, today: { kind: "OUTSIDE_ERA", startsOn: "2026-10-08" } });
  });
});
