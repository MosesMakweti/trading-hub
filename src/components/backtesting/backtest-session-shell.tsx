"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isTradingDay, isWithinRun, type RunPeriod } from "@/domain/backtesting/run-calendar";
import { localDateToKey } from "@/lib/date";
import { recordBacktestPositionAction, setBacktestRunStatusAction } from "@/actions/backtesting.actions";
import { formatSimDate, formatSimDateCompact, formatSimWeekday } from "@/components/backtesting/format";
import type { BacktestRunStatusValue } from "@/types/backtesting";
import { ButtonLink } from "@/components/backtesting/button-link";

export type SessionDayState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

const DAY_STATE_META: Record<SessionDayState, { label: string; variant: "outline" | "secondary" | "success" }> = {
  NOT_STARTED: { label: "Not started", variant: "outline" },
  IN_PROGRESS: { label: "In progress", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "success" },
};

/** Local-calendar Date for a "YYYY-MM-DD" key (react-day-picker works in local time). */
function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function BacktestSessionShell({
  runId,
  runStatus,
  period,
  dateKey,
  previousDateKey,
  nextDateKey,
  dayIndex,
  totalTradingDays,
  dayState,
  children,
}: {
  runId: string;
  runStatus: BacktestRunStatusValue;
  period: RunPeriod;
  dateKey: string;
  previousDateKey: string | null;
  nextDateKey: string | null;
  dayIndex: number;
  totalTradingDays: number;
  dayState: SessionDayState;
  /** The shared Today workflow, rendered for this simulation date. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const readOnly = runStatus !== "ACTIVE";
  const hrefFor = (key: string) => `/backtesting/${runId}/session?date=${key}`;

  // The resume pointer is recorded once the date is actually open in the
  // browser — not during server render, so link prefetching can never move it.
  useEffect(() => {
    if (readOnly) return;
    void recordBacktestPositionAction(runId, dateKey);
  }, [runId, dateKey, readOnly]);

  const state = DAY_STATE_META[dayState];
  const [completing, startCompleting] = useTransition();
  function completeRun() {
    startCompleting(async () => {
      const result = await setBacktestRunStatusAction(runId, "COMPLETED");
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Backtest run completed.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {readOnly && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          This run is {runStatus === "ARCHIVED" ? "archived" : "completed"} — you&apos;re viewing it without changing your place in it.
        </p>
      )}

      <section aria-label="Simulation date" className="glass rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="justify-self-start">
            {previousDateKey ? (
              <ButtonLink href={hrefFor(previousDateKey)} variant="ghost" size="sm" className="gap-1">
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline">{formatSimDateCompact(previousDateKey)}</span>
                <span className="sm:hidden">Prev</span>
              </ButtonLink>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1" disabled aria-label="No earlier trading day in this run">
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline">Run start</span>
              </Button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group flex flex-col items-center rounded-lg px-3 py-1 text-center transition-colors hover:bg-muted/60"
            aria-label={`Simulation date ${formatSimDate(dateKey)} — choose another date`}
          >
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{formatSimWeekday(dateKey)}</span>
            <span className="flex items-center gap-1.5 text-lg font-semibold whitespace-nowrap tabular-nums sm:text-2xl">
              {formatSimDate(dateKey)}
              <CalendarDays className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
            </span>
          </button>

          <div className="justify-self-end">
            {nextDateKey ? (
              <ButtonLink href={hrefFor(nextDateKey)} variant="ghost" size="sm" className="gap-1">
                <span className="hidden sm:inline">{formatSimDateCompact(nextDateKey)}</span>
                <span className="sm:hidden">Next</span>
                <ChevronRight className="size-4" />
              </ButtonLink>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1" disabled aria-label="No later trading day in this run">
                <span className="hidden sm:inline">Run end</span>
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <Badge variant={state.variant}>{state.label}</Badge>
          <span className="tabular-nums">
            Trading day {dayIndex} of {totalTradingDays}
          </span>
          <span aria-hidden>·</span>
          <Link href={`/backtesting/${runId}/journal/${dateKey}`} className="underline-offset-2 hover:text-foreground hover:underline">
            View in Journal
          </Link>
        </div>
      </section>

      {dayState === "COMPLETED" && nextDateKey && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/25 bg-success/5 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{formatSimDate(dateKey)} is closed.</span>{" "}
            <span className="text-muted-foreground">Your carry-forward notes will be waiting on the next day.</span>
          </p>
          <ButtonLink href={hrefFor(nextDateKey)} size="sm" className="gap-1.5">
            Continue to {formatSimDateCompact(nextDateKey)}
            <ArrowRight className="size-3.5" />
          </ButtonLink>
        </div>
      )}
      {dayState === "COMPLETED" && !nextDateKey && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/25 bg-success/5 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">That was the last trading day of this run.</span>{" "}
            <span className="text-muted-foreground">
              {runStatus === "ACTIVE"
                ? "Complete the run when you're done — its Journal and Analytics stay available, and you can reopen it later."
                : "This run is finished; its Journal and Analytics remain available."}
            </span>
          </p>
          {runStatus === "ACTIVE" && (
            <Button size="sm" className="gap-1.5" onClick={completeRun} disabled={completing}>
              <CheckCircle2 className="size-3.5" aria-hidden />
              Complete Backtest Run
            </Button>
          )}
        </div>
      )}

      {children}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Go to date</DialogTitle>
            <DialogDescription>Only this run&apos;s trading days can be selected.</DialogDescription>
          </DialogHeader>
          <Calendar
            mode="single"
            selected={keyToLocalDate(dateKey)}
            defaultMonth={keyToLocalDate(dateKey)}
            startMonth={keyToLocalDate(period.startDateKey)}
            endMonth={keyToLocalDate(period.endDateKey)}
            showOutsideDays={false}
            disabled={(date) => {
              const key = localDateToKey(date);
              return !isWithinRun(period, key) || !isTradingDay(period, key);
            }}
            onSelect={(date) => {
              if (!date) return;
              setPickerOpen(false);
              router.push(hrefFor(localDateToKey(date)));
            }}
            className={cn("relative mx-auto w-full max-w-none p-0 [--cell-size:2.25rem]")}
            classNames={{ months: "w-full", month: "w-full", month_grid: "w-full" }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
