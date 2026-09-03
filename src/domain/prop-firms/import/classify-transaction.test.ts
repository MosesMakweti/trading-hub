import { describe, expect, it } from "vitest";

import { classifyTransaction } from "./classify-transaction";

describe("classifyTransaction", () => {
  it("confidently classifies an explicit withdrawal", () => {
    const result = classifyTransaction({ rawType: "Withdrawal", amount: "-500.00" });
    expect(result.classification).toBe("WITHDRAWAL_PAYOUT");
    expect(result.requiresReview).toBe(false);
  });

  it("demotes an explicit withdrawal label with a non-negative amount to uncertain", () => {
    const result = classifyTransaction({ rawType: "Withdrawal", amount: "500.00" });
    expect(result.classification).toBe("WITHDRAWAL_UNCLASSIFIED");
    expect(result.requiresReview).toBe(true);
  });

  it("detects a withdrawal represented as a plain negative Balance operation", () => {
    const result = classifyTransaction({ rawType: "Balance", amount: "-1000.00" });
    expect(result.classification).toBe("WITHDRAWAL_UNCLASSIFIED");
    expect(result.requiresReview).toBe(true);
  });

  it("does not treat a positive Balance operation as a withdrawal", () => {
    const result = classifyTransaction({ rawType: "Balance", amount: "1000.00" });
    expect(result.classification).not.toBe("WITHDRAWAL_PAYOUT");
    expect(result.classification).not.toBe("WITHDRAWAL_UNCLASSIFIED");
  });

  const neverAutoPayout: { rawType: string; amount: string }[] = [
    { rawType: "Deposit", amount: "1000.00" },
    { rawType: "Internal Transfer", amount: "-200.00" },
    { rawType: "Account Reset", amount: "0.00" },
    { rawType: "Challenge Cost", amount: "-150.00" },
    { rawType: "Platform Fee", amount: "-10.00" },
    { rawType: "Commission", amount: "-5.00" },
    { rawType: "Refund", amount: "150.00" },
    { rawType: "Balance Correction", amount: "-25.00" },
    { rawType: "Credit", amount: "100.00" },
    { rawType: "Something Weird", amount: "-42.00" },
  ];

  it.each(neverAutoPayout)("never auto-classifies %j as WITHDRAWAL_PAYOUT", (input) => {
    const result = classifyTransaction(input);
    expect(result.classification).not.toBe("WITHDRAWAL_PAYOUT");
  });

  it("flags a genuinely unknown transaction for review", () => {
    const result = classifyTransaction({ rawType: "Mystery Op 42", amount: "-10.00" });
    expect(result.classification).toBe("UNKNOWN");
    expect(result.requiresReview).toBe(true);
  });
});
