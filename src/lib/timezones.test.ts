import { describe, expect, it } from "vitest";

import { initialTimeZoneChoice, readBrowserTimeZone } from "@/lib/timezones";

/** Phase 3.1 — a never-configured trader's UTC fallback is never presented as their choice. */

describe("readBrowserTimeZone", () => {
  it("returns a valid device zone, and null for a missing, invalid or unreadable one", () => {
    expect(readBrowserTimeZone(() => "America/New_York")).toBe("America/New_York");
    expect(readBrowserTimeZone(() => undefined)).toBeNull();
    expect(readBrowserTimeZone(() => "")).toBeNull();
    expect(readBrowserTimeZone(() => "Mars/Olympus_Mons")).toBeNull();
    expect(
      readBrowserTimeZone(() => {
        throw new Error("Intl unavailable");
      }),
    ).toBeNull();
  });
});

describe("initialTimeZoneChoice", () => {
  const unset = { timezone: "UTC", configured: false, pendingTimezone: null };

  it("a configured trader keeps their zone (the device zone is ignored)", () => {
    expect(initialTimeZoneChoice({ timezone: "Europe/London", configured: true, pendingTimezone: null }, "Asia/Tokyo")).toEqual({
      value: "Europe/London",
      source: "configured",
    });
    // Explicitly configured UTC is a real choice and is kept.
    expect(initialTimeZoneChoice({ timezone: "UTC", configured: true, pendingTimezone: null }, "Asia/Tokyo")).toEqual({ value: "UTC", source: "configured" });
  });

  it("a scheduled (pending) zone counts as chosen, even before it takes effect", () => {
    expect(initialTimeZoneChoice({ timezone: "UTC", configured: false, pendingTimezone: "Asia/Tokyo" }, "Europe/Paris")).toEqual({
      value: "Asia/Tokyo",
      source: "configured",
    });
  });

  it("never configured + valid device zone → the device zone, as a suggestion (not UTC)", () => {
    expect(initialTimeZoneChoice(unset, "America/New_York")).toEqual({ value: "America/New_York", source: "suggested" });
  });

  it("never configured + no device zone → nothing selected (an explicit choice is required, not UTC)", () => {
    expect(initialTimeZoneChoice(unset, null)).toEqual({ value: "", source: "none" });
  });
});
