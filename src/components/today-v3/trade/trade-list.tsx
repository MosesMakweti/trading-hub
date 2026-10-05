"use client";

import { Lock, Plus, SearchX } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyShort } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { STATE_LABEL, STATE_SORT, listGroupFor, type TradeLifecycle, type TradeListGroup } from "@/domain/trades/trade-lifecycle";
import { STATE_TONE } from "@/components/today-v3/trade/trade-lifecycle-workspace";
import type { TradeWorkspaceDTO } from "@/types/trades";

export interface TradeListRow {
  trade: TradeWorkspaceDTO;
  lifecycle: TradeLifecycle;
  carried: boolean;
}

const GROUP_LABEL: Record<TradeListGroup, string> = {
  CARRIED: "Carried positions",
  ACTIVE: "Trades today",
  IDEAS: "Ideas",
  DONE: "Done",
};
const GROUP_ORDER: TradeListGroup[] = ["CARRIED", "ACTIVE", "IDEAS", "DONE"];

/**
 * Today V3 — the trade list: carried positions, today's entered trades,
 * unexecuted ideas, finished ones; needs-action first inside each group.
 * State labels come from the one derivation (domain/trades/trade-lifecycle).
 */
export function TradeList({
  rows,
  selectedId,
  onSelect,
  canCreate,
  lockReason,
  onNewIdea,
  onSetupMissed,
  missedCount,
}: {
  rows: TradeListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canCreate: boolean;
  lockReason: string | null;
  onNewIdea: () => void;
  onSetupMissed: () => void;
  missedCount: number;
}) {
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    rows: rows
      .filter((r) => listGroupFor(r.lifecycle.state, r.carried) === g)
      .sort((a, b) => STATE_SORT[a.lifecycle.state] - STATE_SORT[b.lifecycle.state] || b.trade.tradeNumber - a.trade.tradeNumber),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="flex-1 gap-1.5" onClick={onNewIdea} disabled={!canCreate} title={lockReason ?? undefined}>
          {canCreate ? <Plus className="size-3.5" /> : <Lock className="size-3.5" />}
          New trade idea
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onSetupMissed}>
          <SearchX className="size-3.5" />
          Setup missed{missedCount > 0 ? ` (${missedCount})` : ""}
        </Button>
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No trades yet today. When the market presents one of your setups, start an idea from its asset in Plan or with
          “New trade idea”.
        </p>
      ) : (
        grouped.map((g) => (
          <div key={g.group} className="space-y-1">
            <h4 className="px-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{GROUP_LABEL[g.group]}</h4>
            <ul className="space-y-1">
              {g.rows.map(({ trade, lifecycle, carried }) => {
                const selected = trade.id === selectedId;
                return (
                  <li key={trade.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(trade.id)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        selected ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:bg-accent",
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-[11px] text-muted-foreground">#{trade.tradeNumber}</span>
                        <span className="font-mono font-semibold">{trade.assetSymbol}</span>
                        <span className={trade.direction === "LONG" ? "text-success" : "text-danger"}>
                          {trade.direction === "LONG" ? "Long" : "Short"}
                        </span>
                        <span
                          className={cn(
                            "ml-auto rounded border px-1.5 py-px font-mono text-[10px] tracking-wide uppercase",
                            STATE_TONE[lifecycle.state],
                          )}
                        >
                          {lifecycle.state === "PARTIALLY_CLOSED" && lifecycle.openPercent != null
                            ? `Open ${lifecycle.openPercent}%`
                            : STATE_LABEL[lifecycle.state]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {carried ? `Carried from ${formatDateKeyShort(trade.dateKey)} · ` : ""}
                        {trade.sessionName ? `${trade.sessionName} · ` : ""}
                        {lifecycle.waitingFor}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
