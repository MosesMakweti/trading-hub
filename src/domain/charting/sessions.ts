/**
 * Trading sessions — timezone-aware, DST-correct (pure; no I/O).
 *
 * A session is defined in ITS OWN timezone ("London 08:00–17:00
 * Europe/London"), so daylight saving is applied by the calendar of that
 * place. Market data is broker wall-clock time without a zone (MT5), so the
 * trader tells us the DATA timezone; occurrences are converted
 * session-local → UTC instant → data wall-clock minute.
 *
 * "NYC+7" is the common MT5 server convention: GMT+2 in winter, GMT+3 in
 * summer, switching on US dates so that 17:00 New York is always 00:00 on
 * the server.
 */
import { MINUTES_PER_DAY } from "@/domain/native-replay/wall-clock";

export interface SessionDef {
  id: string;
  name: string;
  /** "HH:mm" in `timeZone`. */
  start: string;
  end: string;
  /** IANA zone, e.g. "Europe/London". */
  timeZone: string;
  /** Days (0 = Sunday … 6 = Saturday) on which the session STARTS. */
  days: number[];
  color: string;
  description?: string | null;
  enabled: boolean;
  builtIn?: boolean;
  /** Built-in overlap sessions: the intersection of two other sessions. */
  intersect?: [string, string];
}

export const DATA_TIME_ZONES: { value: string; label: string }[] = [
  { value: "NYC+7", label: "GMT+2/+3, New York close (most MT5 brokers)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Athens", label: "Athens (EET)" },
  { value: "America/New_York", label: "New York" },
  { value: "Asia/Tokyo", label: "Tokyo" },
];

const WEEKDAYS = [1, 2, 3, 4, 5];

export const BUILTIN_SESSIONS: SessionDef[] = [
  { id: "asian", name: "Asian", start: "19:00", end: "04:00", timeZone: "America/New_York", days: [0, 1, 2, 3, 4], color: "#b39ddb", description: "19:00–04:00 New York time (overnight).", enabled: true, builtIn: true },
  { id: "tokyo", name: "Tokyo", start: "09:00", end: "18:00", timeZone: "Asia/Tokyo", days: WEEKDAYS, color: "#e0b35b", enabled: true, builtIn: true },
  { id: "london", name: "London", start: "08:00", end: "17:00", timeZone: "Europe/London", days: WEEKDAYS, color: "#8ab4f8", enabled: true, builtIn: true },
  { id: "newyork", name: "New York", start: "08:00", end: "17:00", timeZone: "America/New_York", days: WEEKDAYS, color: "#4f9d86", enabled: true, builtIn: true },
  { id: "ldn-ny", name: "London–New York overlap", start: "08:00", end: "17:00", timeZone: "America/New_York", days: WEEKDAYS, color: "#c4655f", description: "Where London and New York both trade (correct in the weeks US and UK daylight saving differ).", enabled: true, builtIn: true, intersect: ["london", "newyork"] },
];

// ── Time zone arithmetic (Intl; no dependency) ──────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (tz === "NYC+7" || tz === "UTC") return true;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset (minutes, local − UTC) of a zone at a UTC instant. */
export function offsetMinutes(tz: string, utcMs: number): number {
  if (tz === "UTC") return 0;
  if (tz === "NYC+7") return offsetMinutes("America/New_York", utcMs) + 7 * 60;
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/** UTC instant (ms) of a local date + "HH:mm" in a zone (DST gaps resolve forward). */
export function zonedToUtc(dateKey: string, hhmm: string, tz: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - offsetMinutes(tz, wall) * 60_000;
  utc = wall - offsetMinutes(tz, utc) * 60_000; // second pass settles DST boundaries
  return utc;
}

/** Data wall-clock minute (the chart's minute) of a UTC instant. */
export function utcToDataMinute(utcMs: number, dataTz: string): number {
  return Math.floor(utcMs / 60_000) + offsetMinutes(dataTz, utcMs);
}

/** UTC instant (ms) of a data wall-clock minute (approximate within DST overlaps). */
export function dataMinuteToUtc(minute: number, dataTz: string): number {
  const wall = minute * 60_000;
  let utc = wall - offsetMinutes(dataTz, wall) * 60_000;
  utc = wall - offsetMinutes(dataTz, utc) * 60_000;
  return utc;
}

const dateKeyOf = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10);
const addDays = (dateKey: string, n: number) => dateKeyOf(Date.parse(`${dateKey}T00:00:00Z`) + n * 86_400_000);
const weekdayOf = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export interface Occurrence {
  sessionId: string;
  /** Session-local date the occurrence starts on. */
  date: string;
  /** Data wall-clock minutes, [start, end). */
  start: number;
  end: number;
}

