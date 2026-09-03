/**
 * Metadata for every rule template (spec section 5) — drives the rule
 * builder's context-sensitive inputs and market filtering ("Do not force
 * irrelevant CFD rules onto futures accounts or vice versa"). Pure data, no
 * framework/Prisma imports.
 */
export type RuleKeyLike =
  | "PROFIT_TARGET"
  | "MAX_DAILY_LOSS"
  | "MAX_TOTAL_LOSS"
  | "STATIC_DRAWDOWN"
  | "INTRADAY_TRAILING_DRAWDOWN"
  | "EOD_TRAILING_DRAWDOWN"
  | "DRAWDOWN_BALANCE_BASED"
  | "DRAWDOWN_EQUITY_BASED"
  | "MIN_TRADING_DAYS"
  | "MAX_TRADING_DAYS"
  | "CONSISTENCY_RULE"
  | "MAX_RISK_PER_TRADE"
  | "MAX_RISK_PER_DAY"
  | "MAX_OPEN_POSITIONS"
  | "MAX_LOT_SIZE"
  | "MAX_CONTRACT_SIZE"
  | "NEWS_TRADING_RESTRICTION"
  | "WEEKEND_HOLDING_RESTRICTION"
  | "OVERNIGHT_HOLDING_RESTRICTION"
  | "COPY_TRADING_RESTRICTION"
  | "EA_BOT_RESTRICTION"
  | "INACTIVITY_LIMIT"
  | "PAYOUT_WAITING_PERIOD"
  | "PROFIT_SPLIT"
  | "SCALING_REQUIREMENT"
  | "CUSTOM";

export type MarketCategoryLike = "CFD" | "FUTURES";
export type RuleValueTypeLike = "NUMERIC" | "MONETARY" | "PERCENTAGE" | "BOOLEAN" | "TEXT";
export type RuleInputKind = "percent" | "currency" | "integer" | "toggle" | "text";

export interface RuleTemplate {
  key: RuleKeyLike;
  label: string;
  description: string;
  defaultValueType: RuleValueTypeLike;
  inputKind: RuleInputKind;
  /** Both markets unless explicitly restricted. */
  markets: MarketCategoryLike[];
  /** Offered as a "measurement basis" selector when set (e.g. Balance/Equity). */
  basisOptions?: string[];
  /** Offered as a "measurement period" selector when set. */
  periodOptions?: string[];
}

const BOTH: MarketCategoryLike[] = ["CFD", "FUTURES"];
const BALANCE_EQUITY = ["Balance", "Equity"];
const PERIODS = ["Daily", "Weekly", "Per Trade", "Account Lifetime"];

