import Link from "next/link";
import { SquareArrowOutUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TradeStatusBadge } from "@/components/journal/workspace/workspace-ui";
import { AddTradeDialog } from "@/components/today/add-trade-dialog";
import type { TradeWorkspaceDTO } from "@/types/trades";

/**
 * Shared header for the Today trade tabs: pick which of today's trades is in
 * focus (the Idea/Execution/Review tabs then show that trade), add a new one, or
 * jump to the full Trade Workspace. Keeps the three trade tabs in sync on one
 * focused trade.
 */
export function TodayTradeBar({
  trades,
  focusedId,
  onFocus,
  todayKey,
  accounts,
  strategies,
  planBias,
  planConviction,
}: {
  trades: TradeWorkspaceDTO[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  todayKey: string;
  accounts: { id: string; name: string; kind: string }[];
  strategies: { id: string; name: string; version: number }[];
  planBias?: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  planConviction?: number | null;
}) {
  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-2.5">
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {trades.map((t) => {
          const focused = t.id === focusedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onFocus(t.id)}
              aria-pressed={focused}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                focused
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="font-medium tabular-nums">#{t.tradeNumber}</span>
              <span className="font-medium">{t.assetSymbol}</span>
              <TradeStatusBadge status={t.status} />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        {focusedId && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/journal/${todayKey}/trades/${focusedId}`} />}
          >
            <SquareArrowOutUpRight className="size-3.5" />
            Open
          </Button>
        )}
        <AddTradeDialog
          dateKey={todayKey}
          accounts={accounts}
          strategies={strategies}
          planBias={planBias}
          planConviction={planConviction}
        />
      </div>
    </div>
  );
}
