import { describe, expect, it } from "vitest";

import { pickVersionAtTime } from "@/domain/replay/historical-strategy-version";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("pickVersionAtTime", () => {
  const versions = [
    { version: 1, createdAt: D(2026, 1, 1) },
    { version: 2, createdAt: D(2026, 3, 1) },
    { version: 3, createdAt: D(2026, 6, 1) },
  ];

  it("resolves the historically correct version for a time between publishes", () => {
    expect(pickVersionAtTime(versions, D(2026, 4, 15))?.version).toBe(2);
  });

  it("resolves the exact version active at a time exactly on a publish", () => {
    expect(pickVersionAtTime(versions, D(2026, 3, 1))?.version).toBe(2);
  });

  it("resolves the latest version for a time after every publish", () => {
    expect(pickVersionAtTime(versions, D(2026, 12, 1))?.version).toBe(3);
  });

  it("returns null when the time predates every published version — the safe fallback (§3)", () => {
    expect(pickVersionAtTime(versions, D(2025, 12, 1))).toBeNull();
  });

  it("returns null when no versions exist at all", () => {
    expect(pickVersionAtTime([], D(2026, 1, 1))).toBeNull();
  });

  it("does not depend on input order", () => {
    const shuffled = [versions[2], versions[0], versions[1]];
    expect(pickVersionAtTime(shuffled, D(2026, 4, 15))?.version).toBe(2);
  });
});
