"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyLong } from "@/lib/date";
import { TRACK_META, plural } from "@/components/discipline/discipline-feedback";
import type { DisciplineCalendarDayDTO, StreakDayStatus, TrackKey } from "@/types/discipline";

/**
 * A contribution-graph view of daily discipline: one cell per local date,
 * weeks as columns (Monday first). Filter by track or see all three at once
 * (intensity = how many tracks were satisfied). Missed days are marked with
 * both colour and an inner dot, pending days with a dashed outline, so
 * status never depends on colour alone. The grid scrolls inside its card on
 * small screens (anchored to today) — the page never scrolls sideways.
 */

type Filter = "all" | TrackKey;
const FILTERS: { key: Filter; label: string; icon?: LucideIcon }[] = [
  { key: "all", label: "All" },
  { key: "routine", label: "Routine", icon: TRACK_META.routine.icon },
  { key: "review", label: "Reviews", icon: TRACK_META.review.icon },
  { key: "adherence", label: "Adherence", icon: TRACK_META.adherence.icon },
];

const STATUS_WORD: Record<StreakDayStatus, string> = { ACTIVE: "done", MISSED: "missed", REST: "rest day", PENDING: "pending" };
const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function mondayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function describe(d: DisciplineCalendarDayDTO): string {
  const routine =
    d.routine === "ACTIVE"
      ? "full routine"
      : d.routinePreSession
        ? "pre-session only"
        : d.routine === "MISSED"
          ? "routine missed"
          : d.routine === "PENDING"
            ? "routine in progress"
            : d.requirement === "EXEMPT"
              ? "day off"
              : "no routine owed";
  const reviews = d.reviewsCompleted > 0 ? plural(d.reviewsCompleted, "review") : d.review === "MISSED" ? "reviews outstanding" : "no reviews";
  const adherence =
    d.tradesExecuted === 0
      ? "no trades"
      : `${d.perfectTrades}/${d.tradesExecuted} to plan${d.tradesAwaitingReview > 0 ? ` (${d.tradesAwaitingReview} awaiting review)` : ""}`;
  return `${formatDateKeyLong(d.dateKey)} — Routine: ${routine} · Reviews: ${reviews} · Adherence: ${adherence}`;
}

function cellClass(d: DisciplineCalendarDayDTO, filter: Filter): { className: string; missed: boolean } {
  if (filter !== "all") {
    const s = d[filter];
    if (s === "ACTIVE") return { className: "bg-success", missed: false };
    if (s === "MISSED") return { className: "bg-danger/25", missed: true };
    if (s === "PENDING") return { className: "border border-dashed border-muted-foreground/60 bg-transparent", missed: false };
    return { className: "bg-muted", missed: false };
  }
  const active = (["routine", "review", "adherence"] as TrackKey[]).filter((k) => d[k] === "ACTIVE").length;
  const anyMissed = d.routine === "MISSED" || d.review === "MISSED" || d.adherence === "MISSED";
  if (active === 3) return { className: "bg-success", missed: false };
  if (active === 2) return { className: "bg-success/65", missed: anyMissed };
  if (active === 1) return { className: "bg-success/35", missed: anyMissed };
  if (anyMissed) return { className: "bg-danger/25", missed: true };
  const pending = d.routine === "PENDING" || d.review === "PENDING" || d.adherence === "PENDING";
  if (pending) return { className: "border border-dashed border-muted-foreground/60 bg-transparent", missed: false };
  return { className: "bg-muted", missed: false };
}

export function ActivityCalendar({ days, todayKey }: { days: DisciplineCalendarDayDTO[]; todayKey: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [focus, setFocus] = useState<DisciplineCalendarDayDTO | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Columns of 7 (Mon→Sun); pad the first week so rows line up with weekdays.
  const weeks = useMemo(() => {
    const cols: (DisciplineCalendarDayDTO | null)[][] = [];
    let col: (DisciplineCalendarDayDTO | null)[] = days.length ? Array(mondayIndex(days[0].dateKey)).fill(null) : [];
    for (const d of days) {
      col.push(d);
      if (col.length === 7) {
        cols.push(col);
        col = [];
      }
    }
    if (col.length) cols.push([...col, ...Array(7 - col.length).fill(null)]);
    return cols;
  }, [days]);

  const monthLabels = useMemo(
    () =>
      weeks.map((w, i) => {
        const first = w.find((d) => d != null && d.dateKey.endsWith("-01")) ?? (i === 0 ? w.find((d) => d != null) : null);
        return first ? MONTHS[Number(first.dateKey.slice(5, 7)) - 1] : "";
      }),
    [weeks],
  );

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const summary = useMemo(() => {
    const count = (k: TrackKey) => days.filter((d) => d[k] === "ACTIVE").length;
    return `${plural(count("routine"), "full routine day")}, ${plural(count("review"), "review day")} and ${plural(count("adherence"), "plan-perfect trading day")} in the last ${Math.round(days.length / 7)} weeks.`;
  }, [days]);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
        <div role="radiogroup" aria-label="Show activity for" className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.icon && <f.icon aria-hidden className="size-3.5" />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scroller} className="mt-3 overflow-x-auto pb-1" onMouseLeave={() => setFocus(null)}>
        <div className="inline-flex gap-1.5" role="img" aria-label={summary}>
          <div className="mt-4 grid shrink-0 grid-rows-7 gap-[3px] pr-1 text-[10px] leading-[11px] text-muted-foreground" aria-hidden>
            {WEEKDAY_LABELS.map((l, i) => (
              <span key={i} className="h-[11px]">
                {l}
              </span>
            ))}
          </div>
          {weeks.map((w, i) => (
            <div key={i} className="flex shrink-0 flex-col gap-[3px]" aria-hidden>
              <span className="h-[13px] text-[10px] leading-none text-muted-foreground">{monthLabels[i]}</span>
              {w.map((d, j) => {
                if (!d) return <span key={j} className="size-[11px]" />;
                const c = cellClass(d, filter);
                const status = filter === "all" ? null : STATUS_WORD[d[filter]];
                return (
                  <span
                    key={d.dateKey}
                    title={status ? `${formatDateKeyLong(d.dateKey)} — ${status}` : describe(d)}
                    onMouseEnter={() => setFocus(d)}
                    className={cn(
                      "relative flex size-[11px] items-center justify-center rounded-[3px]",
                      c.className,
                      d.dateKey === todayKey && "ring-1 ring-foreground/60 ring-offset-1 ring-offset-card",
                    )}
                  >
                    {c.missed && <span className="size-[3px] rounded-full bg-danger" />}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {focus ? describe(focus) : summary}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        {filter === "all" ? (
          <span className="flex items-center gap-1.5">
            Fewer
            <span className="size-[11px] rounded-[3px] bg-success/35" />
            <span className="size-[11px] rounded-[3px] bg-success/65" />
            <span className="size-[11px] rounded-[3px] bg-success" />
            all three
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="size-[11px] rounded-[3px] bg-success" /> Done
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="flex size-[11px] items-center justify-center rounded-[3px] bg-danger/25">
            <span className="size-[3px] rounded-full bg-danger" />
          </span>
          Missed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-[11px] rounded-[3px] border border-dashed border-muted-foreground/60" /> Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-[11px] rounded-[3px] bg-muted" /> Rest / nothing owed
        </span>
      </div>
    </section>
  );
}
