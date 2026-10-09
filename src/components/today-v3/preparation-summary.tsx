"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarOff, CircleAlert, CircleCheck, Clock, Flame } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  formatDateKeyCompact,
  formatLocalTime,
  minutesUntil,
  pendingContext,
  scoredSummary,
  signedDeviation,
  statusLabel,
  streakDays,
} from "@/lib/preparation-format";
import type { PreparationStatus } from "@/domain/discipline";
import type { PreparationTodayDTO, PreparationViewDTO } from "@/types/preparation";

type Scored = Extract<PreparationTodayDTO, { kind: "SCORED" }>;

/**
 * Today V3 — the compact Preparation row at the top of Prepare (Phase 3).
 *
 *   PRE-SESSION  Target 08:00 · 25 min remaining        🔥 14   92/100
 *
 * Everything shown comes from the server read model (`PreparationViewDTO`):
 * the score, points, status, streak and break facts are never derived here.
 * The only client clock is a presentation countdown anchored to the
 * server's `serverNow`; crossing the cutoff asks the server again
 * (`onCutoffPassed`) instead of deciding the outcome locally.
 */
export function PreparationSummary({ view, onCutoffPassed }: { view: PreparationViewDTO; onCutoffPassed?: () => void }) {
  const { today, streak, timezone } = view;
  const nowMs = useServerAnchoredNow(view.serverNow);

  const cutoffAt = today.kind === "PENDING" ? today.cutoffAt : null;
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!cutoffAt || !onCutoffPassed || firedFor.current === cutoffAt) return;
    if (nowMs > Date.parse(cutoffAt)) {
      firedFor.current = cutoffAt;
      onCutoffPassed();
    }
  }, [cutoffAt, nowMs, onCutoffPassed]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3" data-testid="preparation-summary">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Pre-session</span>
        <span className="min-w-0 text-xs text-muted-foreground tabular-nums">
          <ContextLine view={view} nowMs={nowMs} />
        </span>
        {streak.restartedToday && (
          <span className="text-xs text-foreground/80">
            <Flame aria-hidden className="mr-1 inline size-3 -translate-y-px text-warning" />
            New Preparation Streak started.
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StreakChip current={streak.current} longest={streak.longest} />
        {today.kind === "SCORED" && <ScoreChip today={today} timezone={timezone} />}
      </div>
    </div>
  );
}

function ContextLine({ view, nowMs }: { view: PreparationViewDTO; nowMs: number }) {
  const { today, timezone } = view;
  switch (today.kind) {
    case "PENDING": {
      // Initial render uses the server's minutes (hydration-safe); the
      // anchored clock only animates it afterwards.
      const minutes = nowMs === Date.parse(view.serverNow) ? today.minutesToTarget : minutesUntil(today.targetAt, nowMs);
      return (
        <>
          Target {formatLocalTime(today.targetAt, timezone)} · <span className={cn(minutes < 0 && "text-warning")}>{pendingContext(minutes)}</span>
        </>
      );
    }
    case "SCORED":
      return <>{scoredSummary(today)}</>;
    case "DAY_OFF":
      return (
        <>
          <CalendarOff aria-hidden className="mr-1 inline size-3 -translate-y-px" />
          Day off — doesn&apos;t affect your Preparation Streak
        </>
      );
    case "NOT_SCHEDULED":
      return <>Not a scheduled trading day — your streak is unaffected</>;
    case "OUTSIDE_ERA":
      return <>{today.startsOn ? `Preparation Schedule starts ${formatDateKeyCompact(today.startsOn)}` : "Preparation Schedule not started"}</>;
  }
}

/**
 * Server-anchored presentation clock: starts at the server's instant (so the
 * server render and hydration agree), then advances with the browser's
 * monotonic progress. It never decides an outcome.
 */
function useServerAnchoredNow(serverNowIso: string): number {
  const serverNow = Date.parse(serverNowIso);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const anchorClient = Date.now();
    const tick = () => setNow(serverNow + (Date.now() - anchorClient));
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [serverNow]);
  return now;
}

