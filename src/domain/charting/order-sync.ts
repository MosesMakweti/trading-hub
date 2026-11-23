/**
 * Position drawing ↔ order ticket synchronisation (pure).
 *
 * A LONG/SHORT drawing is a plan: entry, stop, targets. With sync on, the
 * selected drawing DRAFTS the ticket and edits in the ticket move the
 * drawing. Nothing here places an order — the trader confirms, and the
 * server validates every level and the size again as if typed.
 */
import type { ChartDrawing, DrawingOrderRef, PositionData } from "@/domain/native-replay/drawings/model";

export type DraftOrderType = "MARKET" | "LIMIT" | "STOP";

export interface OrderDraft {
  side: "BUY" | "SELL";
  type: DraftOrderType;
  /** Entry for pending orders; null at market. */
  price: number | null;
  stopLoss: number;
  takeProfit: number | null;
}

export const isPositionDrawing = (d: ChartDrawing | null | undefined): d is ChartDrawing & { data: { position: PositionData } } =>
  !!d && (d.type === "LONG" || d.type === "SHORT") && !!d.data.position;

/**
 * The order a drawing implies at the current quote. A long entry below the
 * ask is a buy LIMIT, above it a buy STOP; a short mirrors that against the
 * bid. Within `tolerance` of the market it is a MARKET order.
 */
export function draftFromDrawing(d: ChartDrawing, quote: { bid: number; ask: number } | null, tolerance = 0): OrderDraft | null {
  if (!isPositionDrawing(d)) return null;
  const p = d.data.position;
  const side = d.type === "LONG" ? "BUY" : "SELL";
  let type: DraftOrderType = "LIMIT";
  if (quote) {
    const ref = side === "BUY" ? quote.ask : quote.bid;
    if (Math.abs(p.entry - ref) <= tolerance) type = "MARKET";
    else if (side === "BUY") type = p.entry < ref ? "LIMIT" : "STOP";
    else type = p.entry > ref ? "LIMIT" : "STOP";
  }
  return { side, type, price: type === "MARKET" ? null : p.entry, stopLoss: p.stop, takeProfit: p.targets[0] ?? null };
}

/** Ticket edits → the drawing's position (entry only moves for pending orders; extra targets are kept). */
export function positionFromTicket(current: PositionData, edit: { price?: number | null; stopLoss?: number | null; takeProfit?: number | null }): PositionData {
  const next: PositionData = { entry: current.entry, stop: current.stop, targets: [...current.targets] };
  if (edit.price != null && Number.isFinite(edit.price) && edit.price > 0) next.entry = edit.price;
  if (edit.stopLoss != null && Number.isFinite(edit.stopLoss) && edit.stopLoss > 0) next.stop = edit.stopLoss;
  if (edit.takeProfit != null && Number.isFinite(edit.takeProfit) && edit.takeProfit > 0) next.targets[0] = edit.takeProfit;
  return next;
}

export const samePosition = (a: PositionData, b: PositionData) => a.entry === b.entry && a.stop === b.stop && a.targets.length === b.targets.length && a.targets.every((t, i) => t === b.targets[i]);

export interface RiskPreview {
  /** Money lost at the stop for the given quantity. */
  riskAmount: number;
  /** Quantity in the instrument's unit (lots). */
  quantity: number;
  /** Reward:risk of each target. */
  rr: number[];
  issues: string[];
}

/**
 * Size and risk from the instrument's value per price unit (contract spec).
 * Mirrors the server's risk sizing so the preview matches what it will do;
 * the server's number is the one that counts.
 */
export function riskPreview(input: {
  side: "BUY" | "SELL";
  entry: number;
  stop: number;
  targets: number[];
  /** Account-currency value of a 1.0 price move for quantity 1. */
  valuePerPrice: number | null;
  balance: number;
  sizing: { mode: "QUANTITY"; quantity: number } | { mode: "RISK_PERCENT"; riskPercent: number } | { mode: "RISK_AMOUNT"; amount: number };
  /** Quantity step (e.g. 0.01 lot). */
  step?: number;
}): RiskPreview {
  const issues: string[] = [];
  const dist = input.side === "BUY" ? input.entry - input.stop : input.stop - input.entry;
  if (!(dist > 0)) issues.push(input.side === "BUY" ? "The stop must be below the entry for a long." : "The stop must be above the entry for a short.");
  const rr = input.targets.map((t) => {
    const reward = input.side === "BUY" ? t - input.entry : input.entry - t;
    return dist > 0 ? Math.round((reward / dist) * 100) / 100 : NaN;
  });
  if (rr.some((r) => !(r > 0))) issues.push("Each target must be on the profit side of the entry.");
  const v = input.valuePerPrice;
  if (v == null || !(v > 0)) {
    issues.push("No contract specification for this instrument — size can't be previewed.");
    return { riskAmount: NaN, quantity: input.sizing.mode === "QUANTITY" ? input.sizing.quantity : NaN, rr, issues };
  }
  const step = input.step ?? 0.01;
  const perUnit = dist > 0 ? dist * v : NaN;
  let quantity: number;
  if (input.sizing.mode === "QUANTITY") quantity = input.sizing.quantity;
  else {
    const budget = input.sizing.mode === "RISK_PERCENT" ? (input.balance * input.sizing.riskPercent) / 100 : input.sizing.amount;
    quantity = Math.floor(budget / perUnit / step + 1e-9) * step;
    quantity = Math.round(quantity / step) * step;
    if (!(quantity > 0)) issues.push("The risk budget is smaller than one minimum size at this stop distance.");
  }
  return { riskAmount: quantity * perUnit, quantity, rr, issues };
}

export type LinkStatus = "draft" | "linked" | "pending" | "open" | "executed";

/** What a drawing's order link means right now, from the account's live orders and positions. */
export function linkStatus(ref: DrawingOrderRef | undefined, linked: boolean, live: { orderIds: Set<string>; positionIds: Set<string> }): LinkStatus {
  if (ref) {
    if (live.orderIds.has(ref.orderId)) return "pending";
    if (ref.positionId && live.positionIds.has(ref.positionId)) return "open";
    return "executed";
  }
  return linked ? "linked" : "draft";
}

export const LINK_LABEL: Record<LinkStatus, string> = {
  draft: "Draft",
  linked: "Linked to ticket",
  pending: "Order pending",
  open: "Position open",
  executed: "Executed",
};