/** The occurrence that starts on `dateKey` (session-local), or null on a day it doesn't run. */
export function occurrenceOn(def: SessionDef, dateKey: string, dataTz: string, all: SessionDef[] = BUILTIN_SESSIONS): Occurrence | null {
  if (def.intersect) {
    const [a, b] = def.intersect.map((id) => all.find((s) => s.id === id));
    if (!a || !b) return null;
    const oa = occurrenceOn(a, dateKey, dataTz, all);
    if (!oa) return null;
    // The partner session may be dated differently in its own zone: take the one overlapping.
    for (const k of [0, -1, 1]) {
      const ob = occurrenceOn(b, addDays(dateKey, k), dataTz, all);
      if (!ob) continue;
      const start = Math.max(oa.start, ob.start);
      const end = Math.min(oa.end, ob.end);
      if (end > start) return { sessionId: def.id, date: dateKey, start, end };
    }
    return null;
  }
  if (!def.days.includes(weekdayOf(dateKey))) return null;
  const startUtc = zonedToUtc(dateKey, def.start, def.timeZone);
  const overnight = toMin(def.end) <= toMin(def.start);
  const endUtc = zonedToUtc(overnight ? addDays(dateKey, 1) : dateKey, def.end, def.timeZone);
  return { sessionId: def.id, date: dateKey, start: utcToDataMinute(startUtc, dataTz), end: utcToDataMinute(endUtc, dataTz) };
}

/** Occurrences overlapping [from, to) (data minutes), in order. */
export function occurrencesBetween(def: SessionDef, from: number, to: number, dataTz: string, all: SessionDef[] = BUILTIN_SESSIONS): Occurrence[] {
  const out: Occurrence[] = [];
  const first = dateKeyOf(dataMinuteToUtc(from, dataTz) - 2 * 86_400_000);
  const days = Math.ceil((to - from) / MINUTES_PER_DAY) + 4;
  for (let i = 0; i <= days; i++) {
    const o = occurrenceOn(def, addDays(first, i), dataTz, all);
    if (o && o.end > from && o.start < to) out.push(o);
  }
  return out;
}

/** The first occurrence starting after `minute` (or at/after with inclusive). */
export function nextOccurrence(def: SessionDef, minute: number, dataTz: string, all: SessionDef[] = BUILTIN_SESSIONS, inclusive = false): Occurrence | null {
  const list = occurrencesBetween(def, minute - MINUTES_PER_DAY, minute + 14 * MINUTES_PER_DAY, dataTz, all);
  return list.find((o) => (inclusive ? o.start >= minute : o.start > minute)) ?? null;
}

/** The last occurrence starting before `minute`. */
export function previousOccurrence(def: SessionDef, minute: number, dataTz: string, all: SessionDef[] = BUILTIN_SESSIONS): Occurrence | null {
  const list = occurrencesBetween(def, minute - 14 * MINUTES_PER_DAY, minute + MINUTES_PER_DAY, dataTz, all);
  return [...list].reverse().find((o) => o.start < minute) ?? null;
}

/** The session-local date key of a data minute (for "today" in the navigator). */
export function localDateOf(minute: number, def: Pick<SessionDef, "timeZone">, dataTz: string): string {
  const utc = dataMinuteToUtc(minute, dataTz);
  return dateKeyOf(utc + offsetMinutes(def.timeZone, utc) * 60_000);
}
