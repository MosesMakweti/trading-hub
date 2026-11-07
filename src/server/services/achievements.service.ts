import { prisma } from "@/server/db";
import { runLive } from "@/server/workspace/scope";
import { computeDiscipline, type DisciplineComputation } from "@/server/services/discipline-streaks.service";
import { markCelebrationsSeen, persistUnlocks } from "@/server/services/achievement-store";
import { getTimezoneVersions } from "@/server/services/trader-time.service";
import { utcDateToKey } from "@/lib/date";
import { traderDateKeyOf } from "@/domain/discipline/streaks/calendar";
import { RISK_VIOLATION_KEYS } from "@/domain/discipline/streaks/plan-adherence";
import { richTextHasContent } from "@/domain/goals";
import {
  ACHIEVEMENT_CATALOGUE,
  ACHIEVEMENT_CATEGORIES,
  achievementByKey,
  evaluateAllAchievements,
  goalCompletionLevel,
  milestoneLevel,
  type AchievementFacts,
  type AchievementResult,
} from "@/domain/achievements";
import type { AchievementDTO, AchievementsOverviewDTO, CelebrationDTO, CelebrationPreferencesDTO } from "@/types/achievements";

/**
 * Achievements — the central engine (LIVE only).
 *
 *   existing records + final goal days → evaluateAllAchievements (pure)
 *   → persistUnlocks (DisciplineAchievement + ProgressEvent, exactly once)
 *
 * Unlocks are only ever added. Celebrations are ProgressEvent rows that stay
 * queued until the trader dismisses them, so anything earned while they were
 * away (another device, the extension API, a day that finalized overnight)
 * is waiting for them on their next visit, and shown once.
 */

/** Gathers every fact the catalogue reads. `c` is reused when the caller already computed it. */
export async function loadAchievementFacts(userId: string, c: DisciplineComputation): Promise<AchievementFacts> {
  const [goals, notes, cycles, tz] = await Promise.all([
    prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { status: true, targetDays: true, completedOn: true, days: { orderBy: { date: "asc" }, select: { date: true, status: true, streakAfter: true } }, id: true },
    }),
    runLive(() => prisma.dailyNote.findMany({ where: { userId, backtestRunId: null }, select: { date: true, content: true } })),
    prisma.replayReviewSession.findMany({ where: { userId, status: "COMPLETED", completedAt: { not: null } }, select: { completedAt: true } }),
    getTimezoneVersions(userId),
  ]);

  const today = c.todayKey;
  const reviewed = c.trades.filter((t) => t.creditDateKey != null && t.creditDateKey <= today);
  const riskClean = reviewed.filter((t) => ![...t.objective, ...t.judged].some((v) => RISK_VIOLATION_KEYS.has(v.key)));

  return {
    discipline: c.evaluations,
    goalDays: goals.flatMap((g) => g.days.map((d) => ({ goalId: g.id, dateKey: utcDateToKey(d.date), status: d.status, streakAfter: d.streakAfter }))),
    reviewDates: reviewed.map((t) => t.creditDateKey!).sort(),
    riskCleanDates: riskClean.map((t) => t.creditDateKey!).sort(),
    journalDates: notes
      .filter((n) => richTextHasContent(n.content))
      .map((n) => utcDateToKey(n.date))
      .filter((k) => k <= today)
      .sort(),
    reviewCycleDates: cycles.map((r) => traderDateKeyOf(tz, r.completedAt!)).sort(),
    completedGoals: goals
      .filter((g) => g.status === "COMPLETED" && g.completedOn)
      .map((g) => ({ completedOn: utcDateToKey(g.completedOn!), targetDays: g.targetDays }))
      .sort((a, b) => (a.completedOn < b.completedOn ? -1 : a.completedOn > b.completedOn ? 1 : 0)),
  };
}

export interface AchievementSync {
  results: AchievementResult[];
  inserted: string[];
  stored: Map<string, { achievedOn: string; unlockedAt: Date }>;
}

/** Evaluates the whole catalogue and persists anything newly met. Idempotent. */
export async function syncAllAchievements(userId: string, c?: DisciplineComputation, now: Date = new Date()): Promise<AchievementSync> {
  const computation = c ?? (await computeDiscipline(userId, now));
  const facts = await loadAchievementFacts(userId, computation);
  const results = evaluateAllAchievements(facts);
  const unlocks = results.filter((r) => r.achieved && r.achievedOn != null).map((r) => ({ key: r.key, achievedOn: r.achievedOn! }));
  const { all, inserted } = await persistUnlocks(userId, unlocks, now);
  return {
    results,
    inserted,
    stored: new Map(all.map((a) => [a.key, { achievedOn: utcDateToKey(a.achievedOn), unlockedAt: a.unlockedAt }])),
  };
}

// ── Read models ─────────────────────────────────────────────────────────────

