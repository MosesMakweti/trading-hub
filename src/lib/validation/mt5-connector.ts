import { z } from "zod";

/**
 * MT5 Connector wire format (docs/MT5_CONNECTOR.md). Tickets, logins and
 * every decimal travel as STRINGS (MT5 tickets are ulong, and doubles must
 * never pass through a JS number). MQL5 enum values travel as their names.
 *
 * Batch envelopes are validated strictly; the individual deals/orders inside
 * them are validated one by one (see `mt5DealWireSchema`) so a single
 * malformed record is reported back as rejected instead of blocking the
 * whole account's sync forever.
 */

export const MT5_MAX_BODY_BYTES = 2_000_000; // well under Vercel's 4.5MB request cap
export const MT5_MAX_DEALS_PER_BATCH = 500;
export const MT5_MAX_ORDERS_PER_BATCH = 500;
export const MT5_MAX_POSITION_CHANGES = 500;
export const MT5_MAX_OPEN_POSITIONS = 1000;
export const MT5_MAX_SYMBOLS = 500;

const ticket = z.string().regex(/^\d{1,20}$/, "Must be a ticket number string.");
const optTicket = ticket.nullable().optional();
const decimal = z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/, "Must be a decimal string.");
const optDecimal = decimal.nullable().optional();
const msc = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,16}$/)]);
const enumName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Must be an MQL5 enum name.");
const text = (max: number) => z.string().max(max).nullable().optional();

export const mt5AccountIdentitySchema = z.object({
  login: z.string().regex(/^\d{1,20}$/, "login must be the numeric MT5 account number."),
  server: z.string().trim().min(1).max(128),
});

export const mt5IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/, "Invalid Idempotency-Key.");

export const mt5DealWireSchema = z.object({
  ticket,
  order: optTicket,
  positionId: optTicket,
  timeMsc: msc,
  type: enumName,
  entry: enumName.nullable().optional(),
  reason: enumName.nullable().optional(),
  symbol: text(64),
  volume: optDecimal,
  price: optDecimal,
  profit: optDecimal,
  commission: optDecimal,
  swap: optDecimal,
  fee: optDecimal,
  sl: optDecimal,
  tp: optDecimal,
  magic: z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
  comment: text(256),
  externalId: text(128),
});

export const mt5OrderWireSchema = z.object({
  ticket,
  positionId: optTicket,
  positionById: optTicket,
  type: enumName,
  state: enumName,
  reason: enumName.nullable().optional(),
  symbol: text(64),
  timeSetupMsc: msc.nullable().optional(),
  timeDoneMsc: msc.nullable().optional(),
  volumeInitial: optDecimal,
  volumeCurrent: optDecimal,
  priceOpen: optDecimal,
  priceStopLimit: optDecimal,
  sl: optDecimal,
  tp: optDecimal,
  magic: z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
  comment: text(256),
  externalId: text(128),
});

export const mt5PositionChangeSchema = z.object({
  positionId: ticket,
  sl: optDecimal,
  tp: optDecimal,
  observedAtMsc: msc,
});

export const mt5PairRequestSchema = z.object({
  pairingCode: z.string().trim().min(4).max(32),
  terminal: z.object({
    login: mt5AccountIdentitySchema.shape.login,
    server: mt5AccountIdentitySchema.shape.server,
    company: text(128),
    name: text(128),
    currency: z.string().trim().min(1).max(16),
    currencyDigits: z.number().int().min(0).max(12).nullable().optional(),
    leverage: z.number().int().min(0).max(100_000).nullable().optional(),
    marginMode: z.enum(["NETTING", "HEDGING", "EXCHANGE"]),
    tradeMode: z.enum(["DEMO", "CONTEST", "REAL"]),
    build: z.number().int().min(0).max(1_000_000).nullable().optional(),
    eaVersion: z.string().trim().min(1).max(32),
    /** TimeTradeServer() − TimeGMT(), seconds. */
    gmtOffsetSeconds: z.number().int().min(-15 * 3600).max(15 * 3600),
  }),
});

