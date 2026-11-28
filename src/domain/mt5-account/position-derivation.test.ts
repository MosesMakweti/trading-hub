import { describe, expect, it } from "vitest";

import { normalizeDeal, stopField, type Mt5DealWire } from "./deal-classification";
import { derivePosition, MT5_POSITION_DERIVATION_VERSION, type DerivationDeal, type DerivationOrder } from "./position-derivation";

/** Wire deal → derivation input, through the real normalizer. */
function deal(partial: Partial<Mt5DealWire> & { ticket: string; timeMsc: string | number; type: string }): DerivationDeal {
  const wire: Mt5DealWire = { symbol: "EURUSD", volume: "1", price: "1.1", profit: "0", commission: "0", swap: "0", fee: "0", ...partial };
  const n = normalizeDeal(wire);
  if (!n.ok) throw new Error(n.message);
  const v = n.value;
  return {
    ticket: v.ticket,
    orderTicket: v.orderTicket,
    timeMsc: v.timeMsc,
    category: v.category,
    side: v.side,
    entry: v.entry,
    symbol: v.symbol,
    volume: v.volume,
    price: v.price,
    profit: v.profit,
    commission: v.commission,
    swap: v.swap,
    fee: v.fee,
    stopLoss: v.stopLoss,
    stopLossState: stopField(wire.sl).state,
    takeProfit: v.takeProfit,
    payloadHash: v.payloadHash,
  };
}

const buy = (ticket: string, t: number, entry: string, extra: Partial<Mt5DealWire> = {}) =>
  deal({ ticket, timeMsc: t, type: "DEAL_TYPE_BUY", entry: `DEAL_ENTRY_${entry}`, positionId: "P1", ...extra });
const sell = (ticket: string, t: number, entry: string, extra: Partial<Mt5DealWire> = {}) =>
  deal({ ticket, timeMsc: t, type: "DEAL_TYPE_SELL", entry: `DEAL_ENTRY_${entry}`, positionId: "P1", ...extra });

