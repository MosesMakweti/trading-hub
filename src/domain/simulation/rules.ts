/**
 * Simulation account rules — the frozen, versioned rule snapshot every
 * simulation account carries (docs/SIMULATION_PLATFORM.md §4).
 *
 * One schema serves both products:
 *  - a Strategy Lab account uses only `costs` and `dailyResetHour`;
 *  - a Prop Firm phase snapshot fills in the objective, loss limits,
 *    trading limits and (for funded phases) payout terms.
 *
 * The snapshot is copied onto the account when it is created and never
 * re-read from a template afterwards, so editing a firm model can't change an
 * existing challenge. Pure data + validation: no Prisma, no I/O.
 *
 * Time: every boundary (daily reset, trading day, weekend) is on the
 * dataset's BROKER SERVER clock — MT5 exports carry no timezone, so a firm's
 * "5pm New York" can't be converted without guessing (decision D3).
 */
import { z } from "zod";

export const RULES_SCHEMA_VERSION = 1;

const percent = z.number().gt(0).max(100);
const nonNegative = z.number().min(0).max(1e9);

export const costsSchema = z.object({
  /** Commission per quantity unit (lot / contract) per side, in account currency. */
  commissionPerUnitPerSide: nonNegative.default(0),
  /** Spread in price points used when a bar carries no spread of its own. */
  defaultSpreadPoints: z.number().int().min(0).max(100_000).default(0),
  /** Swap per quantity unit per night held, in account currency (signed: negative = charge). */
  swapLongPerUnit: z.number().min(-1e6).max(1e6).default(0),
  swapShortPerUnit: z.number().min(-1e6).max(1e6).default(0),
});

/**
 * Daily loss: how much the account may lose within one trading day.
 *  - `basis`: BALANCE counts closed results only; EQUITY also counts floating P&L.
 *  - `reference`: what the limit is measured from —
 *      INITIAL_BALANCE: a fixed amount (limit% × phase starting balance) below the day's start value;
 *      DAY_START_BALANCE: limit% × the balance at the daily reset;
 *      DAY_START_HIGHER: limit% × max(balance, equity) at the daily reset.
 */
export const dailyLossSchema = z.object({
  limitPercent: percent,
  basis: z.enum(["BALANCE", "EQUITY"]).default("EQUITY"),
  reference: z.enum(["INITIAL_BALANCE", "DAY_START_BALANCE", "DAY_START_HIGHER"]).default("INITIAL_BALANCE"),
});

/**
 * Maximum loss / drawdown floor.
 *  - STATIC: floor = start − limit% × start; never moves.
 *  - EOD_TRAILING: floor = (highest END-OF-DAY value) − limit amount; updated only at the daily reset.
 *  - INTRADAY_TRAILING: floor = (highest value seen at any minute) − limit amount; updated continuously.
 *  `basis` says which value is tracked (BALANCE or EQUITY). With
 *  `trailingLockAtStart`, a trailing floor stops rising once it reaches the
 *  starting balance (a common futures-firm rule).
 */
export const maxLossSchema = z.object({
  limitPercent: percent,
  model: z.enum(["STATIC", "EOD_TRAILING", "INTRADAY_TRAILING"]).default("STATIC"),
  basis: z.enum(["BALANCE", "EQUITY"]).default("EQUITY"),
  trailingLockAtStart: z.boolean().default(false),
});

export const objectiveSchema = z.object({
  /** Profit target as % of the phase starting balance; null = no target (funded / lab). */
  profitTargetPercent: percent.nullable().default(null),
  /** Distinct trading days (a day with at least one opened position) required before passing. */
  minTradingDays: z.number().int().min(0).max(3650).nullable().default(null),
  /** Calendar days (broker clock) the phase may last; null = unlimited. */
  maxCalendarDays: z.number().int().min(1).max(3650).nullable().default(null),
  /** Best single day's profit may be at most this % of total profit (checked when passing). */
  consistencyMaxDayPercent: percent.nullable().default(null),
});

export const limitsSchema = z.object({
  maxQuantityPerPosition: z.number().gt(0).max(1e6).nullable().default(null),
  maxOpenPositions: z.number().int().min(1).max(1000).nullable().default(null),
  /** Maximum risk at the stop per new position, % of current balance. Requires a stop when set. */
  maxRiskPercentPerTrade: percent.nullable().default(null),
});

export const holdingSchema = z.object({
  allowWeekend: z.boolean().default(true),
  allowOvernight: z.boolean().default(true),
});

/** Funded-phase payout terms (Phase 5). Unused by evaluation and lab accounts. */
export const payoutTermsSchema = z.object({
  profitSplitPercent: percent,
  /** Calendar days from funding before the first payout can be requested. */
  firstPayoutAfterDays: z.number().int().min(0).max(3650).default(14),
  /** Calendar days between payout cycles. */
  cycleDays: z.number().int().min(1).max(3650).default(14),
  minPayoutAmount: nonNegative.default(0),
  maxPayoutAmount: nonNegative.nullable().default(null),
  /** Profit (as % of the starting balance) that must stay in the account and can't be withdrawn. */
  profitBufferPercent: z.number().min(0).max(100).default(0),
  /** Trading days required inside each cycle. */
  minTradingDaysPerCycle: z.number().int().min(0).max(3650).default(0),
});

export const simRulesSchema = z.object({
  schemaVersion: z.literal(RULES_SCHEMA_VERSION).default(RULES_SCHEMA_VERSION),
  /** Broker-clock hour (0–23) at which the trading day rolls over. */
  dailyResetHour: z.number().int().min(0).max(23).default(0),
  costs: costsSchema.prefault({}),
  objective: objectiveSchema.prefault({}),
  dailyLoss: dailyLossSchema.nullable().default(null),
  maxLoss: maxLossSchema.nullable().default(null),
  limits: limitsSchema.prefault({}),
  holding: holdingSchema.prefault({}),
  /** Upper-case symbols the account may trade; null = any of the account's assets. */
  allowedSymbols: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(100).nullable().default(null),
  /** Stored for the record. NOT enforced: there is no economic-calendar data (decision D9). */
  newsTradingRestricted: z.boolean().default(false),
  payout: payoutTermsSchema.nullable().default(null),
});

export type SimRules = z.infer<typeof simRulesSchema>;
export type SimRulesInput = z.input<typeof simRulesSchema>;

/** The rule set of a Strategy Lab account: costs only, no objective or limits. */
export function labRules(input: Pick<SimRulesInput, "costs" | "dailyResetHour"> = {}): SimRules {
  return simRulesSchema.parse({ costs: input.costs, dailyResetHour: input.dailyResetHour });
}

/** Parses a stored snapshot. Throws on anything that isn't a valid v1 rule set. */
export function parseRules(json: unknown): SimRules {
  return simRulesSchema.parse(json);
}
