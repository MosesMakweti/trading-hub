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
