import { describe, expect, it } from "vitest";

import { matchPartialsToTargets } from "@/domain/trade-plan/partial-matching";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";

const eurusd = lookupInstrument("EURUSD");
const targets = [
  { targetOrder: 1, targetPrice: "1.10700" },
  { targetOrder: 2, targetPrice: "1.10900" },
  { targetOrder: 3, targetPrice: "1.11100" },
];

describe("matchPartialsToTargets", () => {
  it("matches an exact price to its target with EXACT confidence", () => {
    const result = matchPartialsToTargets("LONG", [{ exitOrder: 1, exitPrice: "1.10700" }], targets, eurusd);
    expect(result[0].matchedTargetOrder).toBe(1);
    expect(result[0].confidence).toBe("EXACT");
  });

  it("does NOT assume the first recorded exit is TP1 — a first exit near TP2's price matches TP2", () => {
    // The trader's first (and only, so far) partial happened to land near TP2's price.
    const result = matchPartialsToTargets("LONG", [{ exitOrder: 1, exitPrice: "1.10905" }], targets, eurusd);
    expect(result[0].matchedTargetOrder).toBe(2);
  });

  it("matches multiple partials to their respective closest targets, each target used once", () => {
    const partials = [
      { exitOrder: 1, exitPrice: "1.10702" },
      { exitOrder: 2, exitPrice: "1.10895" },
    ];
    const result = matchPartialsToTargets("LONG", partials, targets, eurusd);
    expect(result.find((r) => r.exitOrder === 1)?.matchedTargetOrder).toBe(1);
    expect(result.find((r) => r.exitOrder === 2)?.matchedTargetOrder).toBe(2);
  });

  it("returns AMBIGUOUS (no guess) when a price sits equidistant between two targets", () => {
    // Exactly between TP1 (1.10700) and TP2 (1.10900) with tight-tolerance targets nearby.
    const closeTargets = [
      { targetOrder: 1, targetPrice: "1.10700" },
      { targetOrder: 2, targetPrice: "1.10702" },
    ];
    const result = matchPartialsToTargets("LONG", [{ exitOrder: 1, exitPrice: "1.10701" }], closeTargets, eurusd);
    expect(result[0].matchedTargetOrder).toBeNull();
    expect(result[0].confidence).toBe("AMBIGUOUS");
  });

  it("returns NONE when there are no planned targets to match against", () => {
    const result = matchPartialsToTargets("LONG", [{ exitOrder: 1, exitPrice: "1.10700" }], [], eurusd);
    expect(result[0].confidence).toBe("NONE");
    expect(result[0].matchedTargetOrder).toBeNull();
  });

  it("offers a CLOSEST (lower-confidence) match when no target is within tolerance", () => {
    const result = matchPartialsToTargets("LONG", [{ exitOrder: 1, exitPrice: "1.10750" }], targets, eurusd);
    expect(result[0].matchedTargetOrder).toBe(1);
    expect(result[0].confidence).toBe("CLOSEST");
  });

  it("preserves the caller's exitOrder ordering in the returned results", () => {
    const partials = [
      { exitOrder: 5, exitPrice: "1.11100" },
      { exitOrder: 2, exitPrice: "1.10700" },
    ];
    const result = matchPartialsToTargets("LONG", partials, targets, eurusd);
    expect(result.map((r) => r.exitOrder)).toEqual([5, 2]);
  });
});
