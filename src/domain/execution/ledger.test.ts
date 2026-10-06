import { describe, expect, it } from "vitest";

import {
  LedgerError,
  fromSpecSnapshot,
  planCloseFill,
  planReversal,
  projectLedgerForReaders,
  replayLedger,
  resolveExecutionSpec,
  toSpecSnapshot,
  type LedgerFill,
  type LedgerTerms,
  type PlannedFill,
} from "@/domain/execution";

/** Quantity ledger (Phase 2) — pure replay / planning / projection. */

const terms: LedgerTerms = {
  direction: "LONG",
  entry: "2000",
  initialQuantity: "0.83",
  riskAmount: "1000",
  quoteValuePerPriceUnit: "100",
  quantityStep: "0.01",
  minQuantity: "0.01",
};

function append(fills: LedgerFill[], p: PlannedFill): LedgerFill[] {
  const sequence = fills.length + 1;
  return [
    ...fills,
    {
      id: `f${sequence}`,
      sequence,
      kind: p.kind,
      executedQuantity: p.executedQuantity,
      price: p.price,
      quantityBefore: p.quantityBefore,
      quantityAfter: p.quantityAfter,
      grossPnl: p.grossPnl,
      fees: p.fees,
      conversionRate: p.conversionRate,
      reversesFillId: p.reversesFillId,
      executedAt: new Date(Date.UTC(2026, 9, 5, 10, sequence)),
    },
  ];
}

function close(fills: LedgerFill[], request: Parameters<typeof planCloseFill>[2], price: string) {
  return append(fills, planCloseFill(terms, replayLedger(terms, fills), request, price, "1"));
}

const s = (d: { toString(): string } | null) => (d == null ? null : d.toString());

