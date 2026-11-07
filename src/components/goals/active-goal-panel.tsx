"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pause, Pencil, Play, Flag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { GoalRing } from "@/components/goals/goal-ring";
import { GoalCalendar } from "@/components/goals/goal-calendar";
import { GoalTodayChecklist } from "@/components/goals/goal-today-checklist";
import { GOAL_CATEGORIES, GoalFormDialog } from "@/components/goals/goal-form-dialog";
import { abandonGoalAction, pauseGoalAction, resumeGoalAction } from "@/actions/goals.actions";
import { formatDateKeyLong } from "@/lib/date";
import type { ActiveGoalDTO } from "@/types/goals";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The open goal in full: progress, today, every day, and its controls. */
export function ActiveGoalPanel({ goal, todayKey }: { goal: ActiveGoalDTO; todayKey: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [pending, start] = useTransition();
  const paused = goal.status === "PAUSED";

  function run(action: (id: string) => Promise<{ success: boolean; error?: string }>, done: string) {
    start(async () => {
      const r = await action(goal.id);
      if (!r.success) toast.error(r.error ?? "Something went wrong.");
      else toast.success(done);
      setConfirmAbandon(false);
      router.refresh();
    });
  }

  const category = GOAL_CATEGORIES.find((c) => c.value === goal.category)?.label ?? goal.category;

  return (
    <section aria-labelledby="active-goal-heading" className="space-y-4">
      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border px-2 py-0.5">{category}</span>
              {paused && <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">Paused</span>}
              {!goal.started && <span className="rounded-full border border-dashed border-border px-2 py-0.5">Starts {formatDateKeyLong(goal.startDate)}</span>}
            </div>
            <h2 id="active-goal-heading" className="mt-2 text-xl font-semibold tracking-tight text-balance">
              {goal.name}
            </h2>
            {goal.description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{goal.description}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Goal actions" disabled={pending} />}>
              <MoreHorizontal /> Manage
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil /> Edit goal
              </DropdownMenuItem>
              {paused ? (
                <DropdownMenuItem onClick={() => run(resumeGoalAction, "Goal resumed")}>
                  <Play /> Resume
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={!goal.started || goal.pause.daysLeft === 0} onClick={() => run(pauseGoalAction, "Goal paused")}>
                  <Pause /> Pause{goal.pause.daysLeft < goal.pause.limit ? ` (${plural(goal.pause.daysLeft, "day")} left)` : ""}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmAbandon(true)}>
                <Flag /> Abandon goal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-[auto_1fr_1fr]">
          <GoalRing value={goal.currentStreak} target={goal.targetDays} size={120} stroke={9}>
            <span className="text-3xl font-semibold tabular-nums">{goal.currentStreak}</span>
            <span className="text-xs text-muted-foreground tabular-nums">of {goal.targetDays}</span>
          </GoalRing>

          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 text-sm">
            <Stat label="Current streak" value={plural(goal.currentStreak, "day")} hint={goal.attemptStartedOn ? `since ${formatDateKeyLong(goal.attemptStartedOn)}` : "starts with your next qualifying day"} />
            <Stat label="Progress" value={`${goal.progressPercent}%`} hint={`${plural(goal.remainingDays, "trading day")} to go`} />
            <Stat label="Longest streak" value={plural(goal.longestStreak, "day")} hint="on this goal" />
            <Stat label="Successful days" value={String(goal.successfulDays)} hint={`${plural(goal.missedDays, "missed day")} · attempt ${Math.max(goal.attempt, 1)}`} />
            <Stat
              label="Finish"
              value={goal.projectedCompletion ? formatDateKeyLong(goal.projectedCompletion) : paused ? "On hold" : "—"}
              hint={goal.projectedCompletion ? "if every trading day qualifies" : undefined}
            />
            <Stat label="Next milestone" value={goal.nextMilestone ? `${goal.nextMilestone.days} days` : "—"} hint={goal.nextMilestone?.title} />
          </dl>

          <div className="min-w-0">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today</h3>
            <div className="mt-2">
              {goal.today ? (
                <GoalTodayChecklist goalId={goal.id} day={goal.today} />
              ) : (
                <p className="text-sm text-muted-foreground">{goal.started ? "Nothing to do today." : `Your goal starts on ${formatDateKeyLong(goal.startDate)}.`}</p>
              )}
            </div>
            {paused && goal.pause.pausedSince && (
              <p className="mt-3 text-xs text-muted-foreground">
                Paused since {formatDateKeyLong(goal.pause.pausedSince)}. It resumes by itself once the {goal.pause.limit}-day allowance is used.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Every day of this goal</h3>
          <span className="text-xs text-muted-foreground">A missed trading day resets the current streak — your successful days stay on record.</span>
        </div>
        <div className="mt-3">
          <GoalCalendar days={goal.days} todayKey={todayKey} />
        </div>
      </div>

      {editing && (
        <GoalFormDialog
          open={editing}
          onOpenChange={setEditing}
          todayKey={todayKey}
          initial={{
            id: goal.id,
            name: goal.name,
            description: goal.description,
            category: goal.category,
            targetDays: goal.targetDays,
            startDate: goal.startDate,
            started: goal.started,
            currentStreak: goal.currentStreak,
            requirements: goal.requirements.map((r) => ({ type: r.type, label: r.label, mandatory: r.mandatory })),
          }}
        />
      )}
      <ConfirmDialog
        open={confirmAbandon}
        onOpenChange={setConfirmAbandon}
        title="Abandon this goal?"
        description={`It moves to your history with its ${plural(goal.successfulDays, "successful day")} kept, and you can set a new goal straight away. This can't be undone.`}
        confirmLabel="Abandon goal"
        variant="destructive"
        isPending={pending}
        onConfirm={() => run(abandonGoalAction, "Goal abandoned — its history is kept")}
      />
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
      {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
