"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SaveDot } from "@/components/today/today-ui";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { DayBehaviourRecap, DaySummaryGrid } from "@/components/journal/day-summary-widgets";
import {
  closeTradingDayAction,
  loadDayCloseSummaryAction,
  saveDailyReflectionAction,
} from "@/actions/close-day.actions";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";
import type { DailyReflectionInput } from "@/lib/validation/close-day";

/**
 * Close Trading Day (Stage 8) — a compact end-of-session summary + short
 * reflection, then finalizes the day via the existing endDay/archive
 * mechanism (closeTradingDayAction -> close-day.service.ts -> endDay).
 * Deliberately not another analytics dashboard — just enough to confirm the
 * session is in a sensible state before closing.
 */
export function CloseDayDialog({ dateKey }: { dateKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DayCloseSummaryDTO | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const result = await loadDayCloseSummaryAction(dateKey);
      if (active && result.success) setSummary(result.data);
    })();
    return () => {
      active = false;
    };
  }, [open, dateKey]);

  async function handleClose() {
    setClosing(true);
    const result = await closeTradingDayAction(dateKey, {
      dayWentWell: summary?.reflection.dayWentWell ?? null,
      dayToImprove: summary?.reflection.dayToImprove ?? null,
      dayMainLesson: summary?.reflection.dayMainLesson ?? null,
      dayCarryForward: summary?.reflection.dayCarryForward ?? null,
    });
    setClosing(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Day closed — archived to your journal.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Lock className="size-3.5" />
            Close Trading Day
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Close Trading Day</DialogTitle>
          <DialogDescription>Confirm the session is in a sensible state before archiving it.</DialogDescription>
        </DialogHeader>

        {!summary ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-5">
            <DaySummaryGrid summary={summary} />

            {summary.warnings.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-warning/30 bg-warning/10 p-3">
                {summary.warnings.map((w) => (
                  <div key={w} className="flex items-start gap-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            <DayBehaviourRecap summary={summary} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReflectionField
                dateKey={dateKey}
                field="dayWentWell"
                label="What went well today?"
                initialValue={summary.reflection.dayWentWell}
              />
              <ReflectionField
                dateKey={dateKey}
                field="dayToImprove"
                label="What needs improvement?"
                initialValue={summary.reflection.dayToImprove}
              />
              <ReflectionField
                dateKey={dateKey}
                field="dayMainLesson"
                label="Main lesson from today"
                initialValue={summary.reflection.dayMainLesson}
              />
              <ReflectionField
                dateKey={dateKey}
                field="dayCarryForward"
                label="What should I carry into the next session?"
                initialValue={summary.reflection.dayCarryForward}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Not yet
          </Button>
          <Button type="button" onClick={handleClose} disabled={closing || !summary} className="gap-1.5">
            {closing ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
            Close Trading Day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReflectionField({
  dateKey,
  field,
  label,
  initialValue,
}: {
  dateKey: string;
  field: keyof DailyReflectionInput;
  label: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const state = useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: (v) => saveDailyReflectionAction(dateKey, { [field]: v.trim() } as DailyReflectionInput),
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        <SaveDot state={state} />
      </div>
      <Textarea rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional…" />
    </div>
  );
}
