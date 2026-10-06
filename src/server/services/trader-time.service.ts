import { prisma } from "@/server/db";
import {
  effectiveFromForChange,
  effectiveTimezoneAt,
  isValidTimeZone,
  pendingTimezoneAt,
  traderTodayKey,
  type TimezoneVersion,
} from "@/domain/time/trader-calendar";

/**
 * The trader's canonical timezone and "today" (Preparation Phase 0).
 *
 * Every server surface that needs "what date is it for this trader?" calls
 * `getTraderTodayKey` — never `new Date()` + a server/browser-local getter.
 * The instant is always the server clock; only the calendar is the
 * trader's. A trader with no configured timezone keeps the UTC calendar
 * (identical to the previous behaviour on Vercel).
 */

export async function getTimezoneVersions(userId: string): Promise<TimezoneVersion[]> {
  return prisma.traderTimezoneVersion.findMany({
    where: { userId },
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    select: { timezone: true, effectiveFrom: true, createdAt: true },
  });
}

/** The trader's local date key right now (server clock, trader calendar). */
export async function getTraderTodayKey(userId: string, now: Date = new Date()): Promise<string> {
  return traderTodayKey(await getTimezoneVersions(userId), now);
}

export interface TraderTimezoneState {
  /** The zone governing the trader's calendar now. */
  timezone: string;
  /** False until the trader has confirmed a timezone (UTC fallback in use). */
  configured: boolean;
  /** A confirmed change that starts at the next local date, if any. */
  pending: { timezone: string; effectiveFrom: string } | null;
  todayKey: string;
}

export async function getTraderTimezoneState(userId: string, now: Date = new Date()): Promise<TraderTimezoneState> {
  const versions = await getTimezoneVersions(userId);
  const pending = pendingTimezoneAt(versions, now);
  const timezone = effectiveTimezoneAt(versions, now);
  return {
    timezone,
    configured: versions.some((v) => v.effectiveFrom.getTime() <= now.getTime()),
    pending:
      pending && pending.timezone !== timezone ? { timezone: pending.timezone, effectiveFrom: pending.effectiveFrom.toISOString() } : null,
    todayKey: traderTodayKey(versions, now),
  };
}

export class TimezoneChangeError extends Error {}

/**
 * Confirms the trader's timezone. Always appends a NEW version that governs
 * from the next local date (never the current one), so today's date and
 * every stored TradingDay stay put. Choosing the zone already in effect
 * while a different change is pending cancels that change (a newer version
 * with the same effective instant wins). A no-op when nothing would change.
 */
export async function setTraderTimezone(userId: string, timezone: string, now: Date = new Date()): Promise<TraderTimezoneState> {
  const tz = timezone.trim();
  if (!isValidTimeZone(tz)) throw new TimezoneChangeError("Choose a valid timezone.");

  await prisma.$transaction(async (tx) => {
    // One change at a time per trader.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trader-timezone:${userId}`}, 0))`;
    const versions = await tx.traderTimezoneVersion.findMany({
      where: { userId },
      select: { timezone: true, effectiveFrom: true, createdAt: true },
    });
    const current = effectiveTimezoneAt(versions, now);
    const pending = pendingTimezoneAt(versions, now);
    const configured = versions.some((v) => v.effectiveFrom.getTime() <= now.getTime());
    // Already confirmed (or already scheduled) to this zone → nothing to do.
    if ((configured || pending) && (pending?.timezone ?? current) === tz) return;
    let effectiveFrom: Date;
    try {
      effectiveFrom = effectiveFromForChange(versions, tz, now);
    } catch (e) {
      throw new TimezoneChangeError(e instanceof Error ? e.message : "Timezone change not allowed.");
    }
    // A pending change is superseded at its own instant when that is later,
    // so the newest choice always wins.
    if (pending && pending.effectiveFrom.getTime() > effectiveFrom.getTime()) effectiveFrom = pending.effectiveFrom;
    await tx.traderTimezoneVersion.create({ data: { userId, timezone: tz, effectiveFrom, createdAt: now } });
  });
  return getTraderTimezoneState(userId, now);
}