describe("derivePosition — netting/hedging basics", () => {
  it("simple long round trip with commission and swap (MT5 signs: costs negative)", () => {
    const p = derivePosition("P1", [
      buy("10", 1000, "IN", { volume: "0.5", price: "1.10000", commission: "-3.50" }),
      sell("11", 2000, "OUT", { volume: "0.5", price: "1.10200", profit: "100.00", commission: "-3.50", swap: "-1.25" }),
    ])!;
    expect(p.direction).toBe("LONG");
    expect(p.status).toBe("CLOSED");
    expect(p.avgEntryPrice).toBe("1.1");
    expect(p.avgExitPrice).toBe("1.102");
    expect(p.profit).toBe("100");
    expect(p.commission).toBe("-7");
    expect(p.swap).toBe("-1.25");
    expect(p.netProfit).toBe("91.75");
    expect(p.openedMsc).toBe(BigInt(1000));
    expect(p.closedMsc).toBe(BigInt(2000));
    expect(p.openVolume).toBe("0");
    expect(p.flags).toEqual([]);
    expect(p.derivationVersion).toBe(MT5_POSITION_DERIVATION_VERSION);
  });

  it("hedging: two simultaneous positions on the same symbol in opposite directions stay separate", () => {
    const long = derivePosition("A", [
      deal({ ticket: "1", timeMsc: 1, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "A", volume: "1", price: "2000" }),
      deal({ ticket: "4", timeMsc: 4, type: "DEAL_TYPE_SELL", entry: "DEAL_ENTRY_OUT", positionId: "A", volume: "1", price: "2010", profit: "1000" }),
    ])!;
    const short = derivePosition("B", [
      deal({ ticket: "2", timeMsc: 2, type: "DEAL_TYPE_SELL", entry: "DEAL_ENTRY_IN", positionId: "B", volume: "2", price: "2005" }),
      deal({ ticket: "3", timeMsc: 3, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_OUT", positionId: "B", volume: "2", price: "2001", profit: "800" }),
    ])!;
    expect(long.direction).toBe("LONG");
    expect(long.volumeIn).toBe("1");
    expect(short.direction).toBe("SHORT");
    expect(short.volumeIn).toBe("2");
    expect(short.avgExitPrice).toBe("2001");
    expect(long.flags).not.toContain("DIRECTION_CONFLICT");
    expect(short.flags).not.toContain("DIRECTION_CONFLICT");
  });

  it("hedging: two same-direction positions on one symbol are never merged", () => {
    const a = derivePosition("A", [deal({ ticket: "1", timeMsc: 1, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "A", volume: "1", price: "10" })])!;
    const b = derivePosition("B", [deal({ ticket: "2", timeMsc: 2, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "B", volume: "3", price: "12" })])!;
    expect(a.volumeIn).toBe("1");
    expect(b.volumeIn).toBe("3");
    expect(a.status).toBe("OPEN");
    expect(b.openVolume).toBe("3");
  });

  it("netting: scale-in uses a volume-weighted entry", () => {
    const p = derivePosition("P1", [
      buy("1", 1, "IN", { volume: "1", price: "100" }),
      buy("2", 2, "IN", { volume: "3", price: "104" }),
      sell("3", 3, "OUT", { volume: "4", price: "110", profit: "36" }),
    ])!;
    expect(p.avgEntryPrice).toBe("103");
    expect(p.entryCount).toBe(2);
    expect(p.flags).toContain("SCALED_IN");
    expect(p.status).toBe("CLOSED");
  });

  it("partial closes accumulate; position stays open until volume is zero", () => {
    const deals = [
      buy("1", 1, "IN", { volume: "1.00", price: "1.2000" }),
      sell("2", 2, "OUT", { volume: "0.30", price: "1.2100", profit: "300" }),
      sell("3", 3, "OUT", { volume: "0.20", price: "1.2200", profit: "400" }),
    ];
    const open = derivePosition("P1", deals)!;
    expect(open.status).toBe("OPEN");
    expect(open.openVolume).toBe("0.5");
    expect(open.closedMsc).toBeNull();
    const closed = derivePosition("P1", [...deals, sell("4", 4, "OUT", { volume: "0.5", price: "1.2000", profit: "0" })])!;
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitCount).toBe(3);
    expect(closed.flags).toContain("PARTIALLY_CLOSED");
    // (0.3*1.21 + 0.2*1.22 + 0.5*1.20) / 1.0
    expect(closed.avgExitPrice).toBe("1.207");
    expect(closed.profit).toBe("700");
  });
});

describe("derivePosition — reversals and close-by", () => {
  it("INOUT reversal keeps one position id, closes the open side and opens the excess opposite", () => {
    const p = derivePosition("P1", [
      buy("1", 1, "IN", { volume: "1", price: "100" }),
      sell("2", 2, "INOUT", { volume: "3", price: "105", profit: "500", commission: "-6" }),
      buy("3", 3, "OUT", { volume: "2", price: "101", profit: "800", commission: "-4" }),
    ])!;
    expect(p.flags).toContain("REVERSED");
    expect(p.reversalCount).toBe(1);
    expect(p.direction).toBe("LONG"); // first segment
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0]).toMatchObject({ direction: "LONG", volumeIn: "1", volumeOut: "1", avgEntryPrice: "100", avgExitPrice: "105", profit: "500" });
    expect(p.segments[1]).toMatchObject({ direction: "SHORT", volumeIn: "2", volumeOut: "2", avgEntryPrice: "105", avgExitPrice: "101", profit: "800" });
    // Mixed directions: no single position-level VWAP.
    expect(p.avgEntryPrice).toBeNull();
    expect(p.avgExitPrice).toBeNull();
    expect(p.status).toBe("CLOSED");
    expect(p.netProfit).toBe("1290");
  });

  it("INOUT leaving the reversed side open", () => {
    const p = derivePosition("P1", [buy("1", 1, "IN", { volume: "1", price: "100" }), sell("2", 2, "INOUT", { volume: "1.5", price: "99", profit: "-100" })])!;
    expect(p.status).toBe("OPEN");
    expect(p.openVolume).toBe("0.5");
    expect(p.segments[1].direction).toBe("SHORT");
  });

  it("OUT_BY close-by: each position is closed by its own OUT_BY deal", () => {
    const longPos = derivePosition("L", [
      deal({ ticket: "1", timeMsc: 1, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "L", volume: "1", price: "100" }),
      deal({ ticket: "3", timeMsc: 3, type: "DEAL_TYPE_SELL", entry: "DEAL_ENTRY_OUT_BY", positionId: "L", volume: "1", price: "102", profit: "200" }),
    ])!;
    const shortPos = derivePosition("S", [
      deal({ ticket: "2", timeMsc: 2, type: "DEAL_TYPE_SELL", entry: "DEAL_ENTRY_IN", positionId: "S", volume: "1", price: "101" }),
      deal({ ticket: "4", timeMsc: 3, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_OUT_BY", positionId: "S", volume: "1", price: "102", profit: "-100" }),
    ])!;
    for (const p of [longPos, shortPos]) {
      expect(p.status).toBe("CLOSED");
      expect(p.flags).toContain("CLOSED_BY");
    }
    expect(longPos.netProfit).toBe("200");
    expect(shortPos.netProfit).toBe("-100");
  });

  it("partial close-by leaves the larger position open", () => {
    const p = derivePosition("L", [
      deal({ ticket: "1", timeMsc: 1, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "L", volume: "2", price: "100" }),
      deal({ ticket: "3", timeMsc: 3, type: "DEAL_TYPE_SELL", entry: "DEAL_ENTRY_OUT_BY", positionId: "L", volume: "0.5", price: "102", profit: "100" }),
    ])!;
    expect(p.status).toBe("OPEN");
    expect(p.openVolume).toBe("1.5");
  });
});

describe("derivePosition — determinism, precision and unknowns", () => {
  const deals = [
    buy("7", 5, "IN", { volume: "0.01", price: "1.23456" }),
    buy("6", 5, "IN", { volume: "0.02", price: "1.23457" }), // same ms — ticket order decides
    sell("9", 9, "OUT", { volume: "0.03", price: "1.23500", profit: "0.13", commission: "-0.21", swap: "-0.07", fee: "-0.01" }),
  ];

  it("is independent of input order and has a stable source hash", () => {
    const a = derivePosition("P1", deals)!;
    const b = derivePosition("P1", [...deals].reverse())!;
    expect(b).toEqual(a);
    expect(a.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    const c = derivePosition("P1", [...deals, sell("10", 10, "OUT", { volume: "0.01", price: "1" })])!;
    expect(c.sourceHash).not.toBe(a.sourceHash);
  });

  it("keeps exact decimals (no float drift)", () => {
    const p = derivePosition("P1", deals)!;
    expect(p.volumeIn).toBe("0.03");
    expect(p.avgEntryPrice).toBe("1.2345666667"); // (0.01*1.23456 + 0.02*1.23457)/0.03, half-even to 10dp
    expect(p.netProfit).toBe("-0.16"); // 0.13 - 0.21 - 0.07 - 0.01 exactly
    const many = derivePosition("P1", [
      buy("1", 1, "IN", { volume: "0.1", price: "1" }),
      ...Array.from({ length: 10 }, (_, i) => sell(String(10 + i), 10 + i, "OUT", { volume: "0.01", price: "1", profit: "0.1" })),
    ])!;
    expect(many.volumeOut).toBe("0.1");
    expect(many.profit).toBe("1");
    expect(many.status).toBe("CLOSED");
  });

  it("missing opening deals → INCOMPLETE_HISTORY, entry unknown, never guessed", () => {
    const p = derivePosition("P1", [sell("2", 2, "OUT", { volume: "1", price: "1.3", profit: "50" })])!;
    expect(p.flags).toContain("INCOMPLETE_HISTORY");
    expect(p.direction).toBe("LONG");
    expect(p.avgEntryPrice).toBeNull();
    expect(p.openedMsc).toBeNull();
    expect(p.initialStopSource).toBe("UNAVAILABLE");
    expect(p.status).toBe("CLOSED");
    expect(p.netProfit).toBe("50");
  });

  it("canceled deals are flagged and excluded", () => {
    const p = derivePosition("P1", [
      buy("1", 1, "IN"),
      deal({ ticket: "2", timeMsc: 2, type: "DEAL_TYPE_BUY_CANCELED", entry: "DEAL_ENTRY_IN", positionId: "P1" }),
    ])!;
    expect(p.flags).toContain("CANCELED_DEAL_PRESENT");
    expect(p.volumeIn).toBe("1");
  });

  it("returns null when the position has no trade deals", () => {
    expect(derivePosition("P1", [])).toBeNull();
  });
});

describe("derivePosition — initial stop (never guessed)", () => {
  const order = (ticket: string, sl: string | null): DerivationOrder => ({
    ticket,
    stopLoss: stopField(sl).level,
    stopLossState: stopField(sl).state,
    takeProfit: null,
    payloadHash: `h${ticket}`,
  });

  it("uses the opening deal's SL", () => {
    const p = derivePosition("P1", [buy("1", 1, "IN", { sl: "1.0950", tp: "1.1200", order: "500" })], [order("500", "1.09")])!;
    expect(p.initialStopSource).toBe("OPENING_DEAL");
    expect(p.initialStopLoss).toBe("1.095");
    expect(p.initialTakeProfit).toBe("1.12");
  });

  it("falls back to the opening order's SL", () => {
    const p = derivePosition("P1", [buy("1", 1, "IN", { order: "500" })], [order("500", "1.09")])!;
    expect(p.initialStopSource).toBe("OPENING_ORDER");
    expect(p.initialStopLoss).toBe("1.09");
  });

  it("explicit 0 means no stop at open; absent means unavailable", () => {
    expect(derivePosition("P1", [buy("1", 1, "IN", { sl: "0" })])!.initialStopSource).toBe("NONE_AT_OPEN");
    const p = derivePosition("P1", [buy("1", 1, "IN", { order: "500" })])!;
    expect(p.initialStopSource).toBe("UNAVAILABLE");
    expect(p.initialStopLoss).toBeNull();
  });

  it("ignores stops on later (exit) deals", () => {
    const p = derivePosition("P1", [buy("1", 1, "IN"), sell("2", 2, "OUT", { sl: "1.05" })])!;
    expect(p.initialStopSource).toBe("UNAVAILABLE");
  });
});
