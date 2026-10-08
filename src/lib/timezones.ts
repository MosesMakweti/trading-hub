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