describe("replay + planning", () => {
  it("50% → 50% → close: exact quantities, PnL, R, zero remaining", () => {
    let fills: LedgerFill[] = [];
    fills = close(fills, { percentOfRemaining: "50" }, "2012");
    fills = close(fills, { percentOfRemaining: "50" }, "2024");
    fills = close(fills, { percentOfRemaining: "100" }, "2006");
    const st = replayLedger(terms, fills);
    expect(st.fills.map((f) => [s(f.executedQuantity), s(f.quantityAfter), s(f.grossPnl)])).toEqual([
      ["0.41", "0.42", "492"],
      ["0.21", "0.21", "504"],
      ["0.21", "0", "126"],
    ]);
    expect([s(st.remainingQuantity), s(st.realizedPnl), s(st.realizedR), st.fullyClosed]).toEqual(["0", "1122", "1.122", true]);
  });

  it("reversal reopens deterministically; replacement re-closes", () => {
    let fills: LedgerFill[] = [];
    fills = close(fills, { quantity: "0.83" }, "2012"); // +996
    expect(replayLedger(terms, fills).fullyClosed).toBe(true);

    fills = append(fills, planReversal(replayLedger(terms, fills), fills, "f1"));
    const reopened = replayLedger(terms, fills);
    expect([s(reopened.remainingQuantity), s(reopened.realizedPnl), reopened.fullyClosed]).toEqual(["0.83", "0", false]);
    expect(reopened.effectiveCloses).toHaveLength(0);
    expect(reopened.weightedAverageExit).toBeNull();

    fills = close(fills, { quantity: "0.83" }, "2006"); // replacement +498
    const st = replayLedger(terms, fills);
    expect([s(st.realizedPnl), s(st.realizedR), st.fullyClosed, s(st.weightedAverageExit)]).toEqual(["498", "0.498", true, "2006"]);
    // Replaying the same rows always gives the same answer, regardless of input order.
    expect(s(replayLedger(terms, [...fills].reverse()).realizedR)).toBe("0.498");
  });

  it("reversal validation is strict", () => {
    let fills = close([], { quantity: "0.5" }, "2010");
    fills = append(fills, planReversal(replayLedger(terms, fills), fills, "f1"));
    const st = replayLedger(terms, fills);
    expect(() => planReversal(st, fills, "f1")).toThrow(expect.objectContaining({ code: "REVERSAL_ALREADY_REVERSED" }));
    expect(() => planReversal(st, fills, "f2")).toThrow(expect.objectContaining({ code: "REVERSAL_TARGET_NOT_CLOSE" }));
    expect(() => planReversal(st, fills, "other-trade-fill")).toThrow(expect.objectContaining({ code: "REVERSAL_TARGET_NOT_FOUND" }));
  });

  it("close planning rejects over-close, off-step, and closed positions", () => {
    const fills = close([], { quantity: "0.83" }, "2010");
    expect(() => close(fills, { quantity: "0.01" }, "2010")).toThrow(expect.objectContaining({ code: "POSITION_CLOSED" }));
    expect(() => close([], { quantity: "0.84" }, "2010")).toThrow(expect.objectContaining({ code: "EXCEEDS_REMAINING" }));
    expect(() => close([], { quantity: "0.415" }, "2010")).toThrow(expect.objectContaining({ code: "INVALID_QUANTITY" }));
    expect(() => close([], { quantity: "0.5" }, "0")).toThrow(expect.objectContaining({ code: "INVALID_PRICE" }));
  });

  it("detects any stored fact that disagrees with the replay", () => {
    const fills = close([], { quantity: "0.5" }, "2010");
    const bad = (patch: Partial<LedgerFill>) => () => replayLedger(terms, [{ ...fills[0], ...patch }]);
    expect(bad({ grossPnl: "501" })).toThrow(LedgerError);
    expect(bad({ quantityAfter: "0.32" })).toThrow(/quantityAfter/);
    expect(bad({ sequence: 2 })).toThrow(/sequence gap/);
    expect(bad({ executedQuantity: "0.9", quantityAfter: "-0.07" })).toThrow(LedgerError);
    const rev = append(fills, planReversal(replayLedger(terms, fills), fills, "f1"));
    expect(() => replayLedger(terms, [rev[0], { ...rev[1], grossPnl: "0" }])).toThrow(/negate/);
  });

  it("per-fill conversion rate is applied to that fill only", () => {
    const fx: LedgerTerms = { ...terms, quoteValuePerPriceUnit: "100000", entry: "150", initialQuantity: "1", riskAmount: "1000", quantityStep: "0.01" };
    const p = planCloseFill(fx, replayLedger(fx, []), { quantity: "1" }, "150.5", "0.0065");
    expect(s(p.grossPnl)).toBe("325"); // 0.5 × 1 × 100000 × 0.0065
  });
});

describe("reader projection (derived, in memory)", () => {
  it("projects effective closes as percent-of-original summing to exactly 100", () => {
    let fills: LedgerFill[] = [];
    fills = close(fills, { percentOfRemaining: "50" }, "2012");
    const open = projectLedgerForReaders(replayLedger(terms, fills));
    expect(open.fullyClosed).toBe(false);
    expect(Number(open.partials[0].percentClosed)).toBeCloseTo(49.3976, 4);
    expect(open.realizedRSoFar).toBe("0.492");

    fills = close(fills, { percentOfRemaining: "50" }, "2024");
    fills = close(fills, { percentOfRemaining: "100" }, "2006");
    const done = projectLedgerForReaders(replayLedger(terms, fills));
    const total = done.partials.reduce((sum, p) => sum + Number(p.percentClosed), 0);
    expect(total).toBeCloseTo(100, 10);
    expect(done.closedPercent).toBe("100");
  });
});

describe("spec snapshot", () => {
  it("round-trips the resolved economics exactly", () => {
    const r = resolveExecutionSpec({ symbol: "XAUUSD" });
    if (r.status !== "RESOLVED") throw new Error();
    const json = JSON.parse(JSON.stringify(toSpecSnapshot(r.spec)));
    const back = fromSpecSnapshot(json);
    expect([s(back.contractSize), s(back.quantityStep), s(back.minQuantity), back.quoteCurrency, back.pricingModel]).toEqual([
      "100",
      "0.01",
      "0.01",
      "USD",
      "CONTRACT_SIZE",
    ]);
    expect(() => fromSpecSnapshot({ version: 9 })).toThrow(/LEDGER_CORRUPT/);
  });
});
