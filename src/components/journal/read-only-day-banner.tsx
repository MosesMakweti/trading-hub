"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reopenDay } from "@/actions/today.actions";

/**
 * Shown at the top of an archived day (Journal day + Trade Workspace). The day is
 * read-only until reopened; this is the single affordance that lifts the lock.
 */
export function ReadOnlyDayBanner({ dateKey }: { dateKey: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onReopen() {
    setPending(true);
    const result = await reopenDay(dateKey);
    setPending(false);
    if (result.success) {
      toast.success("Day reopened for editing.");
      router.refresh();
    } else {
      toast.error(result.error ?? "Could not reopen day.");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium">This day is archived</p>
          <p className="text-xs text-muted-foreground">
            It&apos;s read-only. Reopen it to make changes.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onReopen}
        disabled={pending}
      >
        <RotateCcw className="size-3.5" />
        {pending ? "Reopening…" : "Reopen day"}
      </Button>
    </div>
  );
}
