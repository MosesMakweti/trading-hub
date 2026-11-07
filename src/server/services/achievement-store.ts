import { prisma } from "@/server/db";
import { dateKeyToUtcDate } from "@/lib/date";

/**
 * The one place achievement unlocks are written.
 *
 * An unlock is a DisciplineAchievement row (unique per user and key, never
 * changed — DB trigger) plus its ProgressEvent (the celebration queue entry),
 * written together in one transaction under a per-user advisory lock, so
 * concurrent loads unlock (and queue) each achievement exactly once.
 * Refreshing, navigating or repeating a goal never awards it again.
 */

export interface StoredAchievement {
  key: string;
  achievedOn: Date;
  unlockedAt: Date;
  seenAt: Date | null;
}

const select = { key: true, achievedOn: true, unlockedAt: true, seenAt: true } as const;

export async function persistUnlocks(
  userId: string,
  unlocks: readonly { key: string; achievedOn: string }[],
  now: Date = new Date(),
): Promise<{ all: StoredAchievement[]; inserted: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`discipline-achievements:${userId}`}, 0))`;
    const existing = await tx.disciplineAchievement.findMany({ where: { userId }, select });
    const have = new Set(existing.map((e) => e.key));
    const fresh = unlocks.filter((u) => !have.has(u.key));
    if (fresh.length === 0) return { all: existing, inserted: [] };
    await tx.disciplineAchievement.createMany({
      data: fresh.map((u) => ({ userId, key: u.key, achievedOn: dateKeyToUtcDate(u.achievedOn), unlockedAt: now })),
      skipDuplicates: true,
    });
    await tx.progressEvent.createMany({
      data: fresh.map((u) => ({
        userId,
        kind: "ACHIEVEMENT" as const,
        achievementKey: u.key,
        occurredOn: dateKeyToUtcDate(u.achievedOn),
        createdAt: now,
      })),
      skipDuplicates: true,
    });
    const all = await tx.disciplineAchievement.findMany({ where: { userId }, select });
    return { all, inserted: fresh.map((u) => u.key) };
  });
}

/**
 * Marks celebrations seen: the given events (or all unseen ones). Achievement
 * events also mark their DisciplineAchievement seen, and vice versa, so the
 * Discipline page banner and the celebration queue never disagree. Own rows
 * only; `seenAt` is written once.
 */
export async function markCelebrationsSeen(
  userId: string,
  target: { eventIds: string[] } | { achievementKeys: string[] } | "ALL",
  now: Date = new Date(),
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let keys: string[] | null;
    let count: number;
    if (target === "ALL") {
      keys = null;
      ({ count } = await tx.progressEvent.updateMany({ where: { userId, seenAt: null }, data: { seenAt: now } }));
    } else if ("eventIds" in target) {
      const rows = await tx.progressEvent.findMany({
        where: { userId, id: { in: target.eventIds }, kind: "ACHIEVEMENT" },
        select: { achievementKey: true },
      });
      keys = rows.map((r) => r.achievementKey!).filter(Boolean);
      ({ count } = await tx.progressEvent.updateMany({ where: { userId, id: { in: target.eventIds }, seenAt: null }, data: { seenAt: now } }));
    } else {
      keys = target.achievementKeys;
      ({ count } = await tx.progressEvent.updateMany({
        where: { userId, kind: "ACHIEVEMENT", achievementKey: { in: keys }, seenAt: null },
        data: { seenAt: now },
      }));
    }
    const achievements = await tx.disciplineAchievement.updateMany({
      where: { userId, seenAt: null, ...(keys ? { key: { in: keys } } : {}) },
      data: { seenAt: now },
    });
    return Math.max(count, achievements.count);
  });
}
