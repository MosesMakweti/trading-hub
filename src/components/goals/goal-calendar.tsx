"use client";

import { useMemo, useState } from "react";

import { formatDateKeyLong } from "@/lib/date";
import { cn } from "@/lib/utils";
import { DAY_STATUS_LABEL, GoalDayLegend, dayCellClass } from "@/components/goals/goal-day-status";
import type { GoalDayDTO } from "@/types/goals";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Every day of the goal as a week grid (Monday first). Selecting a day shows
 * what each requirement found — so a miss always comes with its reason.
 */
export function GoalCalendar({ days, todayKey }: { days: GoalDayDTO[]; todayKey: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const weeks = useMemo(() => {
    const rows: (GoalDayDTO | null)[][] = [];
    let row: (GoalDayDTO | null)[] = days.length ? Array(mondayIndex(days[0].dateKey)).fill(null) : [];
    for (const d of days) {
      row.push(d);
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push([...row, ...Array(7 - row.length).fill(null)]);
    return rows;
  }, [days]);
  const focus = days.find((d) => d.dateKey === (selected ?? todayKey)) ?? days[days.length - 1] ?? null;

  if (days.length === 0) return <p className="text-sm text-muted-foreground">Your calendar starts on the goal&apos;s first day.</p>;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl min-w-[18rem] table-fixed border-separate border-spacing-1 text-center">
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" className="text-[11px] font-normal text-muted-foreground">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={i}>
                {w.map((d, j) => (
                  <td key={j} className="p-0">
                    {d ? (
                      <button
                        type="button"
                        onClick={() => setSelected(d.dateKey)}
                        aria-pressed={focus?.dateKey === d.dateKey}
                        aria-label={`${formatDateKeyLong(d.dateKey)} — ${DAY_STATUS_LABEL[d.status]}`}
                        className={cn(
                          "relative flex h-8 w-full items-center justify-center rounded-md text-[11px] tabular-nums transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          dayCellClass(d.status),
                          d.status === "QUALIFIED" ? "text-success-foreground" : "text-muted-foreground",
                          focus?.dateKey === d.dateKey && "ring-2 ring-foreground/60",
                          d.dateKey === todayKey && "font-semibold",
                        )}
                      >
                        {Number(d.dateKey.slice(8))}
                        {d.status === "MISSED" && <span className="absolute right-1 bottom-1 size-1 rounded-full bg-danger" aria-hidden />}
                      </button>
                    ) : (
                      <span className="block h-8" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GoalDayLegend />
      {focus && (
        <div className="rounded-xl border border-border p-3 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{formatDateKeyLong(focus.dateKey)}</span>
            <span className="text-xs text-muted-foreground">
              {DAY_STATUS_LABEL[focus.status]}
              {focus.status === "QUALIFIED" && ` · day ${focus.streakAfter} of the run`}
              {!focus.final && focus.status !== "REST" && focus.status !== "PAUSED" && " · still open"}
            </span>
          </div>
          {focus.results.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {focus.results.map((r) => (
                <li key={r.requirementId} className="flex gap-2">
                  <span
                    className={cn(
                      "w-20 shrink-0 font-mono uppercase",
                      r.result === "MET" ? "text-success" : r.result === "NOT_MET" && r.mandatory ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {r.result === "MET" ? "Done" : r.result === "NOT_MET" ? (r.mandatory ? "Missed" : "Skipped") : r.result === "PENDING" ? "Open" : "n/a"}
                  </span>
                  <span className="min-w-0">
                    {r.title}
                    {!r.mandatory && <span className="text-muted-foreground"> (optional)</span>}
                    {r.reasons.length > 0 && <span className="text-muted-foreground"> — {r.reasons.join("; ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {focus.status === "PAUSED" ? "The goal was paused." : "Not a trading day — nothing was owed."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
