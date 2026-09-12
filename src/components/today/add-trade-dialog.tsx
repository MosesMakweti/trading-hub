"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
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

/**
 * Logs a new trade WITHOUT leaving the Today workflow — the full trade form
 * opens in a dialog over the workspace; on save it closes and the day refreshes
 * in place, so the new trade appears in the Trade tabs. (The standalone
 * /journal/[date]/trades/new page still exists for direct links.)
 */
export function AddTradeDialog({
  dateKey,
  accounts,
  strategies,
  planBias,
  planConviction,
  trigger,
}: {
  dateKey: string;
  accounts: { id: string; name: string; kind: string }[];
  strategies: { id: string; name: string; version: number }[];
  /** Today's plan — seeds the new trade's bias & confidence. */
  planBias?: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  planConviction?: number | null;
  trigger?: ReactElement;
}) {
  const initialBias = planBias === "BULLISH" || planBias === "BEARISH" ? planBias : undefined;
  const initialBiasConfidence =
    planConviction != null ? Math.min(100, Math.max(0, planConviction * 20)) : undefined;
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
          initialBias={initialBias}
          initialBiasConfidence={initialBiasConfidence}
          // Stage 6 — declutter Today's live "Add Trade Idea" flow. Account
          // allocation stays fully available from the standalone Journal
          // create/edit trade pages; the automatic Performance Account
          // allocation still happens server-side regardless (trades.service.ts).
          showAccountAllocation={false}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
