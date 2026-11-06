import { TRACK_META } from "@/components/discipline/discipline-feedback";
import type { TrackKey } from "@/types/discipline";
import { PLAN_ADHERENCE_RULES, STREAK_MILESTONES } from "@/domain/discipline/streaks";

/** The streak rules, in plain language. Transparency is part of the design. */
export function StreakRules({ timezone }: { timezone: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-muted-foreground">How streaks work</h2>
      <p className="mt-1 text-sm">
        Consistency over intensity. Process over profits. Discipline over impulse.{" "}
        <span className="text-muted-foreground">
          Nothing here counts trades placed, profit or win rate — a losing trade reviewed and executed to plan earns exactly
          what a winner does.
        </span>
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-medium">
            <TrackIcon track="routine" />
            Daily routine
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>A day counts when you complete every required pre-session item (“I am ready to trade”) that day, and close the day with a written reflection by the next day.</li>
            <li>Missing a scheduled trading day breaks the streak. Weekends, unscheduled days and days off booked in advance never do (Settings → Routine).</li>
            <li>Trading is not required — a flat day with a full routine counts.</li>
          </ul>
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 font-medium">
            <TrackIcon track="review" />
            Trade reviews
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>A trade counts once its final review is complete: motive, the four process questions and “would I take it again”.</li>
            <li>Every review adds to your total; a day with any review adds one to the streak.</li>
            <li>A scheduled day only breaks it if a closed trade was left unreviewed. Nothing to review is a rest day — reviewing an older trade never needs a new position.</li>
          </ul>
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 font-medium">
            <TrackIcon track="adherence" />
            Plan adherence
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
            {PLAN_ADHERENCE_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>A trading day with at least one such trade extends the streak; no-trade days never break it.</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Milestones: {STREAK_MILESTONES.join(", ")} days. Streaks are recalculated from your records every time, so editing or
        deleting a trade or day corrects them; achievements you’ve earned are kept. Dates follow your trading timezone ({timezone}).
      </p>
    </section>
  );
}

function TrackIcon({ track }: { track: TrackKey }) {
  const Icon = TRACK_META[track].icon;
  return <Icon aria-hidden className="size-4 shrink-0 text-primary" />;
}
