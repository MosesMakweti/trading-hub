"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { setGoalCheckInAction } from "@/actions/goals.actions";
import { cn } from "@/lib/utils";
import type { GoalDayDTO } from "@/types/goals";

const RESULT_ICON = {
  MET: { Icon: CircleCheck, className: "text-success", label: "Done" },
  NOT_MET: { Icon: CircleX, className: "text-danger", label: "Not met" },
  PENDING: { Icon: CircleDashed, className: "text-muted-foreground", label: "Open" },
  NOT_APPLICABLE: { Icon: CircleMinus, className: "text-muted-foreground", label: "Nothing owed today" },
} as const;

/**
 * Today's requirements and where each stands. Activity Traditorium records
 * itself is shown read-only (never ticked by hand); only custom check-ins
 * have a checkbox.
 */
export function GoalTodayChecklist({ goalId, day, compact = false }: { goalId: string; day: GoalDayDTO; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(requirementId: string, checked: boolean) {
    setBusy(requirementId);
    start(async () => {
      const r = await setGoalCheckInAction({ goalId, requirementId, dateKey: day.dateKey, checked });
      setBusy(null);
      if (!r.success) toast.error(r.error);
      router.refresh();
    });
  }

  if (day.status === "REST") {
    return <p className="text-sm text-muted-foreground">Not a trading day — nothing is owed and your streak is safe.</p>;
  }
  if (day.status === "PAUSED") {
    return <p className="text-sm text-muted-foreground">Paused today — this day neither counts nor breaks your streak.</p>;
  }

  return (
    <ul className={cn("space-y-1.5", compact && "space-y-1")}>
      {day.results.map((r) => {
        const meta = RESULT_ICON[r.result];
        const custom = r.type === "CUSTOM_CHECKIN";
        return (
          <li key={r.requirementId} className="flex items-start gap-2 text-sm">
            {custom ? (
              <span className="mt-0.5 inline-flex size-4 items-center justify-center">
                {busy === r.requirementId && pending ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <Checkbox
                    checked={r.result === "MET"}
                    disabled={pending || r.result === "NOT_MET"}
                    onCheckedChange={(v) => toggle(r.requirementId, v === true)}
                    aria-label={`${r.title} — ${r.result === "MET" ? "checked in" : "not checked in"}`}
                  />
                )}
              </span>
            ) : (
              <meta.Icon className={cn("mt-0.5 size-4 shrink-0", r.mandatory ? meta.className : "text-muted-foreground")} aria-label={meta.label} />
            )}
            <div className="min-w-0 flex-1">
              <span className={cn(r.result === "MET" ? "text-foreground" : "text-foreground/90")}>{r.title}</span>
              {!r.mandatory && <span className="ml-1.5 text-xs text-muted-foreground">optional</span>}
              {!compact && r.reasons.length > 0 && <div className="text-xs text-muted-foreground">{r.reasons.join(" · ")}</div>}
              {!compact && r.result === "NOT_APPLICABLE" && <div className="text-xs text-muted-foreground">Nothing owed today</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
