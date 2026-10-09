import { DEFAULT_PREPARATION_SCHEDULE, STREAK_COUNTED } from "@/domain/discipline";
import type { PreparationScheduleOverview, PreparationState } from "@/server/services/preparation.service";
import type { TraderTimezoneState } from "@/server/services/trader-time.service";
import type { PreparationDTO, PreparationSettingsDTO, PreparationTodayDTO } from "@/types/preparation";

/**
 * Preparation read model → UI transport (Phase 3). The serialization
 * boundary: Dates become ISO strings, and every value is copied from the
 * canonical read model — nothing is re-scored here. The only derivation is
 * `restartedToday`, which narrows the read model's `restartedAfterBreak`
 * (true for the whole new streak) to the one date that started it, so the
 * "New streak started" line is shown on that day only.
 */
export function toPreparationDTO(state: PreparationState, now: Date): PreparationDTO {
  if (!state.configured || !state.todayKey) return { configured: false };
  const iso = (d: Date) => d.toISOString();
  const t = state.today;
  let today: PreparationTodayDTO;
  switch (t.kind) {
    case "OUTSIDE_ERA":
      today = { kind: "OUTSIDE_ERA", startsOn: state.pendingSchedule?.effectiveFrom ?? null };
      break;
    case "NOT_SCHEDULED":
    case "DAY_OFF":
      today = { kind: t.kind };
      break;
    case "PENDING":
      today = {
        kind: "PENDING",
        targetAt: iso(t.pending.targetAt),
        cutoffAt: iso(t.pending.cutoffAt),
        minutesToTarget: t.pending.minutesToTarget,
        requiredTotal: t.pending.requiredTotal,
        requiredDone: t.pending.requiredDone,
      };
      break;
    case "SCORED": {
      const b = t.breakdown;
      today = {
        kind: "SCORED",
        status: b.status,
        score: b.score,
        completionPoints: b.completionPoints,
        timingPoints: b.timingPoints,
        completionMax: state.scoring?.completionMax ?? 70,
        timingMax: state.scoring?.timingMax ?? 30,
        requiredTotal: b.requiredTotal,
        requiredDone: b.requiredDone,
        targetAt: iso(b.targetAt),
        cutoffAt: iso(b.cutoffAt),
        readyAt: b.readyAt ? iso(b.readyAt) : null,
        deviationMinutes: b.deviationMinutes,
        bandLabel: b.bandLabel,
        corrected: t.corrected ? { status: t.corrected.status, score: t.corrected.score } : null,
      };
      break;
    }
  }

  const todayCounted = today.kind === "SCORED" && STREAK_COUNTED.has(today.corrected?.status ?? today.status);
  return {
    configured: true,
    serverNow: iso(now),
    todayKey: state.todayKey,
    timezone: state.schedule?.timezone ?? state.pendingSchedule?.timezone ?? "UTC",
    schedule: state.schedule ? { ...state.schedule, weekdays: [...state.schedule.weekdays] } : null,
    pendingSchedule: state.pendingSchedule ? { ...state.pendingSchedule, weekdays: [...state.pendingSchedule.weekdays] } : null,
    today,
    streak: {
      current: state.streak.current,
      longest: state.streak.longest,
      restartedToday: state.streak.restartedAfterBreak && state.streak.current === 1 && todayCounted,
    },
    notice: state.notice ? { ...state.notice } : null,
  };
}

export function toPreparationSettingsDTO(overview: PreparationScheduleOverview, trader: TraderTimezoneState): PreparationSettingsDTO {
  return {
    todayKey: overview.todayKey,
    nextEffectiveFrom: overview.nextEffectiveFrom,
    current: overview.current ? { ...overview.current, weekdays: [...overview.current.weekdays] } : null,
    upcoming: overview.upcoming ? { ...overview.upcoming, weekdays: [...overview.upcoming.weekdays] } : null,
    defaults: { targetMinutes: DEFAULT_PREPARATION_SCHEDULE.targetMinutes, weekdays: [...DEFAULT_PREPARATION_SCHEDULE.weekdays] },
    trader: { timezone: trader.timezone, configured: trader.configured, pendingTimezone: trader.pending?.timezone ?? null },
    upcomingExceptions: overview.upcomingExceptions.map((e) => ({ ...e })),
  };
}
