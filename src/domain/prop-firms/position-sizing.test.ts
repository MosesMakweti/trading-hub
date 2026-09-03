import { describe, expect, it } from "vitest";

import { sizeCfdPosition, sizeFuturesPosition } from "@/domain/prop-firms/position-sizing";

describe("sizeCfdPosition", () => {
  it("computes lots from riskAmount / (stopDistance × pipOrTickValue) with full data", () => {
    const result = sizeCfdPosition({ riskAmount: 1000, stopDistance: 50, pipOrTickValue: 10 });
    expect(result.kind).toBe("computed");
    if (result.kind === "computed") {
      expect(result.positionSize.toNumber()).toBe(2); // 1000 / (50 × 10)
      expect(result.unit).toBe("LOTS");
    }
  });

  it("applies a conversion rate when the instrument currency differs from the account currency", () => {
    const result = sizeCfdPosition({ riskAmount: 1000, stopDistance: 50, pipOrTickValue: 10, conversionRate: 2 });
    expect(result.kind).toBe("computed");
    if (result.kind === "computed") expect(result.positionSize.toNumber()).toBe(1); // 1000 / (50 × 10 × 2)
  });

  it("never guesses — reports exactly what's missing when pipOrTickValue is absent", () => {
    const result = sizeCfdPosition({ riskAmount: 1000, stopDistance: 50 });
    expect(result.kind).toBe("insufficient_data");
    if (result.kind === "insufficient_data") {
      expect(result.missing).toEqual(["pip/tick value"]);
      expect(result.explanation).toContain("pip/tick value");
    }
  });

  it("reports every missing field when nothing is entered", () => {
    const result = sizeCfdPosition({});
    expect(result.kind).toBe("insufficient_data");
    if (result.kind === "insufficient_data") {
      expect(result.missing).toEqual(["risk amount", "stop distance", "pip/tick value"]);
    }
  });

  it("treats a zero stop distance as insufficient data rather than dividing by zero", () => {
    const result = sizeCfdPosition({ riskAmount: 1000, stopDistance: 0, pipOrTickValue: 10 });
    expect(result.kind).toBe("insufficient_data");
  });
});

describe("sizeFuturesPosition", () => {
  it("computes contracts from riskAmount / (stopDistanceTicks × tickValue) with full data", () => {
    const result = sizeFuturesPosition({ riskAmount: 1000, stopDistanceTicks: 20, tickValue: 12.5 });
    expect(result.kind).toBe("computed");
    if (result.kind === "computed") {
      expect(result.positionSize.toNumber()).toBe(4); // 1000 / (20 × 12.5)
      expect(result.unit).toBe("CONTRACTS");
    }
  });

  it("never guesses — reports exactly what's missing when tickValue is absent", () => {
    const result = sizeFuturesPosition({ riskAmount: 1000, stopDistanceTicks: 20 });
    expect(result.kind).toBe("insufficient_data");
    if (result.kind === "insufficient_data") expect(result.missing).toEqual(["tick value"]);
  });
});
