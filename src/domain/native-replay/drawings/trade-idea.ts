/**
 * Native Replay → Backtesting: what a Long/Short Position drawing contributes
 * to the EXISTING Trade Idea form (the same form and actions the Session uses
 * — no second trade-planning domain).
 *
 * Nothing is created from this alone: it only pre-fills the form, the trader
 * reviews and saves, and the existing createTrade + confirmPlan (savePlan)
 * path does the rest. Context comes from the authoritative replay state:
 * the execution time is the run's world time (never a future anchor time),
 * the date is the simulation date, the asset is the drawing's asset.
 */
import type { ReplayTimeframe } from "../timeframes";
import { partsOf } from "../wall-clock";
import type { ChartDrawing } from "./model";

export interface TradeIdeaPrefill {
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  /** The plan's own timeframe vocabulary ("15m", "1h", "1D"). */
  timeframe: string;
  entry: string;
  stopLoss: string;
  targets: { targetOrder: number; label: string; targetPrice: string }[];
  /** Minutes after midnight on the simulation date — the world time. */
  executionMinutes: number;
}

const PLAN_TIMEFRAME: Record<ReplayTimeframe, string> = {
  M1: "1m", M2: "2m", M3: "3m", M5: "5m", M10: "10m", M15: "15m", M30: "30m",
  H1: "1h", H2: "2h", H4: "4h", H6: "6h", H8: "8h", H12: "12h",
  D1: "1D", W1: "1W", MN1: "1M",
};

export function positionToTradeIdea(
  drawing: ChartDrawing,
  context: { timeframe: ReplayTimeframe; worldMinute: number; priceScale: number },
): TradeIdeaPrefill | null {
  if ((drawing.type !== "LONG" && drawing.type !== "SHORT") || !drawing.data.position) return null;
  const p = drawing.data.position;
  const fmt = (x: number) => x.toFixed(context.priceScale);
  const world = partsOf(context.worldMinute);
  return {
    assetSymbol: drawing.assetSymbol,
    direction: drawing.type,
    timeframe: PLAN_TIMEFRAME[context.timeframe],
    entry: fmt(p.entry),
    stopLoss: fmt(p.stop),
    targets: p.targets.map((t, i) => ({ targetOrder: i + 1, label: `TP${i + 1}`, targetPrice: fmt(t) })),
    executionMinutes: world.hour * 60 + world.minute,
  };
}
