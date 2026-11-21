"use client";

import { cn } from "@/lib/utils";
import { ENVIRONMENTS, SOUNDS, formatDuration, isSoundId, type EnvironmentId } from "@/domain/mindset/options";
import type { MindsetSessionDTO } from "@/server/services/mindset.service";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";
import { Panel, PanelTitle } from "@/components/mindset/mindset-ui";

const STATUS = { COMPLETED: "Completed", INTERRUPTED: "Ended early", IN_PROGRESS: "In progress" } as const;

/** A quiet log of recent sessions — no streaks, scores or comparisons. */
export function SessionHistory({ env, sessions }: { env: EnvironmentId; sessions: MindsetSessionDTO[] }) {
  const t = ENV_THEME[env];
  return (
    <Panel env={env} aria-label="Recent sessions">
      <PanelTitle env={env} hint="Just a record of when you took time to prepare.">
        Recent sessions
      </PanelTitle>
      {sessions.length === 0 ? (
        <p className={cn("text-sm", t.muted)}>No sessions yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {sessions.slice(0, 10).map((s) => {
            const when = new Date(s.startedAt);
            const minutes = s.activeSeconds != null ? formatDuration(Math.max(60, Math.round(s.activeSeconds / 60) * 60)) : formatDuration(s.plannedSeconds);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-xs">
                <span className={cn("w-36 shrink-0", t.text)}>{when.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className={t.muted}>{minutes}</span>
                <span className={t.muted}>{ENVIRONMENTS[s.environment].label}</span>
                <span className={t.muted}>{s.sound && isSoundId(s.sound) ? SOUNDS[s.sound].label : "No sound"}</span>
                {s.categories.length > 0 && <span className={t.muted}>{s.categories.join(", ")}</span>}
                {s.fromRecommendation && <span className={cn("rounded-full px-2 py-px", t.accentSoft, t.accent)}>From your reviews</span>}
                <span className={cn("ml-auto", t.muted)}>{STATUS[s.status]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
