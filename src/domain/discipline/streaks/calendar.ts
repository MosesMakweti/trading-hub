/**
 * Discipline Streaks — the trader's calendar for streak purposes (pure).
 *
 * One timezone strategy for the whole system: an INSTANT (server clock) is
 * placed on the trader's calendar using the trader timezone that was in
 * effect AT THAT INSTANT (`TraderTimezoneVersion`, Preparation Phase 0). Date
 * columns that are already local dates (TradingDay.date, Trade.tradeDate) are
 * used as-is. So a timezone change never re-dates history.
 */
import {
  addDaysToDateKey,
  effectiveTimezoneAt,
  localDateKeyAt,
  type TimezoneVersion,
} from "@/domain/time/trader-calendar";

/** The trader-local date of `instant`, under the zone that governed that instant. */
export function traderDateKeyOf(versions: readonly TimezoneVersion[], instant: Date): string {
  return localDateKeyAt(instant, effectiveTimezoneAt(versions, instant));
}

/**
 * Local dates that never existed on the trader's calendar because an eastward
 * timezone change jumped over them (e.g. +14h → −10h crossing the date line,
 * or a large eastward move). Such a date can't be "missed": streak tracks
 * treat it as REST.
 */
export function skippedDateKeys(versions: readonly TimezoneVersion[], from: string, to: string): Set<string> {
  const skipped = new Set<string>();
  for (const v of versions) {
    const at = v.effectiveFrom;
    const before = traderDateKeyOf(versions, new Date(at.getTime() - 1));
    const after = traderDateKeyOf(versions, at);
    for (let k = addDaysToDateKey(before, 1); k < after; k = addDaysToDateKey(k, 1)) {
      if (k >= from && k <= to) skipped.add(k);
    }
  }
  return skipped;
}

/** Every date key from `from` to `to` inclusive (empty if from > to). */
export function dateKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let k = from; k <= to; k = addDaysToDateKey(k, 1)) keys.push(k);
  return keys;
}
