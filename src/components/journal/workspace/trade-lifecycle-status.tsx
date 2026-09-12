"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { setReviewLifecycleStatusAction } from "@/actions/trade-review.actions";

type LifecycleStatus = "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED";

const OPTIONS: { value: LifecycleStatus; label: string; hint: string }[] = [
  { value: "FULLY_CLOSED", label: "Fully closed", hint: "The whole position is closed." },
  { value: "PARTIALLY_CLOSED", label: "Partially closed", hint: "Some realized, some still open." },
  { value: "STILL_HOLDING", label: "Still holding", hint: "Position remains active." },
  { value: "CANCELLED_NEVER_TRIGGERED", label: "Cancelled / never triggered", hint: "The idea never became a real trade." },
];

/**
 * Trade Review overhaul (Stage 7 §1) — the first question Trade Review asks:
 * what's the current state of this trade? Independent of the existing
 * OPEN/CLOSED/REVIEWED workflow status (domain/trades/lifecycle.ts) — see
 * Trade.reviewLifecycleStatus's schema doc comment for why these coexist.
 */
export function TradeLifecycleStatus({
  dateKey,
  tradeId,
  initialStatus,
  initialCancellationReason,
}: {
  dateKey: string;
  tradeId: string;
  initialStatus: LifecycleStatus | null;
  initialCancellationReason: string | null;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [status, setStatus] = useState<LifecycleStatus | null>(initialStatus);
  const [reason, setReason] = useState(initialCancellationReason ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function choose(next: LifecycleStatus) {
    setStatus(next);
    setSaved(false);
    setSaving(true);
    const result = await setReviewLifecycleStatusAction(dateKey, tradeId, {
      status: next,
      cancellationReason: next === "CANCELLED_NEVER_TRIGGERED" ? reason.trim() || null : null,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function saveCancellationReason() {
    if (status !== "CANCELLED_NEVER_TRIGGERED") return;
    setSaving(true);
    const result = await setReviewLifecycleStatusAction(dateKey, tradeId, {
      status,
      cancellationReason: reason.trim() || null,
    });
    setSaving(false);
    if (!result.success) toast.error(result.error);
    else router.refresh();
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">What&apos;s the current state of this trade?</span>
        {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {!saving && saved && <Check className="size-3.5 text-success" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            disabled={!editable}
            onClick={() => choose(o.value)}
            aria-pressed={status === o.value}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              status === o.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {status === "CANCELLED_NEVER_TRIGGERED" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cancellation reason (optional)</label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={saveCancellationReason}
            placeholder="e.g. news event, setup invalidated before trigger…"
            disabled={!editable}
          />
        </div>
      )}
    </div>
  );
}
