import { prisma } from "@/server/db";
import { runLive } from "@/server/workspace/scope";
import { getTimezoneVersions } from "@/server/services/trader-time.service";
import { getScheduleVersions } from "@/server/services/preparation.service";
import { getTradeReviewFacts } from "@/server/services/trade-review-v3.service";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { effectiveTimezoneAt, traderTodayKey, type TimezoneVersion } from "@/domain/time/trader-calendar";
import { deriveBiasAlignment } from "@/domain/psychology/review-adapter";
import { stopWidened } from "@/domain/trades/review-evidence";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_STREAK_THRESHOLDS,
  STREAK_MILESTONES,
  TRACK_KEYS,
  buildDisciplineDays,
  deriveDailyStreak,
  evaluateAchievements,
  evaluatePlanAdherence,
  evaluateRoutineDay,
  milestoneAt,
  milestoneProgress,
  routineDayRequirement,
  skippedDateKeys,
  trackSeries,
  traderDateKeyOf,
  type AchievementEvaluation,
  type AdherenceTradeFact,
  type DailyStreak,
  type DayRequirement,
  type DisciplineDay,
  type PlanAdherenceResult,
  type ReviewCreditFact,
  type RoutineDayEvaluation,
  type TrackKey,
} from "@/domain/discipline/streaks";
import type {
  AchievementDTO,
  DisciplineFeedbackDTO,
  DisciplineOverviewDTO,
  StreakTrackDTO,
} from "@/types/discipline";

/**
 * Discipline Streaks — 🔥 routine · 📝 review · 🎯 plan adherence (LIVE only).
 *
 *   persisted facts (TradingDay, Trade, review state, Preparation Schedule,
 *   trader timezone) → pure day series (domain/discipline/streaks)
 *   → derived streaks + totals → achievements (persisted once, append-only)
 *
 * Nothing here is a counter: every read recomputes from the records, so an
 * edited or deleted trade/day corrects every streak and total immediately,
 * and a duplicate submit can't add anything twice (one status per date, one
 * credit per trade). Only achievements are stored — the first time they are
 * observed, never removed. Backtesting / Replay never contribute: every read
 * is pinned to the LIVE scope with `backtestRunId: null`.
 */

const STREAK_THRESHOLDS = [...new Set([...STREAK_MILESTONES, ...ACHIEVEMENT_STREAK_THRESHOLDS])];

const hasText = (s: string | null | undefined) => typeof s === "string" && s.trim().length > 0;
const num = (v: { toNumber(): number } | null | undefined): number | null => (v == null ? null : v.toNumber());

export interface DisciplineComputation {
  todayKey: string;
  timezone: string;
  days: DisciplineDay[];
  streaks: Record<TrackKey, DailyStreak>;
  totals: Record<TrackKey, number>;
  evaluations: AchievementEvaluation[];
  /** Per trade: its review credit date (null = not credited). */
  reviewCredit: Map<string, string | null>;
  /** Per executed trade: its plan-adherence result. */
  adherence: Map<string, PlanAdherenceResult>;
  routineDays: Map<string, RoutineDayEvaluation>;
}

