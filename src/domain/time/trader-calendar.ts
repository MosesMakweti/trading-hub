/**
 * The trader's calendar — which LOCAL date (and local time) an instant falls
 * on in the trader's own IANA timezone. Pure.
 *
 * Rules:
 *   • Authoritative instants are server timestamps (UTC `Date`s). Nothing
 *     here reads the server's or the browser's local timezone.
 *   • A trading-date identity is a `YYYY-MM-DD` key on the trader's calendar.
 *   • Timezones are versioned and a change governs only from the NEXT local
 *     date onward — so a stored TradingDay date never shifts, and the
 *     effective "today" key never moves backwards (see
 *     `effectiveFromForChange`).
 *   • No configured timezone → the UTC calendar (the historical behaviour).
 *   • DST is handled by the platform's IANA database via Intl (no fixed offsets).
 */
import { localWallClockToUtc } from "@/lib/timezone";

/** The calendar used when a trader has never configured a timezone. */
export const DEFAULT_TRADER_TIMEZONE = "UTC";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** True for a real IANA zone name the runtime knows (e.g. "Europe/London", "UTC"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface LocalDateTime {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, on the trader's calendar. */
  weekday: number;
  /** Minutes since local midnight (0–1439). */
  minutesOfDay: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock date/time of `instant` in `timeZone`. */
export function localDateTimeAt(instant: Date, timeZone: string): LocalDateTime {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) if (p.type !== "literal") parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { dateKey, year, month, day, hour, minute, second, weekday: WEEKDAYS[parts.weekday], minutesOfDay: hour * 60 + minute };
}

/** The trader's local date key for `instant`. */
export function localDateKeyAt(instant: Date, timeZone: string): string {
  return localDateTimeAt(instant, timeZone).dateKey;
}

function splitKey(dateKey: string): [number, number, number] {
  const [y, m, d] = dateKey.split("-").map(Number);
  return [y, m, d];
}

/** Weekday (0 = Sunday) of a calendar date key — timezone-independent. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = splitKey(dateKey);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The UTC instant of local wall-clock `minutesOfDay` on `dateKey` in
 * `timeZone`. DST: a wall time inside a spring-forward gap resolves to the
 * instant just after the gap; an ambiguous fall-back time resolves
 * deterministically to one of its two instants (see localWallClockToUtc).
 */
export function localTimeToInstant(dateKey: string, minutesOfDay: number, timeZone: string): Date {
  if (!Number.isInteger(minutesOfDay) || minutesOfDay < 0 || minutesOfDay > 1439) {
    throw new RangeError(`minutesOfDay must be an integer 0–1439 (got ${minutesOfDay}).`);
  }
  const [y, m, d] = splitKey(dateKey);
  return localWallClockToUtc(y, m, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, timeZone);
}

/**
 * The first instant of local `dateKey` in `timeZone` (local midnight). Found
 * by search rather than wall-clock conversion so zones whose DST transition
 * happens AT midnight (e.g. America/Santiago) still give the true start of day.
 */
export function startOfLocalDay(dateKey: string, timeZone: string): Date {
  const [y, m, d] = splitKey(dateKey);
  // Every zone's offset is within ±14h, so the local day starts within this window.
  let lo = Date.UTC(y, m - 1, d) - 15 * 3600_000;
  let hi = Date.UTC(y, m - 1, d) + 15 * 3600_000;
  // Invariant: localDateKeyAt(lo) < dateKey <= localDateKeyAt(hi) (minute precision).
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
    if (localDateKeyAt(new Date(mid), timeZone) < dateKey) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Calendar arithmetic on date keys (timezone-independent). */
export function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = splitKey(dateKey);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// ── Versioned trader timezone ───────────────────────────────────────────────

export interface TimezoneVersion {
  timezone: string;
  /** The instant from which this timezone governs the trader's calendar. */
  effectiveFrom: Date;
  /** Tie-break for two versions with the same effectiveFrom: the later one wins. */
  createdAt: Date;
}

/** The timezone governing `instant`: the latest version already in effect, else UTC. */
export function effectiveTimezoneAt(versions: readonly TimezoneVersion[], instant: Date): string {
  let best: TimezoneVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom.getTime() > instant.getTime()) continue;
    if (
      !best ||
      v.effectiveFrom.getTime() > best.effectiveFrom.getTime() ||
      (v.effectiveFrom.getTime() === best.effectiveFrom.getTime() && v.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = v;
    }
  }
  return best?.timezone ?? DEFAULT_TRADER_TIMEZONE;
}

/** The trader's "today" key at `now`. */
export function traderTodayKey(versions: readonly TimezoneVersion[], now: Date): string {
  return localDateKeyAt(now, effectiveTimezoneAt(versions, now));
}

/**
 * When a change to `newTimeZone`, requested at `now`, takes effect.
 *
 * N = the next local date on the calendar currently in effect. The change
 * takes effect at the later of "N starts in the current zone" and "N starts
 * in the new zone", so N is the first date the new zone governs and both
 * calendars agree on it at the switch:
 *   • eastward change → at the current zone's midnight (the new zone is
 *     already on N, or past it — an eastward jump of ≥ 24h skips a date);
 *   • westward change → at the new zone's midnight (the current zone has
 *     been on N for less than 24h by then).
 * Either way the effective "today" key never moves backwards, and
 * already-created TradingDays are never re-dated. A westward change of 24h
 * or more (only possible across the date line, e.g. +14h → −12h) cannot be
 * made monotonic and is rejected — change in two steps.
 */
export function effectiveFromForChange(versions: readonly TimezoneVersion[], newTimeZone: string, now: Date): Date {
  const current = effectiveTimezoneAt(versions, now);
  const next = addDaysToDateKey(localDateKeyAt(now, current), 1);
  const switchAt = new Date(Math.max(startOfLocalDay(next, current).getTime(), startOfLocalDay(next, newTimeZone).getTime()));
  if (localDateKeyAt(new Date(switchAt.getTime() - 1), current) > next) {
    throw new RangeError("This timezone change crosses the date line by 24 hours or more — change it in two steps.");
  }
  return switchAt;
}

/** The pending (future) timezone, if a change has been scheduled but is not yet in effect. */
export function pendingTimezoneAt(versions: readonly TimezoneVersion[], now: Date): TimezoneVersion | null {
  const future = versions.filter((v) => v.effectiveFrom.getTime() > now.getTime());
  if (future.length === 0) return null;
  return future.reduce((a, b) =>
    b.effectiveFrom.getTime() > a.effectiveFrom.getTime() ||
    (b.effectiveFrom.getTime() === a.effectiveFrom.getTime() && b.createdAt.getTime() > a.createdAt.getTime())
      ? b
      : a,
  );
}
