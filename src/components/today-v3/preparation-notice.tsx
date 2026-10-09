"use client";

import { Flame, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { breakNoticeText } from "@/lib/preparation-format";
import type { PreparationNoticeDTO } from "@/types/preparation";

/**
 * Today V3 — the streak-break notice (Phase 3). Factual process feedback
 * from the read model's unacknowledged break; Dismiss records the
 * acknowledgment server-side (the parent wires the action). Static — no
 * animation is needed to read it.
 */
export function PreparationBreakNotice({
  notice,
  todayKey,
  onDismiss,
  dismissing = false,
}: {
  notice: PreparationNoticeDTO;
  todayKey: string;
  onDismiss: () => void;
  dismissing?: boolean;
}) {
  const text = breakNoticeText(notice, todayKey);
  return (
    <section
      aria-label="Preparation Streak"
      className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3"
      data-testid="preparation-break-notice"
    >
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
        <Flame aria-hidden className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{text.headline}</p>
        <p className="text-sm text-muted-foreground">{text.detail}</p>
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{text.best}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1 text-muted-foreground" onClick={onDismiss} disabled={dismissing}>
        <X aria-hidden className="size-3.5" />
        Dismiss
      </Button>
    </section>
  );
}