/** Loads every fact and derives the three tracks. Read-only. */
export async function computeDiscipline(userId: string, now: Date = new Date()): Promise<DisciplineComputation> {
  return runLive(async () => {
    const tz: TimezoneVersion[] = await getTimezoneVersions(userId);
    const todayKey = traderTodayKey(tz, now);
    const keyOf = (d: Date) => traderDateKeyOf(tz, d);

    const [user, tradingDays, trades, scheduleVersions, exceptions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
      prisma.tradingDay.findMany({
        where: { userId, backtestRunId: null },
        select: {
          date: true,
          routineFirstReadyAt: true,
          routineReadyAt: true,
          analyzedAt: true,
          dayWentWell: true,
          dayToImprove: true,
          dayMainLesson: true,
          dayCarryForward: true,
        },
      }),
      prisma.trade.findMany({
        where: { userId, backtestRunId: null, OR: [{ actualEntry: { not: null } }, { actualRR: { not: null } }] },
        select: {
          id: true,
          tradeDate: true,
          direction: true,
          dailyBiasSnapshot: true,
          tradeIntent: true,
          adherenceAnswers: true,
          setupValid: true,
          validationState: true,
          limitOverrideReason: true,
          actualStopLoss: true,
          actualRR: true,
          reviewedAt: true,
          finalReviewCreditedAt: true,
          psychology: { select: { answers: true } },
        },
      }),
      getScheduleVersions(userId),
      prisma.preparationDayException.findMany({ where: { userId }, select: { date: true, kind: true, createdAt: true } }),
    ]);
    const facts = await getTradeReviewFacts(userId, trades.map((t) => t.id));

    // 🔥 Routine days.
    const routineDays = new Map<string, RoutineDayEvaluation>();
    for (const d of tradingDays) {
      const dateKey = utcDateToKey(d.date);
      const readyAt = d.routineFirstReadyAt ?? d.routineReadyAt;
      routineDays.set(
        dateKey,
        evaluateRoutineDay({
          dateKey,
          readyDateKey: readyAt ? keyOf(readyAt) : null,
          closedDateKey: d.analyzedAt ? keyOf(d.analyzedAt) : null,
          hasReflection: [d.dayWentWell, d.dayToImprove, d.dayMainLesson, d.dayCarryForward].some(hasText),
        }),
      );
    }

    // 📝 Review credits and 🎯 plan adherence, per trade.
    const reviews: ReviewCreditFact[] = [];
    const adherenceFacts: AdherenceTradeFact[] = [];
    const reviewCredit = new Map<string, string | null>();
    const adherence = new Map<string, PlanAdherenceResult>();
    for (const t of trades) {
      const f = facts[t.id];
      if (!f || (f.cancelled && !f.hasActualEntry)) continue;
      const tradeDateKey = utcDateToKey(t.tradeDate);
      const complete = f.state === "FINAL_REVIEW_COMPLETE";
      const creditAt = t.finalReviewCreditedAt ?? t.reviewedAt;
      const creditDateKey = complete && creditAt ? keyOf(creditAt) : null;
      const closedKey = f.closed ? (f.closedMoment ? keyOf(f.closedMoment) : tradeDateKey) : null;
      reviews.push({ tradeId: t.id, creditDateKey, closedDateKey: closedKey && closedKey < tradeDateKey ? tradeDateKey : closedKey });
      reviewCredit.set(t.id, creditDateKey);

      const psych = (t.psychology?.answers as Record<string, unknown> | undefined) ?? {};
      const result = evaluatePlanAdherence({
        executed: f.hasActualEntry || t.actualRR != null,
        reviewComplete: complete,
        adherenceAnswers: (t.adherenceAnswers as Record<string, boolean> | null) ?? {},
        tradeIntent: t.tradeIntent,
        setupValid: t.setupValid,
        validationState: t.validationState,
        hasLimitOverride: hasText(t.limitOverrideReason),
        biasAlignment: deriveBiasAlignment(t.direction, t.dailyBiasSnapshot),
        stopWidened: stopWidened(t.direction, f.resolvedInitialStop, num(t.actualStopLoss)),
        riskManaged: typeof psych.riskManaged === "string" ? psych.riskManaged : null,
        followedExitPlan: typeof psych.followedExitPlan === "string" ? psych.followedExitPlan : null,
      });
      adherence.set(t.id, result);
      if (tradeDateKey <= todayKey) adherenceFacts.push({ tradeId: t.id, tradeDateKey, status: result.status });
    }

    // The series starts at the trader's first day on record (account creation,
    // or earlier imported history), so a streak is never broken before it began.
    const candidates = [
      user ? keyOf(user.createdAt) : todayKey,
      ...routineDays.keys(),
      ...adherenceFacts.map((a) => a.tradeDateKey),
      ...reviews.flatMap((r) => [r.closedDateKey, r.creditDateKey].filter((k): k is string => k != null)),
    ];
    const from = candidates.reduce((m, k) => (k < m ? k : m), todayKey);

    const exceptionFacts = exceptions.map((e) => ({ dateKey: utcDateToKey(e.date), kind: e.kind, createdAt: e.createdAt }));
    const requirementCache = new Map<string, DayRequirement>();
    const requirement = (k: string) => {
      let r = requirementCache.get(k);
      if (r == null) {
        r = routineDayRequirement(scheduleVersions, exceptionFacts, k);
        requirementCache.set(k, r);
      }
      return r;
    };

    const days = buildDisciplineDays({
      from,
      todayKey,
      requirement,
      skipped: skippedDateKeys(tz, from, todayKey),
      routineDays,
      reviews,
      adherence: adherenceFacts,
    });

    const streaks = Object.fromEntries(
      TRACK_KEYS.map((k) => [k, deriveDailyStreak(trackSeries(days, k), STREAK_THRESHOLDS)]),
    ) as Record<TrackKey, DailyStreak>;

    const routineCredits = days.filter((d) => d.routine === "ACTIVE").map((d) => d.dateKey);
    const reviewCredits = reviews
      .map((r) => r.creditDateKey)
      .filter((k): k is string => k != null && k <= todayKey)
      .sort();
    const perfectCredits = adherenceFacts
      .filter((a) => a.status === "PERFECT")
      .map((a) => a.tradeDateKey)
      .sort();

    const evaluations = evaluateAchievements({
      routine: { creditDates: routineCredits, longest: streaks.routine.longest, streakReachedOn: streaks.routine.reachedOn },
      review: { creditDates: reviewCredits, longest: streaks.review.longest, streakReachedOn: streaks.review.reachedOn },
      adherence: { creditDates: perfectCredits, longest: streaks.adherence.longest, streakReachedOn: streaks.adherence.reachedOn },
    });

    return {
      todayKey,
      timezone: effectiveTimezoneAt(tz, now),
      days,
      streaks,
      totals: { routine: routineCredits.length, review: reviewCredits.length, adherence: perfectCredits.length },
      evaluations,
      reviewCredit,
      adherence,
      routineDays,
    };
  });
}

