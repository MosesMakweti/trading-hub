import Link from "next/link";
import { Flag } from "lucide-react";

import { AchievementBadge } from "@/components/achievements/achievement-badge";
import { GoalDayCell, GoalDayLegend } from "@/components/goals/goal-day-status";
import { GoalRing } from "@/components/goals/goal-ring";
import { GoalTodayChecklist } from "@/components/goals/goal-today-checklist";
import { NewGoalButton } from "@/components/goals/new-goal-button";
import { formatDateKeyLong } from "@/lib/date";
import type { AchievementsOverviewDTO } from "@/types/achievements";
import type { GoalsOverviewDTO } from "@/types/goals";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The Dashboard's progress row (replaces the old Discipline section): the
 * active goal, personal streaks and the latest achievement. One row, so the
 * dashboard doesn't grow; details live on /goals and /achievements.
 */
export function ProgressRow({ goals, achievements }: { goals: GoalsOverviewDTO; achievements: AchievementsOverviewDTO }) {
  const g = goals.active;
  const recent = g ? g.days.slice(-21) : [];
  const latest = achievements.recent[0] ?? null;
  const next =
    achievements.achievements
      .filter((a) => !a.unlocked && a.progress > 0)
      .sort((a, b) => b.progress / b.target - a.progress / a.target)[0] ?? null;

  return (
    <section aria-label="Goal and achievements" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Active goal */}
      <div className="glass rounded-2xl p-4 lg:col-span-6">
        {g ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{g.status === "PAUSED" ? "Goal · paused" : "Goal"}</div>
                <h2 className="truncate font-medium">{g.name}</h2>
              </div>
              <Link href="/goals" className="shrink-0 text-xs font-medium text-primary hover:underline">
                Details →
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-5">
              <GoalRing value={g.currentStreak} target={g.targetDays} size={84} stroke={7}>
                <span className="text-xl font-semibold tabular-nums">{g.currentStreak}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">of {g.targetDays}</span>
              </GoalRing>
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Current streak</dt>
                  <dd className="font-medium tabular-nums">{plural(g.currentStreak, "day")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Progress</dt>
                  <dd className="font-medium tabular-nums">
                    {g.progressPercent}% · {plural(g.remainingDays, "day")} left
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Next milestone</dt>
                  <dd className="font-medium tabular-nums">{g.nextMilestone ? `${g.nextMilestone.days} days` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Finish</dt>
                  <dd className="font-medium">{g.projectedCompletion ? formatDateKeyLong(g.projectedCompletion) : "—"}</dd>
                </div>
              </dl>
            </div>
            {recent.length > 0 && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-1" aria-label="Recent goal days">
                  {recent.map((d) => (
                    <GoalDayCell key={d.dateKey} day={d} />
                  ))}
                </div>
                <GoalDayLegend className="mt-2 hidden sm:flex" />
              </div>
            )}
            {g.today && g.today.results.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-1.5 text-xs text-muted-foreground">Today</div>
                <GoalTodayChecklist goalId={g.id} day={g.today} compact />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-start justify-center gap-2">
            <Flag className="size-5 text-muted-foreground" aria-hidden />
            <h2 className="font-medium">Set your goal</h2>
            <p className="text-sm text-muted-foreground">Commit to a number of trading days in a row — Traditorium tracks it from what you already record.</p>
            <NewGoalButton todayKey={goals.todayKey} size="sm" />
          </div>
        )}
      </div>

      {/* Streaks */}
      <div className="glass rounded-2xl p-4 lg:col-span-3">
        <div className="text-xs text-muted-foreground">Streaks</div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Current</dt>
            <dd className="text-2xl font-semibold tabular-nums">{goals.stats.current}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Longest</dt>
            <dd className="text-2xl font-semibold tabular-nums">{goals.stats.longest}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Successful days</dt>
            <dd className="font-medium tabular-nums">{goals.stats.successfulDays}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">This week</dt>
            <dd className="font-medium tabular-nums">{g && g.thisWeek.owed > 0 ? `${g.thisWeek.qualified}/${g.thisWeek.owed}` : "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">Current resets on a missed trading day; successful days never do.</p>
      </div>

      {/* Achievements */}
      <div className="glass flex flex-col rounded-2xl p-4 lg:col-span-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">Achievements</span>
          <Link href="/achievements" className="text-xs font-medium text-primary hover:underline">
            {achievements.unlocked}/{achievements.total} →
          </Link>
        </div>
        {latest ? (
          <div className="mt-2 flex items-center gap-3">
            <AchievementBadge icon={latest.icon} level={latest.level} size="md" />
            <div className="min-w-0">
              <div className="truncate font-medium">{latest.title}</div>
              <div className="text-xs text-muted-foreground">{latest.achievedOn ? formatDateKeyLong(latest.achievedOn) : "Unlocked"}</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Your first badge comes with your first qualifying day.</p>
        )}
        {next && (
          <div className="mt-auto pt-3">
            <div className="text-xs text-muted-foreground">
              Next: <span className="text-foreground">{next.title}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${next.title} progress`} aria-valuemin={0} aria-valuemax={next.target} aria-valuenow={next.progress}>
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.round((next.progress / next.target) * 100)}%` }} />
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {next.progress} / {next.target} {next.unit}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
