"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { placeSimOrderAction } from "@/actions/simulation.actions";
import type { SimAccountStateDTO, SimQuoteDTO } from "@/types/simulation";

type OrderType = "MARKET" | "LIMIT" | "STOP";
type SizingMode = "QUANTITY" | "RISK_PERCENT" | "RISK_AMOUNT";

const SIZING_LABEL: Record<SizingMode, string> = { QUANTITY: "Lots", RISK_PERCENT: "Risk %", RISK_AMOUNT: "Risk $" };

/**
 * The order ticket. It sends an intention — side, type, levels and how to
 * size — and the server fills it at the account's replay time. Nothing typed
 * here is trusted as a price the order fills at.
 */
export function OrderTicket({
  state,
  quote,
  disabled,
  onPlaced,
}: {
  state: SimAccountStateDTO;
  quote: SimQuoteDTO | undefined;
  disabled: boolean;
  onPlaced: (next: SimAccountStateDTO) => void;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [price, setPrice] = useState("");
  const [sizing, setSizing] = useState<SizingMode>("RISK_PERCENT");
  const [size, setSize] = useState("1");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [busy, setBusy] = useState(false);

  const symbol = quote?.symbol ?? state.assets[0];
  const needsStop = sizing !== "QUANTITY";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol) return;
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a size greater than zero.");
    setBusy(true);
    const res = await placeSimOrderAction({
      accountId: state.id,
      symbol,
      side,
      type,
      price: type === "MARKET" ? null : price,
      stopLoss: stopLoss || null,
      takeProfit: takeProfit || null,
      sizing: sizing === "QUANTITY" ? { mode: "QUANTITY", quantity: size } : sizing === "RISK_PERCENT" ? { mode: "RISK_PERCENT", riskPercent: n } : { mode: "RISK_AMOUNT", amount: n },
      clientRequestId: crypto.randomUUID(),
    });
    setBusy(false);
    if (!res.success) return toast.error(res.error);
    onPlaced(res.state);
    toast.success(res.outcome.status === "FILLED" ? `${side === "BUY" ? "Bought" : "Sold"} ${symbol}` : `${type === "LIMIT" ? "Limit" : "Stop"} order placed`);
    if (type !== "MARKET") setPrice("");
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Order ticket">
      <div className="grid grid-cols-2 gap-2">
        {(["SELL", "BUY"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left transition-colors",
              side === s
                ? s === "BUY"
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : "border-red-400/60 bg-red-400/10"
                : "border-border hover:bg-muted/50",
            )}
          >
            <span className={cn("block text-xs font-medium", s === "BUY" ? "text-emerald-500" : "text-red-400")}>{s === "BUY" ? "Buy" : "Sell"}</span>
            <span className="block font-mono text-sm tabular-nums">{(s === "BUY" ? quote?.ask : quote?.bid) ?? "—"}</span>
          </button>
        ))}
      </div>

      <div role="group" aria-label="Order type" className="grid grid-cols-3 rounded-md border border-border p-0.5">
        {(["MARKET", "LIMIT", "STOP"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={cn("rounded-[5px] py-1 text-xs", type === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
            {t === "MARKET" ? "Market" : t === "LIMIT" ? "Limit" : "Stop"}
          </button>
        ))}
      </div>

      {type !== "MARKET" && (
        <div className="space-y-1">
          <Label htmlFor="sim-price" className="text-xs">{type === "LIMIT" ? "Limit" : "Stop"} price</Label>
          <Input id="sim-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={quote?.bid ?? ""} className="h-8 font-mono tabular-nums" required />
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="sim-size" className="text-xs">Size</Label>
          <div role="group" aria-label="Size by" className="flex rounded-md border border-border">
            {(Object.keys(SIZING_LABEL) as SizingMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={sizing === m} onClick={() => setSizing(m)} className={cn("px-1.5 py-0.5 text-[11px] first:rounded-l-md last:rounded-r-md", sizing === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {SIZING_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <Input id="sim-size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} className="h-8 font-mono tabular-nums" required />
        {needsStop && <p className="text-[11px] text-muted-foreground">Sized from the stop loss and the account balance ({state.currency}).</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="sim-sl" className="text-xs">Stop loss{needsStop ? "" : " (optional)"}</Label>
          <Input id="sim-sl" inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="h-8 font-mono tabular-nums" required={needsStop} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sim-tp" className="text-xs">Take profit (optional)</Label>
          <Input id="sim-tp" inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className="h-8 font-mono tabular-nums" />
        </div>
      </div>

      <Button type="submit" className={cn("w-full", side === "BUY" ? "bg-emerald-600 text-white hover:bg-emerald-600/90" : "bg-red-500 text-white hover:bg-red-500/90")} disabled={disabled || busy || !quote?.bid}>
        {busy && <Loader2 className="animate-spin" />}
        {type === "MARKET" ? `${side === "BUY" ? "Buy" : "Sell"} ${symbol} at market` : `Place ${side === "BUY" ? "buy" : "sell"} ${type === "LIMIT" ? "limit" : "stop"}`}
      </Button>
    </form>
  );
}
