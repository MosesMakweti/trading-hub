import Link from "next/link";

import { requireUser } from "@/server/guards";
import { getProgressSummary } from "@/server/services/goals.service";
import { FadeIn } from "@/components/shared/motion";
import { AchievementBadge } from "@/components/achievements/achievement-badge";
import { AchievementCabinet } from "@/components/achievements/achievement-cabinet";
import { formatDateKeyLong } from "@/lib/date";

/**
 * Achievement Cabinet — every achievement, earned or still ahead. Unlocks
 * are permanent; nothing here is ever counted from profit, R or win rate.
 */
export default async function AchievementsPage() {
  const user = await requireUser();
  const { achievements: o } = await getProgressSummary(user.id);
  const latest = o.recent[0] ?? null;

  return (
    <FadeIn className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Achievements</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recognition for consistency and discipline — never for profit.</p>
        </div>
        <Link href="/goals" className="text-xs font-medium text-primary hover:underline">
          Your goal →
        </Link>
      </div>

      <section aria-label="Summary" className="glass grid gap-5 rounded-2xl p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{o.unlocked}</span>
            <span className="text-sm text-muted-foreground tabular-nums">of {o.total} unlocked · {o.percent}%</span>
          </div>
          <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={o.total} aria-valuenow={o.unlocked}>
            <div className="h-full rounded-full bg-foreground/80" style={{ width: `${o.percent}%` }} />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {o.categories.map((c) => (
              <div key={c.key} className="flex gap-1">
                <dt>{c.title}</dt>
                <dd className="tabular-nums text-foreground">
                  {c.unlocked}/{c.total}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {latest ? (
          <div className="flex items-center gap-3 md:border-l md:border-border md:pl-5">
            <AchievementBadge icon={latest.icon} level={latest.level} size="lg" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Latest</div>
              <div className="font-medium">{latest.title}</div>
              {latest.achievedOn && <div className="text-xs text-muted-foreground">{formatDateKeyLong(latest.achievedOn)}</div>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground md:max-w-xs">Your first badge comes with your first qualifying day, journal entry or trade review.</p>
        )}
      </section>

      <AchievementCabinet overview={o} />
    </FadeIn>
  );
}
