"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cancelSimOrderAction, closeSimPositionAction, modifySimPositionAction } from "@/actions/simulation.actions";
import type { SimAccountStateDTO, SimPositionDTO } from "@/types/simulation";
import { CLOSE_REASON_LABEL, fmtMoney, fmtR, fmtWallClock, pnlTone } from "../format";

type Tab = "positions" | "orders" | "history";

const th = "px-3 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground";
const td = "px-3 py-1.5 font-mono text-xs tabular-nums whitespace-nowrap";

/** Bottom panel: open positions, pending orders and trade history. */
export function TradeDock({ state, readOnly, onState }: { state: SimAccountStateDTO; readOnly: boolean; onState: (s: SimAccountStateDTO) => void }) {
  const [tab, setTab] = useState<Tab>("positions");
  const counts = { positions: state.positions.length, orders: state.orders.length, history: state.history.length };

  return (
    <section aria-label="Positions, orders and history" className="flex h-full min-h-0 flex-col">
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-border px-2">
        {(["positions", "orders", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("-mb-px border-b-2 px-2.5 py-1.5 text-xs capitalize", tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t} <span className="tabular-nums text-muted-foreground">{counts[t]}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" && <Positions state={state} readOnly={readOnly} onState={onState} />}
        {tab === "orders" && <Orders state={state} readOnly={readOnly} onState={onState} />}
        {tab === "history" && <History state={state} />}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-xs text-muted-foreground">{children}</p>;
}

function Positions({ state, readOnly, onState }: { state: SimAccountStateDTO; readOnly: boolean; onState: (s: SimAccountStateDTO) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (state.positions.length === 0) return <Empty>No open positions. Use the order ticket to trade at the current replay time.</Empty>;

  const close = async (p: SimPositionDTO, percent: number | null) => {
    setBusy(p.id);
    const res = await closeSimPositionAction({ accountId: state.id, positionId: p.id, percent, commandId: crypto.randomUUID() });
    setBusy(null);
    if (!res.success) return toast.error(res.error);
    onState(res.state);
  };

  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={th}>Symbol</th><th className={th}>Side</th><th className={th}>Size</th><th className={th}>Entry</th>
          <th className={th}>Price</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>P&amp;L</th><th className={th}>R</th>
          <th className={th}>Opened</th><th className={cn(th, "text-right")}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {state.positions.map((p) =>
          editing === p.id ? (
            <EditRow key={p.id} position={p} accountId={state.id} onDone={(s) => { setEditing(null); if (s) onState(s); }} />
          ) : (
            <tr key={p.id} className="border-t border-border/60">
              <td className={cn(td, "font-sans font-medium")}>{p.symbol}</td>
              <td className={cn(td, p.side === "BUY" ? "text-emerald-500" : "text-red-400")}>{p.side === "BUY" ? "Buy" : "Sell"}</td>
              <td className={td}>{p.remainingQuantity}{p.remainingQuantity !== p.quantity && <span className="text-muted-foreground">/{p.quantity}</span>}</td>
              <td className={td}>{p.entryPrice}</td>
              <td className={td}>{p.markPrice ?? "—"}</td>
              <td className={td}>{p.stopLoss ?? "—"}</td>
              <td className={td}>{p.takeProfit ?? "—"}</td>
              <td className={cn(td, pnlTone(p.unrealizedPnl))}>{fmtMoney(p.unrealizedPnl, state.currency, { sign: true })}</td>
              <td className={cn(td, pnlTone(p.unrealizedR))}>{fmtR(p.unrealizedR)}</td>
              <td className={cn(td, "text-muted-foreground")}>{fmtWallClock(p.openedAt)}</td>
              <td className={cn(td, "text-right")}>
                {!readOnly && (
                  <div className="flex justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(p.id)} disabled={busy === p.id}>Edit</Button>
                    <Button size="xs" variant="ghost" onClick={() => void close(p, 50)} disabled={busy === p.id}>Close 50%</Button>
                    <Button size="xs" variant="outline" onClick={() => void close(p, null)} disabled={busy === p.id}>Close</Button>
                  </div>
                )}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function EditRow({ position, accountId, onDone }: { position: SimPositionDTO; accountId: string; onDone: (s: SimAccountStateDTO | null) => void }) {
  const [sl, setSl] = useState(position.stopLoss ?? "");
  const [tp, setTp] = useState(position.takeProfit ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await modifySimPositionAction({ accountId, positionId: position.id, stopLoss: sl || null, takeProfit: tp || null, commandId: crypto.randomUUID() });
    setBusy(false);
    if (!res.success) return toast.error(res.error);
    toast.success("Position updated");
    onDone(res.state);
  };
  return (
    <tr className="border-t border-border/60 bg-muted/30">
      <td colSpan={11} className="px-3 py-1.5">
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{position.symbol} {position.side === "BUY" ? "buy" : "sell"} {position.remainingQuantity}</span>
          <label className="flex items-center gap-1">SL <input aria-label="Stop loss" value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" className="h-7 w-24 rounded-md border border-border bg-background px-1.5 font-mono tabular-nums" /></label>
          <label className="flex items-center gap-1">TP <input aria-label="Take profit" value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" className="h-7 w-24 rounded-md border border-border bg-background px-1.5 font-mono tabular-nums" /></label>
          <Button size="xs" type="submit" disabled={busy}>Save</Button>
          <Button size="xs" type="button" variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
          <span className="text-muted-foreground">Moving the stop never changes what 1R is.</span>
        </form>
      </td>
    </tr>
  );
}

function Orders({ state, readOnly, onState }: { state: SimAccountStateDTO; readOnly: boolean; onState: (s: SimAccountStateDTO) => void }) {
  if (state.orders.length === 0) return <Empty>No pending orders.</Empty>;
  const cancel = async (orderId: string) => {
    const res = await cancelSimOrderAction({ accountId: state.id, orderId });
    if (!res.success) return toast.error(res.error);
    onState(res.state);
  };
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={th}>Symbol</th><th className={th}>Type</th><th className={th}>Size</th><th className={th}>Price</th>
          <th className={th}>SL</th><th className={th}>TP</th><th className={th}>Placed</th><th className={th}>Expires</th><th className={th}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {state.orders.map((o) => (
          <tr key={o.id} className="border-t border-border/60">
            <td className={cn(td, "font-sans font-medium")}>{o.symbol}</td>
            <td className={cn(td, o.side === "BUY" ? "text-emerald-500" : "text-red-400")}>{o.side === "BUY" ? "Buy" : "Sell"} {o.type.toLowerCase()}</td>
            <td className={td}>{o.quantity}</td>
            <td className={td}>{o.price}</td>
            <td className={td}>{o.stopLoss ?? "—"}</td>
            <td className={td}>{o.takeProfit ?? "—"}</td>
            <td className={cn(td, "text-muted-foreground")}>{fmtWallClock(o.placedAt)}</td>
            <td className={cn(td, "text-muted-foreground")}>{o.expiresAt ? fmtWallClock(o.expiresAt) : "GTC"}</td>
            <td className={cn(td, "text-right")}>
              {!readOnly && (
                <Button size="icon-xs" variant="ghost" aria-label={`Cancel ${o.symbol} ${o.type.toLowerCase()} order`} onClick={() => void cancel(o.id)}>
                  <X />
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function History({ state }: { state: SimAccountStateDTO }) {
  if (state.history.length === 0) return <Empty>Closed trades appear here.</Empty>;
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={th}>Symbol</th><th className={th}>Side</th><th className={th}>Size</th><th className={th}>Entry</th>
          <th className={th}>Opened</th><th className={th}>Closed</th><th className={th}>Exit</th><th className={th}>Net P&amp;L</th><th className={th}>R</th>
        </tr>
      </thead>
      <tbody>
        {state.history.map((h) => (
          <tr key={h.id} className="border-t border-border/60">
            <td className={cn(td, "font-sans font-medium")}>{h.symbol}</td>
            <td className={cn(td, h.side === "BUY" ? "text-emerald-500" : "text-red-400")}>{h.side === "BUY" ? "Buy" : "Sell"}</td>
            <td className={td}>{h.quantity}</td>
            <td className={td}>{h.entryPrice}</td>
            <td className={cn(td, "text-muted-foreground")}>{fmtWallClock(h.openedAt)}</td>
            <td className={cn(td, "text-muted-foreground")}>{fmtWallClock(h.closedAt)}</td>
            <td className={td}>
              {CLOSE_REASON_LABEL[h.closeReason ?? ""] ?? "—"}
              {h.ambiguousExit && (
                <span title="One bar reached both the stop and the target; the stop was assumed to fill first." className="ml-1 inline-flex align-middle text-amber-500">
                  <AlertTriangle className="size-3" aria-label="Ambiguous exit" />
                </span>
              )}
            </td>
            <td className={cn(td, pnlTone(h.netPnl))}>{fmtMoney(h.netPnl, state.currency, { sign: true })}</td>
            <td className={cn(td, pnlTone(h.r))}>{fmtR(h.r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
