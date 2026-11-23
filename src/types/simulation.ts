/** Simulation Platform DTOs (server → client). Money as decimal strings, times as broker wall-clock "YYYY-MM-DDTHH:mm". */

export type SimProductValue = "STRATEGY_LAB" | "PROP_FIRM";
export type SimAccountKindValue = "LAB" | "EVALUATION" | "FUNDED";
export type SimAccountStatusValue = "CREATED" | "ACTIVE" | "PASSED" | "FAILED" | "BREACHED" | "COMPLETED" | "SUSPENDED" | "ARCHIVED";
export type SimSideValue = "BUY" | "SELL";

export interface SimPositionDTO {
  id: string;
  symbol: string;
  side: SimSideValue;
  quantity: string;
  remainingQuantity: string;
  entryPrice: string;
  markPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  unrealizedPnl: string;
  realizedPnl: string;
  unrealizedR: string | null;
  openedAt: string;
  priceScale: number;
}

export interface SimOrderDTO {
  id: string;
  symbol: string;
  side: SimSideValue;
  type: "MARKET" | "LIMIT" | "STOP";
  price: string | null;
  quantity: string;
  stopLoss: string | null;
  takeProfit: string | null;
  placedAt: string;
  expiresAt: string | null;
}

export interface SimClosedPositionDTO {
  id: string;
  symbol: string;
  side: SimSideValue;
  quantity: string;
  entryPrice: string;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  grossPnl: string;
  netPnl: string;
  r: string | null;
  ambiguousExit: boolean;
}

export interface SimQuoteDTO {
  symbol: string;
  priceScale: number;
  bid: string | null;
  ask: string | null;
  barTime: string | null;
}

export interface SimAccountStateDTO {
  id: string;
  name: string;
  product: SimProductValue;
  kind: SimAccountKindValue;
  status: SimAccountStatusValue;
  statusReason: string | null;
  currency: string;
  assets: string[];
  period: { start: string; end: string };
  clock: { minute: number; time: string; version: number; atPeriodEnd: boolean } | null;
  money: {
    startingBalance: string;
    balance: string;
    equity: string;
    floatingPnl: string;
    realizedPnl: string;
    commissions: string;
    swaps: string;
    withdrawals: string;
  };
  quotes: SimQuoteDTO[];
  positions: SimPositionDTO[];
  orders: SimOrderDTO[];
  history: SimClosedPositionDTO[];
}

export interface SimAccountSummaryDTO {
  id: string;
  name: string;
  product: SimProductValue;
  kind: SimAccountKindValue;
  status: SimAccountStatusValue;
  currency: string;
  assets: string[];
  period: { start: string; end: string };
  clockTime: string | null;
  /** How far the clock is through the period (0–100). */
  progressPercent: number;
  startingBalance: string;
  balance: string;
  netResult: string;
  openPositions: number;
  closedTrades: number;
  updatedAt: string;
  /** Archived from the session library (or the older ARCHIVED status). */
  archived: boolean;
}

/**
 * What a replay step that changed no trading state sends back instead of the
 * whole account: positions, orders, history and ledger totals are unchanged,
 * so only the clock, marks and money that depends on marks are included.
 */
export interface SimStepPatchDTO {
  clock: NonNullable<SimAccountStateDTO["clock"]>;
  status: SimAccountStatusValue;
  statusReason: string | null;
  quotes: SimQuoteDTO[];
  positions: SimPositionDTO[];
  money: Pick<SimAccountStateDTO["money"], "balance" | "equity" | "floatingPnl">;
}

/** Newly revealed M1 bars of one instrument (decimal prices), for the charts to fold in. */
export interface SimRevealedDTO {
  symbol: string;
  priceScale: number;
  /** null = too many to send; the chart reloads its window instead. */
  bars: { minute: number; open: number; high: number; low: number; close: number; tickVolume: number | null; realVolume: number | null; spread: number | null; barCount: number; state: "COMPLETED" }[] | null;
}

/** Merges a step patch into the full state the terminal holds. */
export function applyStepPatch(state: SimAccountStateDTO, patch: SimStepPatchDTO): SimAccountStateDTO {
  return { ...state, clock: patch.clock, status: patch.status, statusReason: patch.statusReason, quotes: patch.quotes, positions: patch.positions, money: { ...state.money, ...patch.money } };
}
