import Link from "next/link";

import { StreakCards } from "@/components/discipline/streak-cards";
import { AchievementCelebration } from "@/components/discipline/achievement-celebration";
import type { DisciplineOverviewDTO } from "@/types/discipline";

/** The Dashboard's discipline summary: current streaks, lifetime line, new achievements. */
export function DisciplineOverview({ overview }: { overview: DisciplineOverviewDTO }) {
  const t = overview.tracks;
  const unlocked = overview.achievements.filter((a) => a.unlocked).length;
  return (
    <section aria-labelledby="discipline-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="discipline-heading" className="text-sm font-medium text-muted-foreground">
          Discipline
        </h2>
        <Link href="/discipline" className="text-xs font-medium text-primary hover:underline">
          Calendar &amp; achievements →
        </Link>
      </div>
      <AchievementCelebration achievements={overview.achievements} />
      <StreakCards overview={overview} compact />
      <p className="text-xs tabular-nums text-muted-foreground">
        Lifetime: {t.routine.total} routine days · {t.review.total} trades reviewed · {t.adherence.total} executed to plan ·{" "}
        {unlocked}/{overview.achievements.length} achievements
      </p>
    </section>
  );
}
