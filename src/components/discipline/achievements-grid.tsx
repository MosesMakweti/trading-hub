import { Award, Lock, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyShort } from "@/lib/date";
import { TRACK_META } from "@/components/discipline/discipline-feedback";
import type { AchievementDTO, DisciplineOverviewDTO, TrackKey } from "@/types/discipline";

/** Unlocked (with the date it was earned) and locked (with progress) achievements, by track. */
export function AchievementsGrid({ achievements }: { achievements: AchievementDTO[] }) {
  const unlocked = achievements.filter((a) => a.unlocked).length;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Achievements</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {unlocked} of {achievements.length} unlocked
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(["routine", "review", "adherence"] as TrackKey[]).map((track) => (
          <div key={track} className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TrackIcon icon={TRACK_META[track].icon} />
              {TRACK_META[track].label}
            </h3>
            <ul className="space-y-2">
              {achievements
                .filter((a) => a.track === track)
                .map((a) => (
                  <AchievementRow key={a.key} a={a} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function AchievementRow({ a }: { a: AchievementDTO }) {
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border p-2.5",
        a.unlocked ? "border-border bg-background/40" : "border-dashed border-border bg-transparent",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          a.unlocked ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
        )}
      >
        {a.unlocked ? <Award aria-hidden className="size-4" /> : <Lock aria-hidden className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-sm font-medium", !a.unlocked && "text-muted-foreground")}>{a.title}</span>
          {a.unlocked ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {a.isNew && <span className="mr-1.5 font-medium text-warning">New</span>}
              {a.achievedOn ? formatDateKeyShort(a.achievedOn) : ""}
            </span>
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {a.progress} / {a.target}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{a.description}</p>
        {!a.unlocked && (
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${a.title} progress`}
            aria-valuemin={0}
            aria-valuemax={a.target}
            aria-valuenow={a.progress}
          >
            <div className="h-full origin-left rounded-full bg-muted-foreground/60" style={{ transform: `scaleX(${a.progress / a.target})` }} />
          </div>
        )}
        <span className="sr-only">{a.unlocked ? `Unlocked on ${a.achievedOn}` : `Locked, ${a.progress} of ${a.target}`}</span>
      </div>
    </li>
  );
}

/** Lifetime totals and records. */
export function LifetimeStats({ overview }: { overview: DisciplineOverviewDTO }) {
  const t = overview.tracks;
  const stats = [
    { label: "Routine days completed", value: t.routine.total, icon: TRACK_META.routine.icon },
    { label: "Trades reviewed", value: t.review.total, icon: TRACK_META.review.icon },
    { label: "Perfectly followed trades", value: t.adherence.total, icon: TRACK_META.adherence.icon },
    { label: "Longest routine streak", value: t.routine.longest, icon: TRACK_META.routine.icon, suffix: "days" },
    { label: "Longest review streak", value: t.review.longest, icon: TRACK_META.review.icon, suffix: "days" },
    { label: "Longest adherence streak", value: t.adherence.longest, icon: TRACK_META.adherence.icon, suffix: "trading days" },
  ];
  return (
    <section aria-label="Lifetime" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrackIcon icon={s.icon} />
            {s.label}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {s.value}
            {s.suffix && <span className="ml-1 text-xs font-normal text-muted-foreground">{s.suffix}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

function TrackIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}
