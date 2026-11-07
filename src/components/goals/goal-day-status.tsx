import { formatDateKeyLong } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { GoalDayDTO } from "@/types/goals";

/**
 * Goal day vocabulary, shared by every goal view. Status is carried by fill
 * AND form (a dot for a miss, a dashed outline while open, a diagonal for a
 * pause), never by colour alone — matching the Discipline activity calendar.
 */
export const DAY_STATUS_LABEL: Record<GoalDayDTO["status"], string> = {
  QUALIFIED: "Qualified",
  MISSED: "Missed",
  REST: "Rest day",
  PAUSED: "Paused",
  PENDING: "Open",
};

export function dayCellClass(status: GoalDayDTO["status"]): string {
  switch (status) {
    case "QUALIFIED":
      return "bg-success";
    case "MISSED":
      return "bg-danger/25";
    case "PENDING":
      return "border border-dashed border-muted-foreground/60 bg-transparent";
    case "PAUSED":
      return "bg-[repeating-linear-gradient(135deg,var(--muted)_0_3px,transparent_3px_6px)] border border-border";
    case "REST":
      return "bg-muted";
  }
}

/** One day as a small square; the title tells what happened, for hover and screen readers. */
export function GoalDayCell({ day, className }: { day: GoalDayDTO; className?: string }) {
  const reasons = day.results.flatMap((r) => (r.result === "NOT_MET" || r.result === "PENDING" ? r.reasons : []));
  const label = `${formatDateKeyLong(day.dateKey)} — ${DAY_STATUS_LABEL[day.status]}${reasons.length ? `: ${reasons.join("; ")}` : ""}`;
  return (
    <span title={label} aria-label={label} role="img" className={cn("relative inline-block size-3.5 rounded-[3px]", dayCellClass(day.status), className)}>
      {day.status === "MISSED" && <span className="absolute inset-0 m-auto size-1 rounded-full bg-danger" aria-hidden />}
    </span>
  );
}

export function GoalDayLegend({ className }: { className?: string }) {
  const items: GoalDayDTO["status"][] = ["QUALIFIED", "MISSED", "PENDING", "REST", "PAUSED"];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("relative inline-block size-3 rounded-[3px]", dayCellClass(s))} aria-hidden>
            {s === "MISSED" && <span className="absolute inset-0 m-auto size-1 rounded-full bg-danger" />}
          </span>
          {DAY_STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