export const RULE_TEMPLATES: RuleTemplate[] = [
  { key: "PROFIT_TARGET", label: "Profit target", description: "The profit required to pass this stage.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "MAX_DAILY_LOSS", label: "Maximum daily loss", description: "Largest loss allowed in a single day before breach.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "MAX_TOTAL_LOSS", label: "Maximum total loss", description: "Largest cumulative loss allowed for the account.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "STATIC_DRAWDOWN", label: "Static drawdown", description: "A fixed drawdown floor that never moves.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "INTRADAY_TRAILING_DRAWDOWN", label: "Intraday trailing drawdown", description: "Drawdown floor that trails the account's peak intraday.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "EOD_TRAILING_DRAWDOWN", label: "End-of-day trailing drawdown", description: "Drawdown floor that trails the account's peak end-of-day balance.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, basisOptions: BALANCE_EQUITY },
  { key: "DRAWDOWN_BALANCE_BASED", label: "Drawdown (balance-based)", description: "Drawdown is measured against closed-trade balance only.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH },
  { key: "DRAWDOWN_EQUITY_BASED", label: "Drawdown (equity-based)", description: "Drawdown is measured against floating equity, including open trades.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH },
  { key: "MIN_TRADING_DAYS", label: "Minimum trading days", description: "Fewest active trading days required before passing.", defaultValueType: "NUMERIC", inputKind: "integer", markets: BOTH },
  { key: "MAX_TRADING_DAYS", label: "Maximum trading days", description: "Deadline, in trading days, to complete this stage.", defaultValueType: "NUMERIC", inputKind: "integer", markets: BOTH },
  { key: "CONSISTENCY_RULE", label: "Consistency rule", description: "No single day may account for more than this share of total profit.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH },
  { key: "MAX_RISK_PER_TRADE", label: "Maximum risk per trade", description: "Largest risk allowed on a single position.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH },
  { key: "MAX_RISK_PER_DAY", label: "Maximum risk per day", description: "Largest combined risk allowed open at once in a day.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH, periodOptions: PERIODS },
  { key: "MAX_OPEN_POSITIONS", label: "Maximum open positions", description: "Most positions allowed open at the same time.", defaultValueType: "NUMERIC", inputKind: "integer", markets: BOTH },
  { key: "MAX_LOT_SIZE", label: "Maximum lot size", description: "Largest position size, in lots, per trade.", defaultValueType: "NUMERIC", inputKind: "integer", markets: ["CFD"] },
  { key: "MAX_CONTRACT_SIZE", label: "Maximum contract size", description: "Largest position size, in contracts, per trade.", defaultValueType: "NUMERIC", inputKind: "integer", markets: ["FUTURES"] },
  { key: "NEWS_TRADING_RESTRICTION", label: "News-trading restriction", description: "Trading around high-impact news is limited or banned.", defaultValueType: "BOOLEAN", inputKind: "toggle", markets: BOTH },
  { key: "WEEKEND_HOLDING_RESTRICTION", label: "Weekend holding restriction", description: "Positions may not be held over the weekend.", defaultValueType: "BOOLEAN", inputKind: "toggle", markets: BOTH },
  { key: "OVERNIGHT_HOLDING_RESTRICTION", label: "Overnight holding restriction", description: "Positions may not be held overnight.", defaultValueType: "BOOLEAN", inputKind: "toggle", markets: BOTH },
  { key: "COPY_TRADING_RESTRICTION", label: "Copy-trading restriction", description: "Copy-trading or signal-following is limited or banned.", defaultValueType: "BOOLEAN", inputKind: "toggle", markets: BOTH },
  { key: "EA_BOT_RESTRICTION", label: "EA / bot restriction", description: "Automated trading (EAs/bots) is limited or banned.", defaultValueType: "BOOLEAN", inputKind: "toggle", markets: BOTH },
  { key: "INACTIVITY_LIMIT", label: "Inactivity limit", description: "Maximum days without a trade before the account is affected.", defaultValueType: "NUMERIC", inputKind: "integer", markets: BOTH },
  { key: "PAYOUT_WAITING_PERIOD", label: "Payout waiting period", description: "Minimum days after funding before the first payout can be requested.", defaultValueType: "NUMERIC", inputKind: "integer", markets: BOTH },
  { key: "PROFIT_SPLIT", label: "Profit split", description: "The trader's share of profit on payouts.", defaultValueType: "PERCENTAGE", inputKind: "percent", markets: BOTH },
  { key: "SCALING_REQUIREMENT", label: "Scaling requirement", description: "Conditions required to scale the account up.", defaultValueType: "TEXT", inputKind: "text", markets: BOTH },
  { key: "CUSTOM", label: "Custom rule", description: "Anything not covered by a template above.", defaultValueType: "TEXT", inputKind: "text", markets: BOTH },
];

export const RULE_TEMPLATE_BY_KEY: Record<RuleKeyLike, RuleTemplate> = Object.fromEntries(
  RULE_TEMPLATES.map((t) => [t.key, t]),
) as Record<RuleKeyLike, RuleTemplate>;

export function ruleTemplatesForMarket(market: MarketCategoryLike): RuleTemplate[] {
  return RULE_TEMPLATES.filter((t) => t.markets.includes(market));
}
