"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { logMissedOutcome } from "@/actions/opportunity.actions";
import {
  MISS_REASON_LABELS,
  MISSED_OUTCOME_LABELS,
  type MissReason,
  type MissedOutcome,
} from "@/types/opportunity";

// Records WHY a valid setup was skipped + WHAT it would have done. The outcome is
// trader-entered (Traditorium has no price feed); "Couldn't tell" (UNDETERMINED) hides
// the R field and is honestly excluded from the missed-opportunity cost.
export interface MissOutcomeValues {
  missReason: MissReason;
  missNote: string | null;
  missedOutcome: MissedOutcome;
  missedRealizedR: number | null;
}

export function MissOutcomeForm({
  dateKey,
  opportunityId,
  onDone,
  onCancel,
  onSubmit,
  submitLabel = "Record missed trade",
  notePlaceholder = "What happened in the moment?",
  successMessage = "Missed trade recorded.",
}: {
  dateKey: string;
  /** Resolves this PENDING opportunity as MISSED (the Journal flow). */
  opportunityId?: string;
  onDone: () => void;
  onCancel: () => void;
  /** Today V3 (Phase 4): submit the same answers elsewhere instead (a missed
   *  setup recorded in one step, or a cancelled idea recorded as missed). */
  onSubmit?: (values: MissOutcomeValues) => Promise<{ success: true } | { success: false; error: string }>;
  submitLabel?: string;
  notePlaceholder?: string;
  successMessage?: string;
}) {
  const [reason, setReason] = useState<MissReason | "">("");
  const [outcome, setOutcome] = useState<MissedOutcome>("MISSED_UNDETERMINED");
  const [realizedR, setRealizedR] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const needsR = outcome === "MISSED_WIN" || outcome === "MISSED_LOSS";

  const submit = () => {
    if (!reason) return toast.error("Pick a reason.");
    startTransition(async () => {
      const values: MissOutcomeValues = {
        missReason: reason,
        missNote: note.trim() || null,
        missedOutcome: outcome,
        missedRealizedR: needsR ? Number(realizedR) : null,
      };
      const res = onSubmit
        ? await onSubmit(values)
        : opportunityId
          ? await logMissedOutcome(dateKey, opportunityId, values)
          : ({ success: false, error: "Nothing to record." } as const);
      if (res.success) {
        toast.success(successMessage);
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Why was it missed?</Label>
          <Select
            items={(Object.keys(MISS_REASON_LABELS) as MissReason[]).map((r) => ({
              value: r,
              label: MISS_REASON_LABELS[r],
            }))}
            value={reason}
            onValueChange={(v) => setReason(v as MissReason)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MISS_REASON_LABELS) as MissReason[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {MISS_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">What would it have done?</Label>
          <Select
            items={(Object.keys(MISSED_OUTCOME_LABELS) as MissedOutcome[]).map((o) => ({
              value: o,
              label: MISSED_OUTCOME_LABELS[o],
            }))}
            value={outcome}
            onValueChange={(v) => setOutcome(v as MissedOutcome)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MISSED_OUTCOME_LABELS) as MissedOutcome[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {MISSED_OUTCOME_LABELS[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {needsR && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            {outcome === "MISSED_WIN" ? "R it would have made (+)" : "R it would have lost (−)"}
          </Label>
          <Input
            inputMode="decimal"
            value={realizedR}
            onChange={(e) => setRealizedR(e.target.value)}
            placeholder={outcome === "MISSED_WIN" ? "e.g. 3" : "e.g. -1"}
            className="tabular-nums sm:max-w-40"
          />
          <p className="text-xs text-muted-foreground">
            Only missed <em>winners</em> count as opportunity cost — avoiding a loss costs nothing.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Note (optional)</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={notePlaceholder}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
