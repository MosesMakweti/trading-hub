import { isValidIanaTimeZone, localWallClockToUtc } from "@/lib/timezone";

/**
 * MT5 Connector — trade-server time normalization.
 *
 * MT5 reports every deal/order time (`*_TIME_MSC`) as the trade SERVER's wall
 * clock expressed as "milliseconds since 1970" — NOT UTC. Most retail brokers
 * run GMT+2 in winter / GMT+3 in summer (so 17:00 New York is midnight on the
 * server), but that is a broker choice, not a rule.
 *
 * The terminal can only tell us the offset that applies NOW
 * (TimeTradeServer() − TimeGMT()). Applying today's offset to history is
 * wrong by an hour across DST changes, so:
 *   - the raw server time (`timeMsc`, `serverTime`) is always stored as-is;
 *   - the connection records the convention it used (`timeConventionJson`);
 *   - the UTC instant is derived from both and can be re-derived when the
 *     trader corrects the convention.
 *
 * Deliberately independent of the MT5 *candle* importer's time handling
 * (domain/mt5-import) — account history and market data stay separate. Only
 * the generic IANA conversion in lib/timezone.ts is shared.
 */

export type ServerTimeConventionSource = "TERMINAL_OFFSET_AT_PAIRING" | "USER_SELECTED";

export type ServerTimeConvention =
  /** Always the same offset, no DST. The pairing default (from the offset the
   *  terminal reported when it paired) — exact only for brokers without DST. */
  | { kind: "FIXED_OFFSET"; offsetMinutes: number; source: ServerTimeConventionSource }
  /** GMT+2 / GMT+3 following US daylight-saving dates (server midnight ==
   *  17:00 America/New_York). The most common retail-FX convention. */
  | { kind: "NY_CLOSE"; source: ServerTimeConventionSource }
  /** Any IANA zone, e.g. "Europe/Athens" (GMT+2/+3 on EU DST dates). */
  | { kind: "IANA_ZONE"; zone: string; source: ServerTimeConventionSource };

export const MAX_OFFSET_MINUTES = 14 * 60;

/** The offset a terminal reports is TimeTradeServer() − TimeGMT() in
 *  seconds, which carries jitter from the PC clock; real offsets are whole
 *  quarter hours. */
export function roundOffsetToQuarterHour(offsetSeconds: number): number {
  const minutes = Math.round(offsetSeconds / 60 / 15) * 15;
  if (!Number.isFinite(minutes) || Math.abs(minutes) > MAX_OFFSET_MINUTES) {
    throw new RangeError(`Server GMT offset out of range: ${offsetSeconds}s`);
  }
  return minutes === 0 ? 0 : minutes; // normalize -0
}

export function defaultConvention(observedOffsetMinutes: number): ServerTimeConvention {
  return { kind: "FIXED_OFFSET", offsetMinutes: observedOffsetMinutes, source: "TERMINAL_OFFSET_AT_PAIRING" };
}

/** Validates a stored/submitted convention. Returns null for anything
 *  malformed — callers must then refuse to normalize rather than guess UTC. */
export function parseConvention(value: unknown): ServerTimeConvention | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const source = v.source === "USER_SELECTED" ? "USER_SELECTED" : v.source === "TERMINAL_OFFSET_AT_PAIRING" ? "TERMINAL_OFFSET_AT_PAIRING" : null;
  if (!source) return null;
  if (v.kind === "FIXED_OFFSET") {
    const offset = v.offsetMinutes;
    if (typeof offset !== "number" || !Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET_MINUTES || offset % 15 !== 0) return null;
    return { kind: "FIXED_OFFSET", offsetMinutes: offset, source };
  }
  if (v.kind === "NY_CLOSE") return { kind: "NY_CLOSE", source };
  if (v.kind === "IANA_ZONE") {
    if (typeof v.zone !== "string" || !isValidIanaTimeZone(v.zone)) return null;
    return { kind: "IANA_ZONE", zone: v.zone, source };
  }
  return null;
}

/** The raw server wall clock as a Date whose UTC fields ARE the server's
 *  wall-clock fields (what gets stored in `serverTime`). Not an instant. */
export function serverWallClock(timeMsc: bigint | number): Date {
  return new Date(Number(timeMsc));
}

function wallClockInZoneToUtcMs(serverMs: number, zone: string, shiftMinutes: number): number {
  // Server wall clock → wall clock in `zone` (shifted), → UTC via the shared
  // two-pass IANA conversion. Milliseconds are carried separately because
  // the shared helper works in whole seconds.
  const shifted = new Date(serverMs - shiftMinutes * 60_000);
  const ms = shifted.getUTCMilliseconds();
  const utc = localWallClockToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
    zone,
  );
  return utc.getTime() + ms;
}

/**
 * Converts an MT5 server-time millisecond value to a UTC instant under the
 * given convention. Returns the offset that was applied (server − UTC), which
 * is stored next to the normalized instant so every row says how it was
 * derived.
 */
export function serverTimeToUtc(timeMsc: bigint | number, convention: ServerTimeConvention): { utc: Date; offsetMinutes: number } {
  const serverMs = Number(timeMsc);
  if (!Number.isSafeInteger(serverMs)) throw new RangeError(`MT5 time out of range: ${String(timeMsc)}`);
  let utcMs: number;
  switch (convention.kind) {
    case "FIXED_OFFSET":
      utcMs = serverMs - convention.offsetMinutes * 60_000;
      break;
    case "NY_CLOSE":
      // server = New York wall clock + 7h.
      utcMs = wallClockInZoneToUtcMs(serverMs, "America/New_York", 7 * 60);
      break;
    case "IANA_ZONE":
      utcMs = wallClockInZoneToUtcMs(serverMs, convention.zone, 0);
      break;
  }
  return { utc: new Date(utcMs), offsetMinutes: Math.round((serverMs - utcMs) / 60_000) };
}

export function describeConvention(convention: ServerTimeConvention | null): string {
  if (!convention) return "Not set";
  switch (convention.kind) {
    case "FIXED_OFFSET": {
      const sign = convention.offsetMinutes >= 0 ? "+" : "−";
      const abs = Math.abs(convention.offsetMinutes);
      const hhmm = `${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
      return `Fixed GMT${sign}${hhmm} (no daylight saving)`;
    }
    case "NY_CLOSE":
      return "GMT+2 / GMT+3 following US daylight saving (New York close)";
    case "IANA_ZONE":
      return `Time zone ${convention.zone}`;
  }
}
