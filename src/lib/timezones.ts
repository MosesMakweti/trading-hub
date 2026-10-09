import { isValidTimeZone } from "@/domain/time/trader-calendar";

/** Every IANA zone this runtime knows (UTC first if missing), for timezone pickers. */
export function allTimeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list && list.length > 0) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    // fall through
  }
  return ["UTC"];
}

/**
 * The device's IANA zone, or null when it can't be read or isn't a valid
 * zone. Call it in the browser only (after mount) — during SSR it would be
 * the server's zone. Only ever a suggestion; nothing is saved until the
 * trader confirms. `resolve` is injectable for tests.
 */
export function readBrowserTimeZone(resolve: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  try {
    const zone = resolve();
    return typeof zone === "string" && isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The zone a timezone form should start on.
 *   • the trader chose one (in effect or scheduled) → that zone, as chosen;
 *   • never chosen → the device zone as a SUGGESTION, or nothing (""), so
 *     the UTC fallback calendar is never presented as the trader's choice.
 */
export function initialTimeZoneChoice(
  trader: { timezone: string; configured: boolean; pendingTimezone: string | null },
  browserZone: string | null,
): { value: string; source: "configured" | "suggested" | "none" } {
  if (trader.pendingTimezone) return { value: trader.pendingTimezone, source: "configured" };
  if (trader.configured) return { value: trader.timezone, source: "configured" };
  if (browserZone) return { value: browserZone, source: "suggested" };
  return { value: "", source: "none" };
}
