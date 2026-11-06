"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleCheck, CircleDashed, Moon } from "lucide-react";

import { cn } from "@/lib/utils";
import { TRACK_META, plural } from "@/components/discipline/discipline-feedback";
import type { DisciplineOverviewDTO, StreakTrackDTO, TrackKey } from "@/types/discipline";

/**
 * The three current streaks — routine · review · plan adherence.
 * Motion is spent only on change: the number pops when a streak increases
 * (never on first paint) and a milestone badge settles in once. Everything
 * honours prefers-reduced-motion.
 */
export function StreakCards({ overview, compact = false }: { overview: DisciplineOverviewDTO; compact?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(["routine", "review", "adherence"] as TrackKey[]).map((k) => (
        <StreakCard key={k} track={overview.tracks[k]} todayLine={todayLine(overview, k)} compact={compact} />
      ))}
    </div>
  );
}

type TodayLine = { tone: "done" | "open" | "rest"; text: string };

function todayLine(o: DisciplineOverviewDTO, key: TrackKey): TodayLine {
  const t = o.tracks[key];
  if (key === "routine") {
    if (t.creditedToday) return { tone: "done", text: "Today's full routine is complete" };
    if (o.today.requirement === "EXEMPT") return { tone: "rest", text: "Day off — your streak is safe" };
    const pre = o.today.routinePreSession ? "Pre-session ✓" : "Pre-session open";
    const post = o.today.routinePostSession ? "close ✓" : "close & reflect open";
    if (o.today.requirement === "OPTIONAL" && !o.today.routinePreSession) return { tone: "rest", text: "Not a scheduled day — optional" };
    return { tone: "open", text: `${pre} · ${post}` };
  }
  if (key === "review") {
    if (t.creditedToday) return { tone: "done", text: "Reviewed today" };
    if (o.today.reviewsOutstanding > 0) return { tone: "open", text: `${plural(o.today.reviewsOutstanding, "closed trade")} awaiting review` };
    return { tone: "rest", text: "Nothing to review — your streak is safe" };
  }
  if (t.todayStatus === "ACTIVE") return { tone: "done", text: "Executed to plan today" };
  if (t.todayStatus === "PENDING") return { tone: "open", text: "Today's trades await their review" };
  if (t.todayStatus === "MISSED") return { tone: "open", text: "No trade fully to plan today" };
  return { tone: "rest", text: "No-trade days never break this streak" };
}

function StreakCard({ track, todayLine: line, compact }: { track: StreakTrackDTO; todayLine: TodayLine; compact: boolean }) {
  const meta = TRACK_META[track.key];
  const Icon = meta.icon;
  const reduce = useReducedMotion();
  const m = track.milestone;
  const active = track.current > 0;

  return (
    <section
      aria-label={`${meta.label} streak`}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 transition-colors",
        track.milestoneReached ? "border-warning/50" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.label}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">Best {track.longest}</span>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <Icon
          aria-hidden
          className={cn("size-5 shrink-0 self-center", active ? "text-primary" : "text-muted-foreground opacity-50")}
        />
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={track.current}
            className={cn("text-3xl font-semibold tabular-nums", !active && "text-muted-foreground")}
            initial={{ opacity: 0, y: reduce ? 0 : 6, scale: reduce ? 1 : 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {track.current}
          </motion.span>
        </AnimatePresence>
        <span className="text-sm text-muted-foreground">{track.current === 1 ? meta.unit : `${meta.unit}s`}</span>
        {track.milestoneReached && (
          <motion.span
            className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
            initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {track.milestoneReached}-day milestone
          </motion.span>
        )}
      </div>

      {!compact && (
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {track.total} {meta.totalLabel}
        </p>
      )}

      <div className="mt-3 space-y-1">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={m.target ? `Progress to the ${m.target}-day milestone` : "All milestones reached"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(m.fraction * 100)}
        >
          <div
            className="h-full origin-left rounded-full bg-success transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${m.fraction})` }}
          />
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {m.target ? (
            <>
              Next milestone {m.target} · {m.remaining} to go
            </>
          ) : (
            "Every milestone reached"
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-xs">
        {line.tone === "done" ? (
          <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success" />
        ) : line.tone === "rest" ? (
          <Moon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <CircleDashed aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={line.tone === "done" ? "text-foreground" : "text-muted-foreground"}>{line.text}</span>
      </div>
    </section>
  );
}
