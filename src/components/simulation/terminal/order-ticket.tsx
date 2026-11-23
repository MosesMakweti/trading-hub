"use client";

import { useState } from "react";
import { Link2, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { placeSimOrderAction } from "@/actions/simulation.actions";
import { draftFromDrawing, riskPreview, LINK_LABEL, type LinkStatus } from "@/domain/charting/order-sync";
import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import type { SimAccountStateDTO, SimQuoteDTO } from "@/types/simulation";

type OrderType = "MARKET" | "LIMIT" | "STOP";
type SizingMode = "QUANTITY" | "RISK_PERCENT" | "RISK_AMOUNT";

const SIZING_LABEL: Record<SizingMode, string> = { QUANTITY: "Lots", RISK_PERCENT: "Risk %", RISK_AMOUNT: "Risk $" };

export interface TicketLink {
  /** The long/short drawing drafting this ticket. */
  drawing: ChartDrawing;
  status: LinkStatus;
  /** Ticket edits → drawing (entry for pending orders, stop, first target). */
  onEdit: (edit: { price?: number | null; stopLoss?: number | null; takeProfit?: number | null }) => void;
  onUnlink: () => void;
}

export interface InstrumentEconomics {
  /** Quote-currency value of a 1.0 price move for quantity 1. */
  pointValue: number;
  currency: string;
  quantityStep?: number;
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const sameNum = (text: string, v: number | null) => (v == null ? text.trim() === "" : Number(text) === v);

/**
 * The order ticket. It sends an intention — side, type, levels and how to
 * size — and the server fills it at the account's replay time. Nothing typed
 * here is trusted as a price the order fills at.
 *
 * With a linked position drawing, the drawing drafts the ticket and ticket
 * edits move the drawing; placing it still needs an explicit confirmation,
 * and the server validates it exactly like a typed order.
 */
export function OrderTicket({
  state,
  quote,
  disabled,
  onPlaced,
  link,
  economics,
  confirmAll = false,
}: {
  state: SimAccountStateDTO;
  quote: SimQuoteDTO | undefined;
  disabled: boolean;
  onPlaced: (next: SimAccountStateDTO, linkedDrawing: ChartDrawing | null) => void;
  link?: TicketLink | null;
  economics?: InstrumentEconomics | null;
  confirmAll?: boolean;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [price, setPrice] = useState("");
  const [sizing, setSizing] = useState<SizingMode>("RISK_PERCENT");
  const [size, setSize] = useState("1");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const symbol = quote?.symbol ?? state.assets[0];
  const needsStop = sizing !== "QUANTITY";
  const bid = quote?.bid != null ? Number(quote.bid) : null;
  const ask = quote?.ask != null ? Number(quote.ask) : null;

  // ── Drawing → ticket. Adjusted during render (no effect loop): only fields
  // whose VALUE differs are overwritten, so what the trader is typing stays.
  const pos = link?.drawing.data.position;
  const linkKey = link && pos ? `${link.drawing.id}|${pos.entry}|${pos.stop}|${pos.targets[0]}` : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  const [syncedId, setSyncedId] = useState<string | null>(null);
  if (linkKey !== syncedKey) {
    setSyncedKey(linkKey);
    if (link && pos) {
      const draft = draftFromDrawing(link.drawing, bid != null && ask != null ? { bid, ask } : null);
      if (draft) {
        setSide(draft.side);
        // Re-derive the order type when the drawing changes identity or entry; keep an explicit Market choice otherwise.
        const entryMoved = !sameNum(price, pos.entry);
        if (link.drawing.id !== syncedId || (entryMoved && type !== "MARKET")) setType(draft.type);
        if (!sameNum(price, pos.entry)) setPrice(String(pos.entry));
        if (!sameNum(stopLoss, draft.stopLoss)) setStopLoss(String(draft.stopLoss));
        if (!sameNum(takeProfit, draft.takeProfit)) setTakeProfit(draft.takeProfit == null ? "" : String(draft.takeProfit));
      }
      setSyncedId(link.drawing.id);
    } else setSyncedId(null);
  }
  const linked = !!(link && pos);

  const editLevel = (field: "price" | "stopLoss" | "takeProfit", text: string) => {
    (field === "price" ? setPrice : field === "stopLoss" ? setStopLoss : setTakeProfit)(text);
    if (!linked) return;
    const v = num(text);
    if (v != null && Number.isFinite(v) && v > 0) link!.onEdit({ [field]: v });
  };

  // ── Risk preview (estimate; the server sizes the real order) ──
  const entry = type === "MARKET" ? (side === "BUY" ? ask : bid) : num(price);
  const sl = num(stopLoss);
  const tp = num(takeProfit);
  const n = Number(size);
  const preview =
    entry != null && sl != null && Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(n) && n > 0
      ? riskPreview({
          side,
          entry,
          stop: sl,
          targets: linked && pos ? [tp ?? pos.targets[0], ...pos.targets.slice(1)] : tp != null ? [tp] : [],
          valuePerPrice: economics?.pointValue ?? null,
          balance: Number(state.money.balance),
          sizing: sizing === "QUANTITY" ? { mode: "QUANTITY", quantity: n } : sizing === "RISK_PERCENT" ? { mode: "RISK_PERCENT", riskPercent: n } : { mode: "RISK_AMOUNT", amount: n },
          step: economics?.quantityStep,
        })
      : null;
  const ccy = economics?.currency ?? state.currency;
  const convertNote = economics && economics.currency !== state.currency ? ` (in ${economics.currency}; the server converts to ${state.currency})` : "";

  async function place() {
    if (!symbol) return;
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
      drawingId: linked ? link!.drawing.id : null,
    });
    setBusy(false);
    setConfirming(false);
    if (!res.success) return toast.error(res.error);
    onPlaced(res.state, res.drawing);
    if (res.warning) toast.warning(res.warning);
    toast.success(res.outcome.status === "FILLED" ? `${side === "BUY" ? "Bought" : "Sold"} ${symbol}` : `${type === "LIMIT" ? "Limit" : "Stop"} order placed`);
    if (type !== "MARKET" && !linked) setPrice("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return void toast.error("Enter a size greater than zero.");
    // A drafted order is never placed by the drawing itself: always confirm it.
    if (linked || confirmAll) return setConfirming(true);
    void place();
  }

  const sideLabel = side === "BUY" ? "Buy" : "Sell";
  const typeLabel = type === "MARKET" ? "market" : type === "LIMIT" ? "limit" : "stop";

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Order ticket">
      {linked && (
        <div className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-200" role="status">
          <Link2 className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Drafted from the {link!.drawing.type === "LONG" ? "long" : "short"} position drawing · <span className="font-medium">{LINK_LABEL[link!.status]}</span>
            {link!.drawing.locked && <span className="block text-sky-300/70">Locked drawing — ticket edits won&apos;t move it.</span>}
          </span>
          <button type="button" onClick={link!.onUnlink} className="rounded p-0.5 hover:bg-white/10" aria-label="Unlink drawing from the ticket" title="Unlink">
            <Link2Off className="size-3.5" />
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(["SELL", "BUY"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            disabled={linked && side !== s}
            title={linked && side !== s ? "The linked drawing sets the direction" : undefined}
            onClick={() => setSide(s)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50",
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
          <Input id="sim-price" inputMode="decimal" value={price} onChange={(e) => editLevel("price", e.target.value)} placeholder={quote?.bid ?? ""} className="h-8 font-mono tabular-nums" required />
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
          <Input id="sim-sl" inputMode="decimal" value={stopLoss} onChange={(e) => editLevel("stopLoss", e.target.value)} className="h-8 font-mono tabular-nums" required={needsStop} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sim-tp" className="text-xs">Take profit{linked && pos && pos.targets.length > 1 ? " (TP1)" : " (optional)"}</Label>
          <Input id="sim-tp" inputMode="decimal" value={takeProfit} onChange={(e) => editLevel("takeProfit", e.target.value)} className="h-8 font-mono tabular-nums" />
        </div>
      </div>

      {preview && (
        <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px]" aria-label="Risk preview">
          {preview.issues.length ? (
            <p className="text-amber-500">{preview.issues[0]}</p>
          ) : (
            <p className="tabular-nums">
              Est. size <span className="font-mono font-medium">{preview.quantity.toFixed(2)}</span> · risk <span className="font-mono font-medium text-red-400">{preview.riskAmount.toFixed(2)} {ccy}</span>
              {preview.rr.length > 0 && <> · R:R {preview.rr.map((r) => `1:${r}`).join(" / ")}</>}
            </p>
          )}
          <p className="text-muted-foreground">Estimate from the contract spec{convertNote}. The server sizes and checks the order when it&apos;s placed.</p>
        </div>
      )}

      <Button type="submit" className={cn("w-full", side === "BUY" ? "bg-emerald-600 text-white hover:bg-emerald-600/90" : "bg-red-500 text-white hover:bg-red-500/90")} disabled={disabled || busy || !quote?.bid}>
        {busy && <Loader2 className="animate-spin" />}
        {type === "MARKET" ? `${sideLabel} ${symbol} at market` : `Place ${sideLabel.toLowerCase()} ${typeLabel}`}
        {linked && "…"}
      </Button>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Place this order?</DialogTitle>
            <DialogDescription>{linked ? "Drafted from your position drawing. Check the levels — the drawing doesn't trade on its own." : "Check the order before it's sent."}</DialogDescription>
          </DialogHeader>
          {linked && link!.drawing.data.orderRef && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-400">This drawing already placed an order ({LINK_LABEL[link!.status].toLowerCase()}). Confirming places another one; the drawing will point to the new order.</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Order</dt>
            <dd className={cn("font-medium", side === "BUY" ? "text-emerald-500" : "text-red-400")}>{sideLabel} {symbol} {typeLabel}</dd>
            {type !== "MARKET" && (
              <>
                <dt className="text-muted-foreground">Price</dt>
                <dd className="font-mono">{price}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Stop loss</dt>
            <dd className="font-mono">{stopLoss || "—"}</dd>
            <dt className="text-muted-foreground">Take profit</dt>
            <dd className="font-mono">{takeProfit || "—"}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-mono">
              {sizing === "QUANTITY" ? `${size} lots` : sizing === "RISK_PERCENT" ? `${size}% risk` : `${size} ${state.currency} risk`}
              {preview && !preview.issues.length && sizing !== "QUANTITY" && <span className="text-muted-foreground"> ≈ {preview.quantity.toFixed(2)} lots</span>}
            </dd>
          </dl>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={() => void place()} disabled={busy || disabled}>
              {busy && <Loader2 className="animate-spin" />}Confirm order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