function StreakChip({ current, longest }: { current: number; longest: number }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Preparation Streak: ${current} ${current === 1 ? "day" : "days"}. Show details`}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/40 px-2 font-mono text-xs tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Flame aria-hidden className={cn("size-3.5", current > 0 ? "text-warning" : "text-muted-foreground")} />
        {current}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <PopoverTitle>Preparation Streak</PopoverTitle>
        <p className="font-mono text-sm tabular-nums">{streakDays(current)}</p>
        <p className="text-xs text-muted-foreground">
          Best: {longest} {longest === 1 ? "day" : "days"}
        </p>
        <PopoverDescription>
          Counts scheduled days with the routine completed — late still counts. Days off and unscheduled days don&apos;t affect it.
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

type Tone = "positive" | "caution" | "negative";
const TONE: Record<Tone, string> = {
  positive: "border-success/30 bg-success/5 text-success",
  caution: "border-warning/30 bg-warning/5 text-warning",
  negative: "border-destructive/30 bg-destructive/5 text-destructive",
};
function toneFor(status: PreparationStatus): Tone {
  if (status === "ON_TIME" || status === "EARLY" || status === "DAY_OFF" || status === "NOT_SCHEDULED") return "positive";
  if (status === "INCOMPLETE" || status === "MISSED") return "negative";
  return "caution";
}

function ScoreChip({ today, timezone }: { today: Scored; timezone: string }) {
  const status = today.corrected?.status ?? today.status;
  const score = today.corrected?.score ?? today.score;
  const tone = toneFor(status);
  const Icon = tone === "positive" ? CircleCheck : tone === "negative" ? CircleAlert : Clock;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Preparation score ${score} out of 100, ${statusLabel(status)}. Show breakdown`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          TONE[tone],
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="hidden text-foreground/80 sm:inline">Preparation</span>
        <span className="font-mono font-semibold tabular-nums">
          {score}
          <span className="font-normal opacity-60">/100</span>
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <ScoreBreakdown today={today} timezone={timezone} />
      </PopoverContent>
    </Popover>
  );
}

/** The canonical breakdown, row by row. Exported for tests. */
export function ScoreBreakdown({ today, timezone }: { today: Scored; timezone: string }) {
  const ready = today.readyAt ? formatLocalTime(today.readyAt, timezone) : null;
  const finalStatus = today.status;
  const missedCutoff = finalStatus === "INCOMPLETE" || finalStatus === "MISSED";
  return (
    <div className="divide-y divide-border/60 text-sm" data-testid="preparation-breakdown">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
        <PopoverTitle>Preparation</PopoverTitle>
        <span className="font-mono font-semibold tabular-nums">
          {today.score} / 100
        </span>
      </div>
      {today.corrected && (
        <p className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Adjusted after review to {statusLabel(today.corrected.status)} · {today.corrected.score}/100. The original result is shown below.
        </p>
      )}
      <div className="space-y-1 px-3 py-2.5">
        <Row label="Completion" value={`${today.completionPoints} / ${today.completionMax}`} strong />
        <p className="text-xs text-muted-foreground">
          {today.requiredDone} of {today.requiredTotal} required {today.requiredTotal === 1 ? "item" : "items"} completed
          {missedCutoff ? " by the cutoff" : ""}
        </p>
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <Row label="Timing" value={`${today.timingPoints} / ${today.timingMax}`} strong />
        <Row label="Target" value={formatLocalTime(today.targetAt, timezone)} />
        <Row label="Ready" value={ready ?? "Not ready by the cutoff"} />
        {today.deviationMinutes != null && <Row label="Deviation" value={signedDeviation(today.deviationMinutes)} />}
        {missedCutoff && <Row label="Cutoff" value={formatLocalTime(today.cutoffAt, timezone)} />}
        <Row label="Status" value={today.bandLabel ?? statusLabel(finalStatus)} />
      </div>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        Times in {timezone}. Scored on process only — never on P&amp;L, wins or trade count.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn("text-xs", strong ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", strong && "text-sm font-semibold")}>{value}</span>
    </div>
  );
}
