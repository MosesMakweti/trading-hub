"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Lock, RotateCcw, SlidersHorizontal, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  allMandatoryComplete,
  isItemComplete,
  mandatoryProgress,
  optionalProgress,
  routineProgress,
  type RoutineResponse,
  type RoutineSnapshot,
} from "@/domain/today/routine-snapshot";
import { saveRoutineResponse, setRoutineReady } from "@/actions/today-routine.actions";
import { useDayRef } from "@/components/workspace/workspace-context";

export interface DayRoutineDTO {
  snapshot: RoutineSnapshot;
  readyAt: string | null;
}

export function PreSessionRoutineSection({
  dateKey,
  routine,
  onReadyChange,
  onMandatoryRemainingChange,
  variant = "v2",
  summary,
}: {
  dateKey: string;
  routine: DayRoutineDTO;
  /** Today V3 (Preparation Phase 3) — a compact row rendered at the top of
   *  the routine's progress card (score, timing, streak). */
  summary?: ReactNode;
  /** Today V3: the routine gates TRADING (Plan stays open), so the gate copy
   *  and the ready state read differently. Backtesting keeps V2. */
  variant?: "v2" | "v3";
  /** Today V3 — keeps the status strip's "N mandatory items left" live as
   *  boxes are ticked (they autosave without refreshing the page). */
  onMandatoryRemainingChange?: (remaining: number) => void;
  /** Fired whenever readiness is toggled: `true` = confirmed (parent advances
   *  to Today's Plan), `false` = reopened (parent re-locks). */
  onReadyChange?: (ready: boolean) => void;
}) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const [responses, setResponses] = useState<Record<string, RoutineResponse>>(
    routine.snapshot.responses ?? {},
  );
  const [readyAt, setReadyAt] = useState<string | null>(routine.readyAt);
  const [isPending, startTransition] = useTransition();
  // Every in-flight `saveRoutineResponse` call, so `toggleReady` can wait for
  // them to land before asking the server to evaluate the gate — otherwise
  // checking the final required box and immediately hitting Continue can race
  // the save: the server would read the DB before that write completes and
  // see the item as still incomplete.
  const pendingSavesRef = useRef<Set<Promise<unknown>>>(new Set());
  // Saves run ONE AT A TIME, in click order. Firing a server action per tick
  // concurrently let some in-flight requests be aborted client-side (each
  // action re-renders the page) — the checkbox showed ticked while the save
  // never reached the server, and the readiness gate then refused. Found in
  // Backtesting V1 QA; the server also merges each response atomically.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const snapshot: RoutineSnapshot = { sections: routine.snapshot.sections, responses };
  const progress = routineProgress(snapshot);
  const mandatory = mandatoryProgress(snapshot);
  const optional = optionalProgress(snapshot);
  const mandatoryDone = allMandatoryComplete(snapshot);
  const mandatoryRemaining = mandatory.total - mandatory.completed;
  useEffect(() => {
    onMandatoryRemainingChange?.(mandatoryRemaining);
  }, [mandatoryRemaining, onMandatoryRemainingChange]);
  // Effective readiness: the confirmation only holds while every mandatory item is
  // still complete (e.g. a newly-added required item re-locks the day). The server
  // enforces the same rule when setting readiness.
  const isReady = readyAt != null && mandatoryDone;

  function persist(itemId: string, patch: RoutineResponse) {
    const promise = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await saveRoutineResponse(dayRef, itemId, patch);
        if (!result.success) toast.error(result.error);
      });
    saveChainRef.current = promise;
    pendingSavesRef.current.add(promise);
    void promise.finally(() => pendingSavesRef.current.delete(promise));
  }

  function toggleCheck(itemId: string, checked: boolean) {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], checked } }));
    persist(itemId, { checked });
  }

  function onText(itemId: string, text: string) {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], text } }));
  }

  function toggleReady() {
    const next = !isReady;
    startTransition(async () => {
      // Let any outstanding checkbox/text saves land before the server checks
      // the gate, so a save that's still in flight can't make a just-completed
      // item look unchecked to the DB-backed validation below.
      await Promise.allSettled(pendingSavesRef.current);
      const result = await setRoutineReady(dayRef, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setReadyAt(next ? new Date().toISOString() : null);
      // Re-read the day so the workspace unlocks / re-locks the other tabs.
      router.refresh();
      // Confirming carries the trader straight to Today's Plan; reopening
      // re-locks the downstream tabs.
      onReadyChange?.(next);
    });
  }

  // The bar + headline track what actually gates the day — mandatory
  // completion — not the raw item count. Optional items are shown as a
  // secondary stat so "done everything required" reads as 100%, not 33%.
  // With no mandatory items, fall back to overall progress.
  const gatePercent =
    mandatory.total > 0 ? (mandatoryDone ? 100 : mandatory.percent) : progress.percent;

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="glass space-y-2 rounded-2xl p-4">
        {summary}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">Pre-session routine</span>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "tabular-nums",
                mandatory.total > 0 && mandatoryDone ? "text-success" : "text-muted-foreground",
              )}
            >
              {variant === "v3"
                ? [
                    mandatory.total > 0 ? `Mandatory ${mandatory.completed}/${mandatory.total}` : null,
                    optional.total > 0 ? `Optional ${optional.completed}/${optional.total}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No items"
                : mandatory.total > 0
                  ? `Mandatory ${mandatory.completed}/${mandatory.total} · ${gatePercent}%`
                  : `${progress.completed}/${progress.total} · ${progress.percent}%`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              nativeButton={false}
              render={<Link href="/settings/routine" />}
            >
              <SlidersHorizontal className="size-3.5" />
              Edit routine
            </Button>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 ease-out",
              mandatory.total > 0 && mandatoryDone ? "bg-success" : "bg-brand-gradient",
            )}
            style={{ width: `${gatePercent}%` }}
          />
        </div>
        {(mandatory.total > 0 || optional.total > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs">
            {mandatory.total > 0 && (
              <span className={cn("flex items-center gap-1.5 tabular-nums", mandatoryDone ? "text-success" : "text-warning")}>
                {mandatoryDone ? <CircleCheck className="size-3.5" /> : <Lock className="size-3.5" />}
                {mandatoryDone
                  ? "All required items done"
                  : `${mandatory.total - mandatory.completed} required item${
                      mandatory.total - mandatory.completed === 1 ? "" : "s"
                    } left`}
              </span>
            )}
            {optional.total > 0 && (
              <span className="text-muted-foreground tabular-nums">
                Optional {optional.completed}/{optional.total}
              </span>
            )}
            <span className="text-muted-foreground/60 tabular-nums">
              {progress.completed}/{progress.total} total
            </span>
          </div>
        )}
      </div>

      {/* Sections */}
      {snapshot.sections.map((section) => (
        <div key={section.id} className="glass space-y-3 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{section.title}</h3>
          <ul className="space-y-2.5">
            {section.items.map((item) => {
              const response = responses[item.id];
              const done = isItemComplete(item, response);

              if (item.type === "CHECKBOX") {
                return (
                  <li key={item.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`r-${item.id}`}
                      checked={response?.checked === true}
                      onCheckedChange={(c) => toggleCheck(item.id, c === true)}
                    />
                    <label
                      htmlFor={`r-${item.id}`}
                      className={cn(
                        "cursor-pointer text-sm select-none",
                        done && "text-muted-foreground line-through",
                      )}
                    >
                      {item.label}
                    </label>
                    {item.isMandatory && <RequiredBadge />}
                  </li>
                );
              }

              return (
                <li key={item.id} className="space-y-1">
                  <label htmlFor={`r-${item.id}`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {item.label}
                    {item.isMandatory && <RequiredBadge />}
                  </label>
                  {item.type === "LONG_TEXT" ? (
                    <Textarea
                      id={`r-${item.id}`}
                      value={response?.text ?? ""}
                      onChange={(e) => onText(item.id, e.target.value)}
                      onBlur={(e) => persist(item.id, { text: e.target.value })}
                      rows={3}
                      className="resize-y"
                      placeholder="Write here…"
                    />
                  ) : (
                    <Input
                      id={`r-${item.id}`}
                      value={response?.text ?? ""}
                      onChange={(e) => onText(item.id, e.target.value)}
                      onBlur={(e) => persist(item.id, { text: e.target.value })}
                      placeholder="Write here…"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {snapshot.sections.length === 0 && (
        <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
          Your routine is empty. Build it in Settings → Pre-Session Routine.
        </div>
      )}

      {/* Readiness gate */}
      {variant === "v3" ? (
        <ReadinessGateV3
          isReady={isReady}
          readyAt={readyAt}
          mandatoryDone={mandatoryDone}
          mandatoryRemaining={mandatoryRemaining}
          isPending={isPending}
          onToggle={toggleReady}
        />
      ) : isReady ? (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
              <CircleCheck className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium">You&apos;re ready to trade</p>
              <p className="text-xs text-muted-foreground">
                Confirmed — the rest of today&apos;s workflow is unlocked.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={toggleReady} disabled={isPending}>
            <RotateCcw className="size-3.5" />
            Reopen routine
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {mandatoryDone ? (
            <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-success">
              <CircleCheck className="size-3.5" />
              Pre-session routine complete
            </p>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-warning">
              <TriangleAlert className="size-3.5" />
              {mandatoryRemaining} mandatory {mandatoryRemaining === 1 ? "item" : "items"} remaining
            </p>
          )}
          <Button
            type="button"
            size="lg"
            onClick={toggleReady}
            disabled={isPending || !mandatoryDone}
            title={mandatoryDone ? undefined : "Complete every required routine item to continue"}
            className="bg-primary text-primary-foreground shadow-elevated h-12 w-full gap-2 text-base hover:brightness-110 disabled:opacity-50"
          >
            {mandatoryDone ? <Sparkles className="size-5" /> : <Lock className="size-5" />}
            Continue to Today&apos;s Plan
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />
            Complete all mandatory pre-session routines to unlock the rest of today&apos;s workflow.
          </p>
        </div>
      )}
    </div>
  );
}

/** Today V3 — the readiness gate: confirming unlocks TRADING (Plan is
 *  always open). Same toggleReady path, same server-side gate. */
function ReadinessGateV3({
  isReady,
  readyAt,
  mandatoryDone,
  mandatoryRemaining,
  isPending,
  onToggle,
}: {
  isReady: boolean;
  readyAt: string | null;
  mandatoryDone: boolean;
  mandatoryRemaining: number;
  isPending: boolean;
  onToggle: () => void;
}) {
  if (isReady) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
        <p className="flex items-center gap-2 text-sm">
          <CircleCheck className="size-4 text-success" />
          <span className="font-medium">Ready to trade</span>
          {readyAt && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
              since {new Date(readyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onToggle} disabled={isPending}>
          <RotateCcw className="size-3.5" />
          Reopen
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <p className={cn("flex items-center gap-2 text-sm", mandatoryDone ? "text-success" : "text-muted-foreground")}>
        {mandatoryDone ? <CircleCheck className="size-4" /> : <Lock className="size-4" />}
        {mandatoryDone
          ? "All mandatory items done"
          : `${mandatoryRemaining} mandatory item${mandatoryRemaining === 1 ? "" : "s"} left — trading stays locked; Plan is open.`}
      </p>
      <Button
        type="button"
        onClick={onToggle}
        disabled={isPending || !mandatoryDone}
        title={mandatoryDone ? undefined : "Complete every mandatory routine item first"}
        className="gap-1.5"
      >
        {mandatoryDone ? <Sparkles className="size-4" /> : <Lock className="size-4" />}
        I&apos;m ready to trade
      </Button>
    </div>
  );
}

/** Small REQUIRED tag marking a mandatory routine item. */
function RequiredBadge() {
  return (
    <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warning uppercase">
      Required
    </span>
  );
}
