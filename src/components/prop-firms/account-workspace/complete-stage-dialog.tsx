"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
} from "@/components/ui/dialog";
import { FormField } from "@/components/accounts/form-field";
import { ImageAttachments } from "@/components/media/image-attachments";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { advanceAccountStageAction } from "@/actions/prop-firms.actions";
import type { AccountStageDTO } from "@/types/prop-firms";

const RESULT_LABELS: Record<string, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  BREACHED: "Breached",
  RESET: "Reset",
  ABANDONED: "Abandoned",
};

const CERT_CATEGORIES = [
  "Phase 1 passed",
  "Phase 2 passed",
  "Phase 3 passed",
  "Funded / Master cert",
  "Scaling cert",
  "Payout cert",
  "Other",
];

export function CompleteStageDialog({
  accountId,
  stage,
  open,
  onOpenChange,
}: {
  accountId: string;
  stage: AccountStageDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "evidence">("form");
  const [closeStatus, setCloseStatus] = useState("PASSED");
  const [finalBalance, setFinalBalance] = useState(String(stage.startingBalance));
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState(CERT_CATEGORIES[0]);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const parsedBalance = Number(finalBalance);
  const stagePnl = Number.isFinite(parsedBalance) ? parsedBalance - stage.startingBalance : null;
  const daysTaken = stage.startDate ? Math.max(0, Math.round((now - new Date(stage.startDate).getTime()) / 86_400_000)) : null;

  function reset() {
    setStep("form");
    setCloseStatus("PASSED");
    setFinalBalance(String(stage.startingBalance));
    setNotes("");
    setMilestoneId(null);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await advanceAccountStageAction(accountId, {
        closeStatus,
        completionNotes: notes.trim() || undefined,
        finalBalance: Number.isFinite(parsedBalance) ? parsedBalance : undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Stage updated.");
      setMilestoneId(result.milestoneId);
      setStep("evidence");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Complete &quot;{stage.name}&quot;</DialogTitle>
              <DialogDescription>
                Record the outcome — a planned next stage activates automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <FormField label="Result">
                <Select items={RESULT_LABELS} value={closeStatus} onValueChange={(v) => v && setCloseStatus(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RESULT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Final balance">
                <Input
                  type="number"
                  step="0.01"
                  value={finalBalance}
                  onChange={(e) => setFinalBalance(e.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                <div>
                  Stage P&L:{" "}
                  <span className={stagePnl != null && stagePnl >= 0 ? "text-success" : "text-danger"}>
                    {stagePnl != null ? formatSignedCurrency(stagePnl) : "—"}
                  </span>
                </div>
                <div>Time taken: {daysTaken != null ? `${daysTaken} day${daysTaken === 1 ? "" : "s"}` : "—"}</div>
              </div>
              <FormField label="Notes">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                {isPending ? "Saving…" : "Save outcome"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add evidence (optional)</DialogTitle>
              <DialogDescription>Attach a certificate or confirmation email for this outcome.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <FormField label="Category">
                <Select
                  items={Object.fromEntries(CERT_CATEGORIES.map((c) => [c, c]))}
                  value={category}
                  onValueChange={(v) => v && setCategory(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CERT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {milestoneId && (
                <ImageAttachments
                  key={category}
                  ownerType="PROP_FIRM_MILESTONE"
                  ownerId={milestoneId}
                  category={category}
                  acceptDocuments
                  label="Certificate / confirmation email"
                />
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  reset();
                  router.refresh();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
