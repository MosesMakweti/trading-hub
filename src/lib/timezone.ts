/**
 * Generic IANA-timezone <-> UTC conversion — extracted (Stage 21.3A) from
 * `domain/prop-firms/import/normalize.ts`, where this was originally
 * written for broker-statement timestamps, into a shared location so the
 * MT5 market-data importer (`domain/mt5-import/`) can reuse the EXACT same
 * correct, tested conversion for candle timestamps rather than
 * reimplementing it. Zero behavior change — `normalize.ts` re-exports these
 * for backward compatibility with its own existing imports.
 */

function getTimezoneOffsetMs(timeZone: string, atUtc: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(atUtc)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - atUtc.getTime();
}

/** Converts wall-clock components in `timeZone` (an IANA zone, e.g.
 *  "America/New_York", "Etc/GMT-2") to the correct UTC instant, including
 *  DST — via the standard two-pass Intl.DateTimeFormat round-trip (native,
 *  no timezone-database dependency). The rare DST-transition-hour ambiguity
 *  (at most once a year, for one hour) is an acceptable documented edge
 *  case — this resolves to ONE of the two valid instants deterministically
 *  (whichever the two-pass round-trip converges on), never throws, and is
 *  no worse than what a broker-statement/candle importer can generally do
 *  without the trader disambiguating that specific hour by hand. */
export function localWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimezoneOffsetMs(timeZone, new Date(naiveUtcMs));
  const candidateMs = naiveUtcMs - offset1;
  const offset2 = getTimezoneOffsetMs(timeZone, new Date(candidateMs));
  return new Date(naiveUtcMs - offset2);
}

/** A fixed UTC offset expressed in minutes (e.g. +120 for "broker server
 *  time is always UTC+2, no DST") — no Intl/IANA lookup needed, and no DST
 *  ambiguity possible by construction. */
export function fixedOffsetWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, offsetMinutes: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);
}

/** Whether `timeZone` is a name `Intl.DateTimeFormat` actually recognizes —
 *  used to reject a typo'd/unsupported IANA zone name up front rather than
 *  silently treating it as UTC. */
export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
