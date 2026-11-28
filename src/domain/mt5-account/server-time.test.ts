import { describe, expect, it } from "vitest";

import { defaultConvention, describeConvention, parseConvention, roundOffsetToQuarterHour, serverTimeToUtc, serverWallClock } from "./server-time";

const server = (iso: string) => Date.parse(`${iso}Z`); // server wall clock as "ms since epoch"

describe("server-time normalization", () => {
  it("rounds the terminal-reported offset to quarter hours", () => {
    expect(roundOffsetToQuarterHour(7203)).toBe(120);
    expect(roundOffsetToQuarterHour(10790)).toBe(180);
    expect(roundOffsetToQuarterHour(19800)).toBe(330); // +5:30
    expect(roundOffsetToQuarterHour(-3)).toBe(0);
    expect(() => roundOffsetToQuarterHour(20 * 3600)).toThrow();
  });

  it("FIXED_OFFSET subtracts the offset and keeps milliseconds", () => {
    const r = serverTimeToUtc(server("2024-01-15T10:00:00.250"), defaultConvention(120));
    expect(r.utc.toISOString()).toBe("2024-01-15T08:00:00.250Z");
    expect(r.offsetMinutes).toBe(120);
  });

  it("NY_CLOSE is GMT+2 in (US) winter and GMT+3 in (US) summer", () => {
    const winter = serverTimeToUtc(server("2024-01-15T10:00:00"), { kind: "NY_CLOSE", source: "USER_SELECTED" });
    expect(winter.utc.toISOString()).toBe("2024-01-15T08:00:00.000Z");
    expect(winter.offsetMinutes).toBe(120);
    const summer = serverTimeToUtc(server("2024-07-15T10:00:00"), { kind: "NY_CLOSE", source: "USER_SELECTED" });
    expect(summer.utc.toISOString()).toBe("2024-07-15T07:00:00.000Z");
    expect(summer.offsetMinutes).toBe(180);
    // 2024-03-15: US already on DST, EU not yet — NY_CLOSE follows the US.
    expect(serverTimeToUtc(server("2024-03-15T12:00:00"), { kind: "NY_CLOSE", source: "USER_SELECTED" }).offsetMinutes).toBe(180);
  });

  it("IANA_ZONE follows that zone's DST (EU dates for Europe/Athens)", () => {
    const conv = { kind: "IANA_ZONE" as const, zone: "Europe/Athens", source: "USER_SELECTED" as const };
    expect(serverTimeToUtc(server("2024-03-15T12:00:00"), conv).offsetMinutes).toBe(120);
    expect(serverTimeToUtc(server("2024-07-15T12:00:00"), conv).offsetMinutes).toBe(180);
  });

  it("a fixed pairing-time offset is wrong across DST — which is why raw server time is kept", () => {
    const summerPaired = defaultConvention(180);
    const winterDeal = server("2024-01-15T10:00:00");
    const fixed = serverTimeToUtc(winterDeal, summerPaired).utc.toISOString();
    const correct = serverTimeToUtc(winterDeal, { kind: "NY_CLOSE", source: "USER_SELECTED" }).utc.toISOString();
    expect(fixed).not.toBe(correct);
    expect(serverWallClock(winterDeal).toISOString()).toBe("2024-01-15T10:00:00.000Z");
  });

  it("accepts BigInt input", () => {
    expect(serverTimeToUtc(BigInt(server("2024-01-15T10:00:00")), defaultConvention(0)).utc.toISOString()).toBe("2024-01-15T10:00:00.000Z");
  });

  it("validates stored conventions strictly", () => {
    expect(parseConvention({ kind: "FIXED_OFFSET", offsetMinutes: 120, source: "TERMINAL_OFFSET_AT_PAIRING" })).not.toBeNull();
    expect(parseConvention({ kind: "FIXED_OFFSET", offsetMinutes: 121, source: "USER_SELECTED" })).toBeNull();
    expect(parseConvention({ kind: "IANA_ZONE", zone: "Not/AZone", source: "USER_SELECTED" })).toBeNull();
    expect(parseConvention({ kind: "NY_CLOSE" })).toBeNull();
    expect(parseConvention(null)).toBeNull();
  });

  it("describes conventions", () => {
    expect(describeConvention(defaultConvention(120))).toBe("Fixed GMT+2 (no daylight saving)");
    expect(describeConvention(defaultConvention(330))).toBe("Fixed GMT+5:30 (no daylight saving)");
  });
});
