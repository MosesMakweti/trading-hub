import Link from "next/link";
import { ArrowRight, CircleCheck, ClipboardList, ListChecks, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { JournalDayRecapDTO } from "@/types/today";

/**
 * Shown on the Journal day page when the date IS today. The live routine /
 * plan / trade workflow belongs to the Today workspace — this page is the
 * day's case file (notes, images, opportunities, trades). Rather than mirror
 * a frozen recap of the live day, point the trader up to Today and show a
 * compact status line so they know where they stand.
 */
export function TodayLiveCallout({ recap, tradeCount }: { recap: JournalDayRecapDTO | null; tradeCount: number }) {
  const routine = recap?.routine;
  const routineReady = routine?.readyAt != null;
  const planSet = recap?.planDone ?? false;

  return (
    <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="bg-brand-gradient inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white">
          <Sun className="size-4" />
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">You&apos;re viewing today</p>
          <p className="text-xs text-muted-foreground">
            Your routine, plan and trade workflow are live in the Today workspace. This page is
            today&apos;s case file — notes, opportunities and trades.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ListChecks className="size-3.5" />
              {routine
                ? `Routine ${routine.progress.completed}/${routine.progress.total}`
                : "Routine not started"}
              {routineReady && <CircleCheck className="ml-0.5 size-3.5 text-success" />}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ClipboardList className="size-3.5" />
              {planSet ? "Plan set" : "Plan not set"}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {tradeCount} trade{tradeCount === 1 ? "" : "s"} logged
            </span>
          </div>
        </div>
      </div>
      <Button size="sm" className="gap-1.5" nativeButton={false} render={<Link href="/today" />}>
        Go to Today
        <ArrowRight className="size-3.5" />
      </Button>
    </section>
  );
}
