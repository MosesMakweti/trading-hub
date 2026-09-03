"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/accounts/form-field";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { AccountBalanceCurve, ledgerEntriesToBalanceEvents } from "@/components/prop-firms/account-balance-curve";
import { createManualLedgerAdjustmentAction } from "@/actions/trade-executions.actions";
import type { LedgerEntryDTO, PropFirmAccountDTO } from "@/types/prop-firms";

const EVENT_LABELS: Record<string, string> = {
  ACCOUNT_INITIALIZED: "Account initialized",
  TRADE_PNL: "Trade PnL",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  COMMISSION_FEE: "Commission",
  CHALLENGE_PURCHASE_FEE: "Challenge purchase fee",
  RESET_FEE: "Reset fee",
  ACTIVATION_FEE: "Activation fee",
  OTHER_FEE: "Fee",
  PAYOUT: "Payout",
  WITHDRAWAL: "Withdrawal",
  DEPOSIT: "Deposit",
  CREDIT: "Credit",
  BALANCE_CORRECTION: "Balance correction",
  REFUND: "Refund",
  STAGE_PASSED: "Stage passed",
  STAGE_FAILED: "Stage failed",
  ACCOUNT_BREACHED: "Account breached",
  STAGE_STARTING_BALANCE_RESET: "Starting balance reset",
  CUSTOM_ADJUSTMENT: "Custom adjustment",
};

const ADJUSTMENT_TYPES = { MANUAL_ADJUSTMENT: "Manual adjustment", CUSTOM_ADJUSTMENT: "Custom adjustment" };

function ManualAdjustmentDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [eventType, setEventType] = useState<"MANUAL_ADJUSTMENT" | "CUSTOM_ADJUSTMENT">("MANUAL_ADJUSTMENT");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await createManualLedgerAdjustmentAction(accountId, {
        amount: Number(amount),
        reason,
        eventType,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Adjustment posted.");
      setOpen(false);
      setAmount("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" className="gap-1.5" />}>
        <Plus className="size-3.5" />
        Manual adjustment
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual balance adjustment</DialogTitle>
          <DialogDescription>Positive increases the balance, negative decreases it. A reason is required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Type">
            <Select items={ADJUSTMENT_TYPES} value={eventType} onValueChange={(v) => v && setEventType(v as typeof eventType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ADJUSTMENT_TYPES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Amount">
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. -50 or 100" />
          </FormField>
          <FormField label="Reason (required)">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required — stays visible in history" />
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !amount || !reason.trim()}>
            {isPending ? "Posting…" : "Post adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LedgerTab({ account, ledger }: { account: PropFirmAccountDTO; ledger: LedgerEntryDTO[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <ManualAdjustmentDialog accountId={account.id} />
      </div>

      {ledger.length >= 2 && (
        <AccountBalanceCurve
          events={ledgerEntriesToBalanceEvents(ledger)}
          startingBalance={account.startingBalance}
          accountCurrency={account.accountCurrency}
        />
      )}

      {ledger.length === 0 ? (
        <EmptyState icon={Receipt} title="No ledger history yet" description="Balance-affecting events will appear here." />
      ) : (
        <div className="space-y-1.5">
          {[...ledger].reverse().map((entry) => (
            <div key={entry.id} className="glass flex flex-wrap items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-sm">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {EVENT_LABELS[entry.eventType] ?? entry.eventType}
                  {(entry.eventType === "MANUAL_ADJUSTMENT" || entry.eventType === "CUSTOM_ADJUSTMENT") && (
                    <Badge variant="outline">Manual</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(entry.occurredAt)}
                  {entry.reason && ` · ${entry.reason}`}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-medium ${entry.amount > 0 ? "text-success" : entry.amount < 0 ? "text-danger" : ""}`}>
                  {formatSignedCurrency(entry.amount)}
                </div>
                <div className="text-xs text-muted-foreground">Balance {formatCurrency(entry.balanceAfter)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
