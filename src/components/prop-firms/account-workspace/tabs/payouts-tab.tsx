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

/** The account's currently-configured profit split, if any — prefers an ACTIVE
 *  funded-type stage, else any stage carrying a PROFIT_SPLIT rule. Mirrors
 *  `resolveCurrentProfitSplitPercent` on the server. */
function resolveAccountSplit(account: PropFirmAccountDTO): number | null {
  const ordered = [...account.stages].sort((a, b) => b.order - a.order);
  const r0 = ordered.find(
    (s) => s.status === "ACTIVE" && isFundedStageType(s.type as never) && s.rules.some((r) => r.ruleKey === "PROFIT_SPLIT"),
  );
  const rAny = ordered.find((s) => s.rules.some((r) => r.ruleKey === "PROFIT_SPLIT"));
  const rule = (r0 ?? rAny)?.rules.find((r) => r.ruleKey === "PROFIT_SPLIT");
  return rule?.numericValue ?? null;
}

function AddPayoutDialog({ accountId, defaultSplit }: { accountId: string; defaultSplit: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gross, setGross] = useState("");
  const [split, setSplit] = useState(defaultSplit != null ? String(defaultSplit) : "");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setGross("");
    setSplit(defaultSplit != null ? String(defaultSplit) : "");
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
          <FormField label="Gross payout (before profit split)">
            <Input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} />
          </FormField>
          <FormField label="Profit split %">
            <Input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(e.target.value)}
              placeholder={defaultSplit != null ? String(defaultSplit) : "e.g. 80"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Saved on this payout as a snapshot — trader gets{" "}
              {gross && split ? formatCurrency((Number(gross) * Number(split)) / 100) : "gross × split%"}. Changing the
              account&apos;s split later won&apos;t affect it.
            </p>
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
          <AddPayoutDialog accountId={account.id} defaultSplit={resolveAccountSplit(account)} />
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
                  <span className="text-xs text-muted-foreground">gross</span>
                  <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                  {p.importBatchId && <Badge variant="outline">Imported</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Trader receives <span className="font-medium text-foreground">{formatCurrency(p.traderReceived)}</span>
                  {p.profitSplitPercent != null
                    ? ` · split ${p.profitSplitPercent}% · firm ${formatCurrency(p.propFirmShare ?? 0)}`
                    : " · no profit split set"}
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
