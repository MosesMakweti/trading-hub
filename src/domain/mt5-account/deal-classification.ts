import { createHash } from "node:crypto";

/**
 * MT5 Connector — classification and normalization of raw MT5 deals/orders.
 *
 * Pure. Inputs are the connector's wire format (tickets and decimals as
 * strings, enum values as their MQL5 names, e.g. "DEAL_TYPE_BUY"); outputs
 * are plain values ready for persistence. Nothing here guesses: an unknown
 * deal type is UNKNOWN, a missing value stays null.
 */

export type Mt5DealCategory =
  | "TRADE"
  | "TRADE_CANCELED"
  | "BALANCE"
  | "CREDIT"
  | "CHARGE"
  | "CORRECTION"
  | "BONUS"
  | "COMMISSION"
  | "INTEREST"
  | "DIVIDEND"
  | "TAX"
  | "UNKNOWN";

export type Mt5Side = "BUY" | "SELL";
export type Mt5DealEntry = "IN" | "OUT" | "INOUT" | "OUT_BY";

/** ENUM_DEAL_TYPE → category (+ side for trade deals). */
const DEAL_TYPES: Record<string, { category: Mt5DealCategory; side: Mt5Side | null }> = {
  DEAL_TYPE_BUY: { category: "TRADE", side: "BUY" },
  DEAL_TYPE_SELL: { category: "TRADE", side: "SELL" },
  DEAL_TYPE_BUY_CANCELED: { category: "TRADE_CANCELED", side: "BUY" },
  DEAL_TYPE_SELL_CANCELED: { category: "TRADE_CANCELED", side: "SELL" },
  DEAL_TYPE_BALANCE: { category: "BALANCE", side: null },
  DEAL_TYPE_CREDIT: { category: "CREDIT", side: null },
  DEAL_TYPE_CHARGE: { category: "CHARGE", side: null },
  DEAL_TYPE_CORRECTION: { category: "CORRECTION", side: null },
  DEAL_TYPE_BONUS: { category: "BONUS", side: null },
  DEAL_TYPE_COMMISSION: { category: "COMMISSION", side: null },
  DEAL_TYPE_COMMISSION_DAILY: { category: "COMMISSION", side: null },
  DEAL_TYPE_COMMISSION_MONTHLY: { category: "COMMISSION", side: null },
  DEAL_TYPE_COMMISSION_AGENT_DAILY: { category: "COMMISSION", side: null },
  DEAL_TYPE_COMMISSION_AGENT_MONTHLY: { category: "COMMISSION", side: null },
  DEAL_TYPE_INTEREST: { category: "INTEREST", side: null },
  DEAL_DIVIDEND: { category: "DIVIDEND", side: null },
  DEAL_DIVIDEND_FRANKED: { category: "DIVIDEND", side: null },
  DEAL_TAX: { category: "TAX", side: null },
};

const DEAL_ENTRIES: Record<string, Mt5DealEntry> = {
  DEAL_ENTRY_IN: "IN",
  DEAL_ENTRY_OUT: "OUT",
  DEAL_ENTRY_INOUT: "INOUT",
  DEAL_ENTRY_OUT_BY: "OUT_BY",
};

export function classifyDealType(type: string): { category: Mt5DealCategory; side: Mt5Side | null } {
  return DEAL_TYPES[type] ?? { category: "UNKNOWN", side: null };
}

/** DEAL_ENTRY_STATE (and anything unknown) → null. */
export function parseDealEntry(entry: string | null | undefined): Mt5DealEntry | null {
  if (!entry) return null;
  return DEAL_ENTRIES[entry] ?? null;
}

/** Non-trade categories that move the account balance. TRADE deals move it
 *  through profit/commission/swap/fee instead. (Informational in Stage 1 —
 *  nothing here posts to any ledger.) */
export function isBalanceOperation(category: Mt5DealCategory): boolean {
  return category !== "TRADE" && category !== "TRADE_CANCELED" && category !== "UNKNOWN";
}

