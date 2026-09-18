"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateKeyLong } from "@/lib/date";
import { TradeForm } from "@/components/journal/trade-form";
import { resolveDefaultSession, type SessionWindow } from "@/domain/schedule/session-countdown";

/**
 * Logs a new trade WITHOUT leaving the Today workflow — the full trade form
 * opens in a dialog over the workspace; on save it closes and the day refreshes
 * in place, so the new trade appears in the Trade tabs. (The standalone
 * /journal/[date]/trades/new page still exists for direct links.)
 *
 * Today V2 (T3) — day-context inheritance. Two call shapes:
 *  - Launched FROM a specific asset's Today's Plan card: pass
 *    `initialAssetSymbol`/`initialStrategyId`/`finalBias` for that asset —
 *    the trade starts pre-filled with today's plan for THAT asset.
 *  - The generic "Add trade" entry points (Trade Idea tab, empty states):
 *    omit those three — there's no asset context to guess from, so the
 *    normal asset/strategy/bias selectors show up untouched. Session
 *    inheritance is day-level, not asset-scoped, so it applies either way.
 */
export function AddTradeDialog({
  dateKey,
  accounts,
  strategies,
  trigger,
  initialAssetSymbol,
  initialStrategyId,
  finalBias,
  activeSessions,
  sessionWindows,
}: {
  dateKey: string;
  accounts: { id: string; name: string; kind: string }[];
  strategies: { id: string; name: string; version: number }[];
  trigger?: ReactElement;
  /** Only passed when launched from a specific asset's Today's Plan card. */
  initialAssetSymbol?: string;
  /** That asset's DailyAssetAnalysis.activeStrategyId — a form default only,
   *  never a historical trade owner (see the schema's own doc comment). */
  initialStrategyId?: string | null;
  /** That asset's DailyAssetAnalysis.finalBias (LONG/SHORT/NEUTRAL) — mapped
   *  to the trade form's own BULLISH/BEARISH vocabulary. Never
   *  TradingDay.bias (legacy, unused). */
  finalBias?: "LONG" | "SHORT" | "NEUTRAL" | null;
  /** TradingDay.activeSessions — day-level, applies regardless of asset. */
  activeSessions?: string[];
  /** The trader's globally configured session windows, for disambiguating
   *  which of several active-today sessions is happening right now. */
  sessionWindows?: SessionWindow[];
}) {
  const initialBias = finalBias === "LONG" ? "BULLISH" : finalBias === "SHORT" ? "BEARISH" : undefined;
  // A one-shot default at dialog-open time, not a live-updating display (see
  // SessionCountdown for that pattern) — a plain `new Date()` read is fine,
  // there's no rendered text here that could visibly mismatch on hydration.
  const now = new Date();
  const initialSession = resolveDefaultSession(
    activeSessions ?? [],
    sessionWindows ?? [],
    now.getHours() * 60 + now.getMinutes(),
  );
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Remount the form each open so it starts blank.
  const [instance, setInstance] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInstance((n) => n + 1);
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              Add trade
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add trade — {formatDateKeyLong(dateKey)}</DialogTitle>
          <DialogDescription>Logs into today without leaving your workflow.</DialogDescription>
        </DialogHeader>
        <TradeForm
          key={instance}
          mode="create"
          dateKey={dateKey}
          accounts={accounts}
          strategies={strategies}
          initialAssetSymbol={initialAssetSymbol}
          initialStrategyId={initialStrategyId ?? undefined}
          initialBias={initialBias}
          initialSession={initialSession}
          // Stage 6 — declutter Today's live "Add Trade Idea" flow. Account
          // allocation stays fully available from the standalone Journal
          // create/edit trade pages; the automatic Performance Account
          // allocation still happens server-side regardless (trades.service.ts).
          showAccountAllocation={false}
          onSuccess={() => {
            setOpen(false);
            // Launched from a specific asset's plan card: the trader is
            // still on Today's Plan, so point them at where the new trade
            // actually landed (the Trade Idea tab) instead of leaving them
            // to wonder if it saved.
            if (initialAssetSymbol) {
              toast.success(`Trade idea created for ${initialAssetSymbol} — see it in the Trade Idea tab.`);
            }
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
