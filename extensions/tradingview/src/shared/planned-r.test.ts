import { describe, expect, it } from "vitest";

import { previewPlannedR } from "./planned-r";

describe("previewPlannedR", () => {
  it("LONG: 2R when the target is twice as far as the stop", () => {
    expect(previewPlannedR("LONG", 100, 90, 120)).toEqual({ r: 2, reason: null });
  });

  it("SHORT: 2R when the target is twice as far as the stop, on the other side", () => {
    expect(previewPlannedR("SHORT", 100, 110, 80)).toEqual({ r: 2, reason: null });
  });

  it("LONG: null with a reason when the stop is on the wrong side of entry (non-positive risk)", () => {
    const result = previewPlannedR("LONG", 100, 110, 120);
    expect(result.r).toBeNull();
    expect(result.reason).toMatch(/risk side/i);
  });

  it("SHORT: null with a reason when the stop is on the wrong side of entry", () => {
    const result = previewPlannedR("SHORT", 100, 90, 80);
    expect(result.r).toBeNull();
  });

  it("a target on the losing side of entry yields a negative R rather than being blocked — matches the server's own gate (only risk distance blocks, not reward direction)", () => {
    expect(previewPlannedR("LONG", 100, 90, 95).r).toBeCloseTo(-0.5);
  });

  it("stop exactly at entry (zero risk distance) is also blocked, not a division by zero", () => {
    expect(previewPlannedR("LONG", 100, 100, 120).r).toBeNull();
  });
});
