import { describe, expect, it } from "vitest";

import { localDateToKey } from "./date-key";

describe("localDateToKey", () => {
  it("formats a local date as YYYY-MM-DD, zero-padded", () => {
    expect(localDateToKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateToKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the LOCAL calendar day, not UTC — e.g. late evening never rolls to UTC's next day", () => {
    // 11:50pm local time, well before UTC midnight would roll over for most
    // timezones behind UTC — the local getters must be used, never toISOString.
    const lateEvening = new Date(2026, 5, 15, 23, 50, 0);
    expect(localDateToKey(lateEvening)).toBe("2026-06-15");
  });

  it("matches the exact algorithm of the server's localDateToKey (src/lib/date.ts)", () => {
    // Same three-line construction: getFullYear/getMonth+1/getDate, padStart(2,"0").
    const d = new Date(2026, 2, 3);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    expect(localDateToKey(d)).toBe(`${y}-${m}-${day}`);
  });
});