// ── Achievements (persisted, append-only) ───────────────────────────────────

export interface StoredAchievement {
  key: string;
  achievedOn: Date;
  unlockedAt: Date;
  seenAt: Date | null;
}

/**
 * Persists every achievement the derived history shows as met and that is
 * not stored yet. Per-user advisory lock + the (userId, key) unique
 * constraint + skipDuplicates: concurrent loads unlock each achievement
 * exactly once. Existing rows are never touched (DB trigger), so an
 * achievement stays earned even if the records behind it change later.
 */
export async function syncAchievements(
  userId: string,
  evaluations: readonly AchievementEvaluation[],
  now: Date = new Date(),
): Promise<{ all: StoredAchievement[]; inserted: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`discipline-achievements:${userId}`}, 0))`;
    const existing = await tx.disciplineAchievement.findMany({
      where: { userId },
      select: { key: true, achievedOn: true, unlockedAt: true, seenAt: true },
    });
    const have = new Set(existing.map((e) => e.key));
    const fresh = evaluations.filter((e) => e.achieved && e.achievedOn != null && !have.has(e.key));
    if (fresh.length === 0) return { all: existing, inserted: [] };
    await tx.disciplineAchievement.createMany({
      data: fresh.map((e) => ({ userId, key: e.key, achievedOn: dateKeyToUtcDate(e.achievedOn!), unlockedAt: now })),
      skipDuplicates: true,
    });
    const all = await tx.disciplineAchievement.findMany({
      where: { userId },
      select: { key: true, achievedOn: true, unlockedAt: true, seenAt: true },
    });
    return { all, inserted: fresh.map((e) => e.key) };
  });
}

/** Dismisses the celebration of the given (or all) unseen achievements. Own rows only. */
export async function acknowledgeAchievements(userId: string, keys: string[] | null, now: Date = new Date()): Promise<number> {
  const { count } = await prisma.disciplineAchievement.updateMany({
    where: { userId, seenAt: null, ...(keys ? { key: { in: keys } } : {}) },
    data: { seenAt: now },
  });
  return count;
}

// ── Read model ──────────────────────────────────────────────────────────────

function trackDTO(c: DisciplineComputation, key: TrackKey): StreakTrackDTO {
  const s = c.streaks[key];
  const today = c.days[c.days.length - 1];
  const todayStatus = today?.[key] ?? "PENDING";
  const creditedToday = todayStatus === "ACTIVE";
  return {
    key,
    current: s.current,
    longest: s.longest,
    total: c.totals[key],
    activeDays: s.activeDays,
    todayStatus,
    creditedToday,
    lastActiveOn: s.lastActiveOn,
    currentStartedOn: s.currentStartedOn,
    lastBreak: s.lastBreak,
    milestone: milestoneProgress(s.current),
    milestoneReached: creditedToday ? milestoneAt(s.current) : null,
  };
}

/** How many calendar days the activity graph shows. */
export const DISCIPLINE_CALENDAR_DAYS = 371; // 53 weeks

export async function getDisciplineOverview(userId: string, now: Date = new Date()): Promise<DisciplineOverviewDTO> {
  const c = await computeDiscipline(userId, now);
  const { all } = await syncAchievements(userId, c.evaluations, now);
  const stored = new Map(all.map((a) => [a.key, a]));
  const evalByKey = new Map(c.evaluations.map((e) => [e.key, e]));

  const achievements: AchievementDTO[] = ACHIEVEMENTS.map((a) => {
    const row = stored.get(a.key);
    const e = evalByKey.get(a.key)!;
    return {
      key: a.key,
      track: a.track,
      title: a.title,
      description: a.description,
      target: a.target,
      progress: row ? a.target : e.progress,
      unlocked: row != null,
      achievedOn: row ? utcDateToKey(row.achievedOn) : null,
      unlockedAt: row ? row.unlockedAt.toISOString() : null,
      isNew: row != null && row.seenAt == null,
    };
  });

  const today = c.days[c.days.length - 1];
  return {
    todayKey: c.todayKey,
    timezone: c.timezone,
    tracks: { routine: trackDTO(c, "routine"), review: trackDTO(c, "review"), adherence: trackDTO(c, "adherence") },
    today: {
      requirement: today?.requirement ?? "OPTIONAL",
      routinePreSession: today?.routinePreSession ?? false,
      routinePostSession: today?.routinePostSession ?? false,
      reviewsOutstanding: today?.reviewsOutstanding ?? 0,
      tradesAwaitingReview: c.days.reduce((n, d) => n + d.tradesAwaitingReview, 0),
    },
    adherencePendingDays: c.days.filter((d) => d.adherence === "PENDING").length,
    calendar: c.days.slice(-DISCIPLINE_CALENDAR_DAYS),
    achievements,
  };
}

// ── Action feedback ─────────────────────────────────────────────────────────

function newAchievementList(inserted: string[]) {
  return ACHIEVEMENTS.filter((a) => inserted.includes(a.key)).map((a) => ({ key: a.key, title: a.title }));
}

/** After a review completion: did it count, and where do the streaks stand? Never throws. */
export async function reviewFeedback(userId: string, tradeId: string, now: Date = new Date()): Promise<DisciplineFeedbackDTO | null> {
  try {
    const c = await computeDiscipline(userId, now);
    const { inserted } = await syncAchievements(userId, c.evaluations, now);
    const review = trackDTO(c, "review");
    const adh = trackDTO(c, "adherence");
    return {
      kind: "REVIEW",
      routine: null,
      review: { counted: c.reviewCredit.get(tradeId) != null, totalReviewed: c.totals.review, streak: review.current, milestoneReached: review.milestoneReached },
      adherence: {
        perfect: c.adherence.get(tradeId)?.status === "PERFECT",
        totalPerfect: c.totals.adherence,
        streak: adh.current,
        milestoneReached: adh.milestoneReached,
      },
      newAchievements: newAchievementList(inserted),
    };
  } catch (e) {
    console.error("[discipline] review feedback failed", e);
    return null;
  }
}

/** After a readiness confirmation or day close: is the routine day complete? Never throws. */
export async function routineFeedback(userId: string, dateKey: string, now: Date = new Date()): Promise<DisciplineFeedbackDTO | null> {
  try {
    const c = await computeDiscipline(userId, now);
    const { inserted } = await syncAchievements(userId, c.evaluations, now);
    const routine = trackDTO(c, "routine");
    return {
      kind: "ROUTINE",
      routine: {
        complete: c.routineDays.get(dateKey)?.complete === true,
        preSession: c.routineDays.get(dateKey)?.preSession === true,
        postSession: c.routineDays.get(dateKey)?.postSession === true,
        streak: routine.current,
        milestoneReached: dateKey === c.todayKey ? routine.milestoneReached : null,
      },
      review: null,
      adherence: null,
      newAchievements: newAchievementList(inserted),
    };
  } catch (e) {
    console.error("[discipline] routine feedback failed", e);
    return null;
  }
}
