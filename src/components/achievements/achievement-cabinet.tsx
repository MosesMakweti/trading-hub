"use client";

import { useState } from "react";

import { AchievementBadge } from "@/components/achievements/achievement-badge";
import { formatDateKeyLong } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { AchievementDTO, AchievementsOverviewDTO } from "@/types/achievements";

type Filter = "ALL" | AchievementsOverviewDTO["categories"][number]["key"];

/**
 * The Achievement Cabinet: every badge, earned or not. Earned badges show
 * the date they were met; locked ones show what they ask for and how close
 * the trader is.
 */
export function AchievementCabinet({ overview }: { overview: AchievementsOverviewDTO }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const tabs: { key: Filter; label: string; unlocked: number; total: number }[] = [
    { key: "ALL", label: "All", unlocked: overview.unlocked, total: overview.total },
    ...overview.categories.map((c) => ({ key: c.key as Filter, label: c.title, unlocked: c.unlocked, total: c.total })),
  ];
  const shown = overview.achievements.filter((a) => filter === "ALL" || a.category === filter);
  const description = filter === "ALL" ? null : overview.categories.find((c) => c.key === filter)?.description;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Achievement categories" className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-0.5 w-fit max-w-full">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={filter === t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              filter === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} <span className="tabular-nums text-muted-foreground">{t.unlocked}/{t.total}</span>
          </button>
        ))}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <ul role="tabpanel" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => (
          <AchievementCard key={a.key} a={a} />
        ))}
      </ul>
    </div>
  );
}

function AchievementCard({ a }: { a: AchievementDTO }) {
  const pct = Math.round((a.progress / a.target) * 100);
  return (
    <li className={cn("glass flex gap-4 rounded-2xl p-4", !a.unlocked && "bg-card/60")}>
      <AchievementBadge icon={a.icon} level={a.level} unlocked={a.unlocked} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={cn("font-medium", !a.unlocked && "text-foreground/80")}>{a.title}</h3>
          {a.level === 3 && <span className="shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Major</span>}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
        {a.unlocked ? (
          <p className="mt-2 text-xs text-muted-foreground">Earned {a.achievedOn ? formatDateKeyLong(a.achievedOn) : ""}</p>
        ) : (
          <div className="mt-2 space-y-1">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${a.title} progress`}
              aria-valuemin={0}
              aria-valuemax={a.target}
              aria-valuenow={a.progress}
            >
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {a.progress} / {a.target} {a.unit}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
