import Link from "next/link";

import { requireUser } from "@/server/guards";
import { getDisciplineOverview } from "@/server/services/discipline-streaks.service";
import { formatDateKeyLong } from "@/lib/date";
import { FadeIn } from "@/components/shared/motion";
import { StreakCards } from "@/components/discipline/streak-cards";
import { ActivityCalendar } from "@/components/discipline/activity-calendar";
import { AchievementsGrid, LifetimeStats } from "@/components/discipline/achievements-grid";
import { StreakRules } from "@/components/discipline/streak-rules";

/**
 * Discipline — the trader's process record: current streaks, lifetime
 * totals, the activity calendar and achievements. Everything is derived on
 * the server from persisted records (discipline-streaks.service).
 */
export default async function DisciplinePage() {
  const user = await requireUser();
  const overview = await getDisciplineOverview(user.id);

  return (
    <FadeIn className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discipline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Showing up, preparing, following your rules and reviewing your decisions · {formatDateKeyLong(overview.todayKey)}
          </p>
        </div>
        <div className="flex gap-4 text-xs font-medium">
          <Link href="/goals" className="text-primary hover:underline">
            Your goal →
          </Link>
          <Link href="/achievements" className="text-primary hover:underline">
            Achievements →
          </Link>
        </div>
      </div>

      <StreakCards overview={overview} />
      <LifetimeStats overview={overview} />
      <ActivityCalendar days={overview.calendar} todayKey={overview.todayKey} />
      <AchievementsGrid achievements={overview.achievements} />
      <StreakRules timezone={overview.timezone} />
    </FadeIn>
  );
}