/** MT5 uses 0 for "no ticket" (e.g. DEAL_POSITION_ID of a balance deal). */
export function nonZeroTicket(ticket: string | null | undefined): string | null {
  if (ticket == null) return null;
  return /^0+$/.test(ticket) ? null : ticket;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** Canonical decimal string (no leading +, no trailing zeros beyond the
 *  point, "-0" → "0"). Throws on anything that isn't a plain decimal. */
export function canonicalDecimal(value: string): string {
  if (!DECIMAL_RE.test(value)) throw new Error(`Not a decimal string: ${value}`);
  const negative = value.startsWith("-");
  const [intPartRaw, fracRaw = ""] = (negative ? value.slice(1) : value).split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  const body = frac ? `${intPart}.${frac}` : intPart;
  return negative && /[1-9]/.test(body) ? `-${body}` : body;
}

/** A stop/target field as MT5 reports it: absent, explicitly none (0), or a level. */
export type StopFieldState = "SET" | "NONE" | "ABSENT";

export function stopField(value: string | null | undefined): { state: StopFieldState; level: string | null } {
  if (value == null || value === "") return { state: "ABSENT", level: null };
  const canonical = canonicalDecimal(value);
  if (canonical === "0") return { state: "NONE", level: null };
  return { state: "SET", level: canonical };
}

/** Stable JSON (sorted keys) — so a re-sent record hashes identically
 *  regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function payloadHash(raw: unknown): string {
  return createHash("sha256").update(stableStringify(raw), "utf8").digest("hex");
}

/** The connector's deal wire format (already shape-validated by Zod). */
export interface Mt5DealWire {
  ticket: string;
  order?: string | null;
  positionId?: string | null;
  timeMsc: string | number;
  type: string;
  entry?: string | null;
  reason?: string | null;
  symbol?: string | null;
  volume?: string | null;
  price?: string | null;
  profit?: string | null;
  commission?: string | null;
  swap?: string | null;
  fee?: string | null;
  sl?: string | null;
  tp?: string | null;
  magic?: string | null;
  comment?: string | null;
  externalId?: string | null;
}

export interface NormalizedDeal {
  ticket: string;
  orderTicket: string | null;
  positionId: string | null;
  timeMsc: bigint;
  type: string;
  category: Mt5DealCategory;
  side: Mt5Side | null;
  entry: Mt5DealEntry | null;
  reason: string | null;
  symbol: string | null;
  volume: string | null;
  price: string | null;
  profit: string;
  commission: string;
  swap: string;
  fee: string;
  stopLoss: string | null;
  takeProfit: string | null;
  magic: string | null;
  comment: string | null;
  externalId: string | null;
  payloadHash: string;
}

export type NormalizeResult<T> = { ok: true; value: T } | { ok: false; message: string };

const money = (v: string | null | undefined) => (v == null || v === "" ? "0" : canonicalDecimal(v));
const optDecimal = (v: string | null | undefined) => (v == null || v === "" ? null : canonicalDecimal(v));

export function toBigIntMsc(value: string | number): bigint {
  const big = BigInt(value);
  if (big < BigInt(0)) throw new Error("Negative MT5 time.");
  return big;
}

/**
 * Normalizes one wire deal. Rejects (never repairs) a deal that is internally
 * inconsistent in a way that would make position reconstruction guess: a
 * BUY/SELL deal without an entry, without a position id, or without
 * volume/price.
 */
export function normalizeDeal(wire: Mt5DealWire): NormalizeResult<NormalizedDeal> {
  try {
    const { category, side } = classifyDealType(wire.type);
    const entry = parseDealEntry(wire.entry);
    const positionId = nonZeroTicket(wire.positionId);
    const volume = optDecimal(wire.volume);
    const price = optDecimal(wire.price);
    if (category === "TRADE") {
      if (!entry) return { ok: false, message: "Trade deal is missing a valid entry (DEAL_ENTRY_IN/OUT/INOUT/OUT_BY)." };
      if (!positionId) return { ok: false, message: "Trade deal is missing DEAL_POSITION_ID." };
      if (volume == null || price == null) return { ok: false, message: "Trade deal is missing volume or price." };
      if (volume.startsWith("-") || volume === "0") return { ok: false, message: "Trade deal volume must be positive." };
      if (!wire.symbol) return { ok: false, message: "Trade deal is missing its symbol." };
    }
    return {
      ok: true,
      value: {
        ticket: wire.ticket,
        orderTicket: nonZeroTicket(wire.order),
        positionId,
        timeMsc: toBigIntMsc(wire.timeMsc),
        type: wire.type,
        category,
        side,
        entry,
        reason: wire.reason ?? null,
        symbol: wire.symbol ? wire.symbol : null,
        volume,
        price,
        profit: money(wire.profit),
        commission: money(wire.commission),
        swap: money(wire.swap),
        fee: money(wire.fee),
        stopLoss: stopField(wire.sl).level,
        takeProfit: stopField(wire.tp).level,
        magic: wire.magic ?? null,
        comment: wire.comment ?? null,
        externalId: wire.externalId ?? null,
        payloadHash: payloadHash(wire),
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Invalid deal." };
  }
}

export interface Mt5OrderWire {
  ticket: string;
  positionId?: string | null;
  positionById?: string | null;
  type: string;
  state: string;
  reason?: string | null;
  symbol?: string | null;
  timeSetupMsc?: string | number | null;
  timeDoneMsc?: string | number | null;
  volumeInitial?: string | null;
  volumeCurrent?: string | null;
  priceOpen?: string | null;
  priceStopLimit?: string | null;
  sl?: string | null;
  tp?: string | null;
  magic?: string | null;
  comment?: string | null;
  externalId?: string | null;
}

export interface NormalizedOrder {
  ticket: string;
  positionId: string | null;
  positionById: string | null;
  type: string;
  state: string;
  reason: string | null;
  symbol: string | null;
  timeSetupMsc: bigint | null;
  timeDoneMsc: bigint | null;
  volumeInitial: string | null;
  volumeCurrent: string | null;
  priceOpen: string | null;
  priceStopLimit: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  magic: string | null;
  comment: string | null;
  externalId: string | null;
  payloadHash: string;
}

export function normalizeOrder(wire: Mt5OrderWire): NormalizeResult<NormalizedOrder> {
  try {
    return {
      ok: true,
      value: {
        ticket: wire.ticket,
        positionId: nonZeroTicket(wire.positionId),
        positionById: nonZeroTicket(wire.positionById),
        type: wire.type,
        state: wire.state,
        reason: wire.reason ?? null,
        symbol: wire.symbol ? wire.symbol : null,
        timeSetupMsc: wire.timeSetupMsc == null ? null : toBigIntMsc(wire.timeSetupMsc),
        timeDoneMsc: wire.timeDoneMsc == null ? null : toBigIntMsc(wire.timeDoneMsc),
        volumeInitial: optDecimal(wire.volumeInitial),
        volumeCurrent: optDecimal(wire.volumeCurrent),
        priceOpen: optDecimal(wire.priceOpen),
        priceStopLimit: optDecimal(wire.priceStopLimit),
        stopLoss: stopField(wire.sl).level,
        takeProfit: stopField(wire.tp).level,
        magic: wire.magic ?? null,
        comment: wire.comment ?? null,
        externalId: wire.externalId ?? null,
        payloadHash: payloadHash(wire),
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Invalid order." };
  }
}