export const mt5HistoryRequestSchema = z.object({
  account: mt5AccountIdentitySchema,
  kind: z.enum(["BACKFILL", "RECONCILE"]),
  batchSeq: z.number().int().min(0).max(10_000_000).nullable().optional(),
  rangeFromMsc: msc.nullable().optional(),
  rangeToMsc: msc.nullable().optional(),
  isFinal: z.boolean().default(false),
  deals: z.array(z.unknown()).max(MT5_MAX_DEALS_PER_BATCH).default([]),
  orders: z.array(z.unknown()).max(MT5_MAX_ORDERS_PER_BATCH).default([]),
});

export const mt5EventsRequestSchema = z.object({
  account: mt5AccountIdentitySchema,
  deals: z.array(z.unknown()).max(MT5_MAX_DEALS_PER_BATCH).default([]),
  orders: z.array(z.unknown()).max(MT5_MAX_ORDERS_PER_BATCH).default([]),
  positionChanges: z.array(mt5PositionChangeSchema).max(MT5_MAX_POSITION_CHANGES).default([]),
});

export const mt5OpenPositionSchema = z.object({
  positionId: ticket,
  symbol: z.string().max(64),
  type: z.enum(["POSITION_TYPE_BUY", "POSITION_TYPE_SELL"]),
  volume: decimal,
  priceOpen: decimal,
  priceCurrent: optDecimal,
  sl: optDecimal,
  tp: optDecimal,
  swap: optDecimal,
  profit: optDecimal,
  timeMsc: msc.nullable().optional(),
  magic: z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
  comment: text(256),
});

export const mt5HeartbeatRequestSchema = z.object({
  account: mt5AccountIdentitySchema,
  eaVersion: z.string().trim().min(1).max(32).optional(),
  build: z.number().int().min(0).max(1_000_000).optional(),
  gmtOffsetSeconds: z.number().int().min(-15 * 3600).max(15 * 3600).optional(),
  serverTimeMsc: msc.nullable().optional(),
  snapshot: z.object({
    balance: decimal,
    equity: decimal,
    margin: decimal,
    freeMargin: decimal,
    credit: decimal.default("0"),
    profit: decimal.default("0"),
  }),
  openPositions: z.array(mt5OpenPositionSchema).max(MT5_MAX_OPEN_POSITIONS).default([]),
});

export const mt5SymbolSpecSchema = z.object({
  symbol: z.string().min(1).max(64),
  description: text(256),
  digits: z.number().int().min(0).max(16).nullable().optional(),
  contractSize: optDecimal,
  tickSize: optDecimal,
  tickValue: optDecimal,
  volumeMin: optDecimal,
  volumeMax: optDecimal,
  volumeStep: optDecimal,
  currencyBase: text(16),
  currencyProfit: text(16),
  currencyMargin: text(16),
});

export const mt5SymbolsRequestSchema = z.object({
  account: mt5AccountIdentitySchema,
  specs: z.array(mt5SymbolSpecSchema).max(MT5_MAX_SYMBOLS),
});

/** Web-side: the trader's chosen server-time convention. */
export const mt5TimeConventionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FIXED_OFFSET"), offsetMinutes: z.number().int().min(-840).max(840).refine((v) => v % 15 === 0, "Offsets are whole quarter hours.") }),
  z.object({ kind: z.literal("NY_CLOSE") }),
  z.object({ kind: z.literal("IANA_ZONE"), zone: z.string().min(1).max(64) }),
]);

export type Mt5PairRequest = z.infer<typeof mt5PairRequestSchema>;
export type Mt5HistoryRequest = z.infer<typeof mt5HistoryRequestSchema>;
export type Mt5EventsRequest = z.infer<typeof mt5EventsRequestSchema>;
export type Mt5HeartbeatRequest = z.infer<typeof mt5HeartbeatRequestSchema>;
export type Mt5SymbolsRequest = z.infer<typeof mt5SymbolsRequestSchema>;
export type Mt5TimeConventionInput = z.infer<typeof mt5TimeConventionInputSchema>;