/** The Achievement Cabinet: every achievement, unlocked or with its progress. */
export function achievementsOverview(sync: AchievementSync): AchievementsOverviewDTO {
  const results = new Map(sync.results.map((r) => [r.key, r]));
  const achievements: AchievementDTO[] = ACHIEVEMENT_CATALOGUE.map((a) => {
    const stored = sync.stored.get(a.key);
    const r = results.get(a.key);
    return {
      key: a.key,
      category: a.category,
      title: a.title,
      description: a.description,
      level: a.level,
      icon: a.icon,
      unit: a.unit,
      target: a.target,
      // An unlock is permanent, even if the records behind it changed since.
      progress: stored ? a.target : (r?.progress ?? 0),
      unlocked: stored != null,
      achievedOn: stored?.achievedOn ?? null,
      unlockedAt: stored ? stored.unlockedAt.toISOString() : null,
    };
  });
  const unlocked = achievements.filter((a) => a.unlocked).length;
  return {
    unlocked,
    total: achievements.length,
    percent: Math.round((unlocked / achievements.length) * 100),
    categories: ACHIEVEMENT_CATEGORIES.map((cat) => {
      const inCat = achievements.filter((a) => a.category === cat.key);
      return { ...cat, unlocked: inCat.filter((a) => a.unlocked).length, total: inCat.length };
    }),
    achievements,
    recent: achievements
      .filter((a) => a.unlocked)
      .sort((a, b) => (b.unlockedAt! < a.unlockedAt! ? -1 : b.unlockedAt! > a.unlockedAt! ? 1 : (b.achievedOn ?? "").localeCompare(a.achievedOn ?? "")))
      .slice(0, 6),
  };
}

export async function getAchievementsOverview(userId: string, now: Date = new Date()): Promise<AchievementsOverviewDTO> {
  return achievementsOverview(await syncAllAchievements(userId, undefined, now));
}

/** How many celebrations a single read returns at most (the rest wait their turn). */
export const CELEBRATION_BATCH = 20;

/**
 * Unseen celebrations, biggest first, then oldest first. Nothing is marked
 * seen here: only an explicit dismissal does that, so a celebration survives
 * a refresh or a closed tab until the trader has actually seen it.
 */
export async function getPendingCelebrations(userId: string): Promise<CelebrationDTO[]> {
  const rows = await prisma.progressEvent.findMany({
    where: { userId, seenAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: { goal: { select: { name: true, targetDays: true } } },
  });
  const out: CelebrationDTO[] = [];
  for (const e of rows) {
    const occurredOn = utcDateToKey(e.occurredOn);
    if (e.kind === "ACHIEVEMENT") {
      const def = e.achievementKey ? achievementByKey(e.achievementKey) : undefined;
      if (!def) continue; // a key retired from the catalogue: nothing to show
      out.push({ id: e.id, kind: e.kind, level: def.level, title: def.title, description: def.description, icon: def.icon, occurredOn, days: null, goalName: null, achievementKey: def.key });
    } else if (e.kind === "MILESTONE") {
      const days = e.days ?? 0;
      out.push({
        id: e.id,
        kind: e.kind,
        level: milestoneLevel(days),
        title: `${days} trading days in a row`,
        description: e.goal ? `A ${days}-day streak on “${e.goal.name}”.` : `A ${days}-day streak.`,
        icon: days >= 30 ? "Flame" : "CalendarCheck",
        occurredOn,
        days,
        goalName: e.goal?.name ?? null,
        achievementKey: null,
      });
    } else {
      const target = e.goal?.targetDays ?? 0;
      out.push({
        id: e.id,
        kind: e.kind,
        level: goalCompletionLevel(target),
        title: e.goal?.name ?? "Your goal",
        description: `${target} consecutive qualifying trading days — every one of them counted.`,
        icon: "Trophy",
        occurredOn,
        days: target,
        goalName: e.goal?.name ?? null,
        achievementKey: null,
      });
    }
  }
  // Biggest first; ties keep their creation order (stable sort).
  return out.sort((a, b) => b.level - a.level).slice(0, CELEBRATION_BATCH);
}

/** Dismisses the given celebrations (or all of them). Own rows only. */
export async function dismissCelebrations(userId: string, eventIds: string[] | null, now: Date = new Date()): Promise<number> {
  return markCelebrationsSeen(userId, eventIds ? { eventIds } : "ALL", now);
}

// ── Preferences ─────────────────────────────────────────────────────────────

export async function getCelebrationPreferences(userId: string): Promise<CelebrationPreferencesDTO> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { celebrationAnimations: true, celebrationSound: true } });
  return { animations: u.celebrationAnimations, sound: u.celebrationSound };
}

export async function setCelebrationPreferences(userId: string, prefs: Partial<CelebrationPreferencesDTO>): Promise<CelebrationPreferencesDTO> {
  const u = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(prefs.animations != null ? { celebrationAnimations: prefs.animations } : {}),
      ...(prefs.sound != null ? { celebrationSound: prefs.sound } : {}),
    },
    select: { celebrationAnimations: true, celebrationSound: true },
  });
  return { animations: u.celebrationAnimations, sound: u.celebrationSound };
}
