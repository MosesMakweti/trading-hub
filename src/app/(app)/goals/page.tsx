import Link from "next/link";
import { Flag } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getProgressSummary } from "@/server/services/goals.service";
import { formatDateKeyLong } from "@/lib/date";
import { FadeIn } from "@/components/shared/motion";
import { ActiveGoalPanel } from "@/components/goals/active-goal-panel";
import { GoalHistory } from "@/components/goals/goal-history";
import { NewGoalButton } from "@/components/goals/new-goal-button";
import { StreakOverview } from "@/components/goals/streak-overview";

/**
 * Goals — the trader's single consecutive-day commitment, its day-by-day
 * record and the goals that came before it. Everything is derived on the
 * server from activity Traditorium already records (goals.service).
 */
export default async function GoalsPage() {
  const user = await requireUser();
  const { goals, achievements } = await getProgressSummary(user.id);

  return (
    <FadeIn className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Goals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One commitment at a time, kept on consecutive trading days · {formatDateKeyLong(goals.todayKey)}
          </p>
        </div>
        <Link href="/achievements" className="text-xs font-medium text-primary hover:underline">
          Achievements · {achievements.unlocked}/{achievements.total} →
        </Link>
      </div>

      {goals.active ? (
        <ActiveGoalPanel goal={goals.active} todayKey={goals.todayKey} />
      ) : (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
          <Flag className="size-9 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Set your next goal</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Choose what you&apos;ll do on every trading day and for how many days in a row. Traditorium checks it from your routine, reviews,
            trades and journal — a missed day resets the streak, never your history.
          </p>
          <NewGoalButton todayKey={goals.todayKey} />
        </div>
      )}

      <StreakOverview stats={goals.stats} active={goals.active} />

      <section aria-labelledby="goal-history-heading" className="glass rounded-2xl p-5">
        <h2 id="goal-history-heading" className="text-sm font-medium">
          Previous goals
        </h2>
        <div className="mt-3">
          <GoalHistory goals={goals.history} />
        </div>
      </section>
    </FadeIn>
  );
}
