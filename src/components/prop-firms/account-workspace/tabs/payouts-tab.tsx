"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PiggyBank, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/accounts/form-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ImageAttachments } from "@/components/media/image-attachments";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { isFundedStageType } from "@/domain/prop-firms/metrics";
import { createPayoutAction, updatePayoutAction } from "@/actions/prop-firms.actions";
import type { PayoutDTO, PropFirmAccountDTO } from "@/types/prop-firms";

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  REQUESTED: "Requested",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  AVAILABLE: "outline",
  REQUESTED: "secondary",
  UNDER_REVIEW: "warning",
  APPROVED: "secondary",
  PAID: "success",
  REJECTED: "danger",
  CANCELLED: "outline",
};

function AddPayoutDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gross, setGross] = useState("");
  const [split, setSplit] = useState("80");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setGross("");
    setSplit("80");
    setMethod("");
    setNotes("");
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await createPayoutAction(accountId, {
        grossPayout: gross,
        profitSplitPercent: split || undefined,
        paymentMethod: method.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Payout logged.");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="size-3.5" />
        Log payout
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log a payout</DialogTitle>
          <DialogDescription>Track a requested or received payout for this funded account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Gross payout">
            <Input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} />
          </FormField>
          <FormField label="Profit split %">
            <Input type="number" step="0.01" value={split} onChange={(e) => setSplit(e.target.value)} />
          </FormField>
          <FormField label="Payment method">
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. Wire, Crypto" />
          </FormField>
          <FormField label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !gross}>
            {isPending ? "Saving…" : "Log payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdatePayoutDialog({ payout }: { payout: PayoutDTO }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(payout.status);
  const [netReceived, setNetReceived] = useState(payout.netReceived != null ? String(payout.netReceived) : "");
  const [referenceId, setReferenceId] = useState(payout.referenceId ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await updatePayoutAction(payout.id, {
        status,
        netReceived: netReceived || undefined,
        referenceId: referenceId.trim() || undefined,
        paidDate: status === "PAID" ? new Date() : undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Payout updated.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Update</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update payout</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Status">
            <Select items={STATUS_LABELS} value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Net received">
            <Input type="number" step="0.01" value={netReceived} onChange={(e) => setNetReceived(e.target.value)} />
          </FormField>
          <FormField label="Reference ID">
            <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
          </FormField>
          <FormField label="Payment evidence">
            <ImageAttachments ownerType="PROP_FIRM_MILESTONE" ownerId={payout.id} category="Payout cert" acceptDocuments />
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutsTab({ account }: { account: PropFirmAccountDTO }) {
  const eligible =
    account.status === "FUNDED" || account.stages.some((s) => s.status === "ACTIVE" && isFundedStageType(s.type as never));

  if (!eligible && account.payouts.length === 0) {
    return (
      <EmptyState
        icon={PiggyBank}
        title="Payouts unlock once this account is funded"
        description="This account hasn't reached a funded/master stage yet — payout tracking becomes available once it does."
      />
    );
  }

  return (
    <div className="space-y-3">
      {eligible && (
        <div className="flex justify-end">
          <AddPayoutDialog accountId={account.id} />
        </div>
      )}

      {account.payouts.length === 0 ? (
        <EmptyState icon={PiggyBank} title="No payouts yet" description="Log a payout once you request one." />
      ) : (
        <div className="space-y-2">
          {account.payouts.map((p) => (
            <div key={p.id} className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatCurrency(p.grossPayout)}</span>
                  <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.netReceived != null ? `Net ${formatCurrency(p.netReceived)}` : "Net pending"}
                  {p.paidDate ? ` · Paid ${formatDate(p.paidDate)}` : p.requestedDate ? ` · Requested ${formatDate(p.requestedDate)}` : ""}
                </div>
              </div>
              <UpdatePayoutDialog payout={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
