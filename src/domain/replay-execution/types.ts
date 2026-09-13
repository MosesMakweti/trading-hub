/**
 * Replay simulated execution (Stage 14 §11-26) — pure types shared by the
 * execution engine (engine.ts) and its callers. Nothing here touches Prisma;
 * the service layer maps this state to/from ReplayTrade + ReplayTradePartialExit
 * + ReplayTradeExecutionEvent rows.
 */
import type { Candle } from "@/domain/market-data/candle";

export type ReplayOrderType = "MARKET" | "PENDING";

/** Naming deliberately distinct from Trade's own lifecycle (Stage 7/8) per
 *  Stage 14 §14 — Replay's lifecycle is a simulated ORDER/POSITION state
 *  machine, not the real Trade's day-based review lifecycle. */
export type ReplayTradeLifecycle = "PLANNED" | "PENDING" | "OPEN" | "PARTIALLY_CLOSED" | "CLOSED" | "CANCELLED";

export type ReplayCloseReason = "STOP_LOSS" | "TARGET" | "MANUAL" | null;

export type ReplayExecutionEventType =
  | "ORDER_PLACED"
  | "ORDER_FILLED"
  | "SL_MOVED"
  | "PARTIAL_CLOSE"
  | "FULL_CLOSE"
  | "ORDER_CANCELLED"
  | "AMBIGUOUS_CANDLE"
  | "AMBIGUITY_RESOLVED";

export interface ReplayPlannedTargetState {
  id: string;
  order: number;
  price: number;
  /** 0-100. */
  percentToClose: number;
  /** null = not yet hit. */
  filledAt: number | null;
}

/** Set only while a single base candle touched BOTH the stop and an unfilled
 *  target and the base data itself cannot say which happened first (§12) —
 *  processing halts here until the trader manually resolves it. Never
 *  auto-resolved toward the profitable outcome. */
export interface PendingAmbiguity {
  candleTimestamp: number;
  candle: Candle;
  slPrice: number;
  hitTargetIds: string[];
}

export interface ReplayPositionState {
  direction: "LONG" | "SHORT";
  orderType: ReplayOrderType;
  lifecycle: ReplayTradeLifecycle;
  /** MARKET: the market price at placement. PENDING: the trader's trigger price. */
  plannedEntry: number;
  /** Frozen forever at order placement — defines 1R. Moving the stop later
   *  (see moveStopLoss) never changes this (§21). */
  initialStopLoss: number;
  /** The LIVE stop — what actually triggers a stop-out. */
  currentStopLoss: number;
  targets: ReplayPlannedTargetState[];
  filledEntry: number | null;
  filledAt: number | null;
  /** 0-100, starts 100 once filled, decreases with partial closes. */
  remainingPercent: number;
  /** Weighted sum of realized R across every closed portion so far (§17/§22). */
  realizedR: number;
  closedAt: number | null;
  closeReason: ReplayCloseReason;
  /** Watermark — candles at or before this instant have already been
   *  processed; re-processing them is always a safe no-op (§26). */
  lastProcessedTime: number;
  pendingAmbiguity: PendingAmbiguity | null;
}

export interface ExecutionEvent {
  type: ReplayExecutionEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ProcessResult {
  state: ReplayPositionState;
  events: ExecutionEvent[];
}

export type ReplayOutcomeClass = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
