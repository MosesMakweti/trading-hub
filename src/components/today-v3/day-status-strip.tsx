"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Info, OctagonAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { nextSessionEvent, type SessionWindow } from "@/domain/schedule/session-countdown";
import type { DayPhase, StatusWarning } from "@/domain/today/day-phase";
import type { DayUsage, LimitState } from "@/domain/today/limit-state";

const PHASE_LABEL: Record<DayPhase, string> = {
  PREPARING: "Prepare",
  PLANNING: "Plan",
  TRADING: "Trade",
  CLOSED: "Closed",
};

const LEVEL_TONE = {
  NO_LIMIT: "text-foreground",
  WITHIN: "text-foreground",
  AT_LIMIT: "text-warning",
  OVER: "text-danger",
} as const;

/** 1 → "1.0", 1.5 → "1.5", 0.25 → "0.25" — at most two decimals, at least one. */
export function fmtPercent(n: number) {
  const s = Number(n.toFixed(2)).toString();
  return s.includes(".") ? s : `${s}.0`;
}

function fmtDuration(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Live session readout. Client-only (wall clock) and recomputed each minute;
 *  renders nothing meaningful until mounted, so SSR never guesses a time. */
function SessionReadout({ windows, activeSessions }: { windows: SessionWindow[]; activeSessions: string[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  if (windows.length === 0) return <span className="text-muted-foreground">No session windows</span>;
  if (now == null) return <span className="text-muted-foreground">Session —</span>;

  // Prefer today's declared sessions; fall back to every configured window.
  const today = new Set(activeSessions.map((s) => s.trim().toLowerCase()));
  const scoped = windows.filter((w) => today.has(w.name.trim().toLowerCase()));
  const event = nextSessionEvent(scoped.length > 0 ? scoped : windows, now);
  if (!event) return <span className="text-muted-foreground">No session</span>;
  return event.status === "active" ? (
    <span>
      <span className="font-medium text-foreground">{event.session.name}</span>
      <span className="text-muted-foreground"> · ends in {fmtDuration(event.minutesUntil)}</span>
    </span>
  ) : (
    <span className="text-muted-foreground">
      Next: <span className="text-foreground">{event.session.name}</span> in {fmtDuration(event.minutesUntil)}
    </span>
  );
}

/**
 * Today V3 — the always-visible status strip: phase · risk used / confirmed
 * limit · trades used / confirmed max · session · warnings. Every figure is
 * derived (domain/today/limit-state.ts, day-phase.ts); a missing limit reads
 * "no limit", never a fabricated default.
 */
export function DayStatusStrip({
  phase,
  usage,
  limits,
  limitState,
  warnings,
  sessionWindows,
  activeSessions,
}: {
  phase: DayPhase;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
  limitState: LimitState;
  warnings: StatusWarning[];
  sessionWindows: SessionWindow[];
  activeSessions: string[];
}) {
  const [open, setOpen] = useState(false);
  const worst = warnings.some((w) => w.severity === "danger")
    ? "danger"
    : warnings.some((w) => w.severity === "warning")
      ? "warning"
      : warnings.length > 0
        ? "info"
        : null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3.5 py-2 font-mono text-xs tabular-nums">
        <span className="font-semibold tracking-wider text-primary uppercase">{PHASE_LABEL[phase]}</span>

        <span className="flex items-baseline gap-1.5" title="Risk used today (frozen Performance risk of executed trades) / confirmed daily limit">
          <span className="text-muted-foreground">Risk</span>
          <span className={LEVEL_TONE[limitState.risk]}>
            {!usage.riskComplete && "≥"}
            {fmtPercent(usage.riskUsedPercent)}
            {limits.riskLimitPercent != null ? ` / ${fmtPercent(limits.riskLimitPercent)}%` : "%"}
          </span>
          {limits.riskLimitPercent == null && <span className="text-muted-foreground">· no limit</span>}
        </span>

        <span className="flex items-baseline gap-1.5" title="Executed trades today / confirmed max trades">
          <span className="text-muted-foreground">Trades</span>
          <span className={LEVEL_TONE[limitState.trades]}>
            {usage.executedCount}
            {limits.maxTrades != null ? ` / ${limits.maxTrades}` : ""}
          </span>
          {limits.maxTrades == null && <span className="text-muted-foreground">· no limit</span>}
          {usage.pendingIdeaCount > 0 && (
            <span className="text-muted-foreground">
              +{usage.pendingIdeaCount} idea{usage.pendingIdeaCount === 1 ? "" : "s"}
            </span>
          )}
        </span>

        <span className="flex items-baseline gap-1.5 font-sans">
          <SessionReadout windows={sessionWindows} activeSessions={activeSessions} />
        </span>

        <span className="ml-auto">
          {worst ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-sans transition-colors hover:bg-accent",
                worst === "danger" ? "text-danger" : worst === "warning" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {worst === "danger" ? (
                <OctagonAlert className="size-3.5" />
              ) : worst === "warning" ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <Info className="size-3.5" />
              )}
              {warnings.length} {warnings.length === 1 ? "notice" : "notices"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          ) : (
            <span className="font-sans text-muted-foreground">No warnings</span>
          )}
        </span>
      </div>

      {open && warnings.length > 0 && (
        <ul className="space-y-1 border-t border-border px-3.5 py-2 text-xs">
          {warnings.map((w) => (
            <li
              key={w.code}
              className={cn(
                "flex items-center gap-2",
                w.severity === "danger" ? "text-danger" : w.severity === "warning" ? "text-warning" : "text-muted-foreground",
              )}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-current" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
