"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, CalendarOff, CalendarPlus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allTimeZones } from "@/lib/timezones";
import { addPreparationExceptionAction, savePreparationScheduleAction } from "@/actions/preparation.actions";
import { minutesToTimeString, timeStringToMinutes } from "@/lib/date";
import {
  WEEKDAYS_MONDAY_FIRST,
  formatDateKeyCompact,
  formatDateKeyMonthDay,
  formatTargetMinutes,
  weekdaysSummary,
} from "@/lib/preparation-format";
import type { PreparationScheduleDTO, PreparationSettingsDTO } from "@/types/preparation";

/**
 * Settings → Routine → Preparation Schedule (Preparation Phase 3).
 *
 * The timezone here IS the trading timezone (one canonical setting): saving a
 * different zone changes it everywhere, from the next local day. Target and
 * weekdays are wall-clock values in that zone — the browser's own zone never
 * reinterprets them. Every change takes effect from the next local day; the
 * server decides whether a day off / extra day is still allowed.
 */
export function PreparationScheduleCard({ initial }: { initial: PreparationSettingsDTO }) {
  const [settings, setSettings] = useState(initial);
  const base = settings.upcoming ?? settings.current;
  const zones = useMemo(() => allTimeZones(), []);
  const traderZone = settings.trader.pendingTimezone ?? settings.trader.timezone;
  const [timezone, setTimezone] = useState(base?.timezone ?? traderZone);
  const [time, setTime] = useState(minutesToTimeString(base?.targetMinutes ?? settings.defaults.targetMinutes));
  const [weekdays, setWeekdays] = useState<number[]>(base?.weekdays ?? settings.defaults.weekdays);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const zoneOptions = zones.includes(timezone) ? zones : [timezone, ...zones];
  const timeValid = /^\d{2}:\d{2}$/.test(time);
  const changesTimezone = timezone !== traderZone || !settings.trader.configured;

  function toggleDay(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function save() {
    setError(null);
    startSave(async () => {
      const r = await savePreparationScheduleAction({ timezone, targetMinutes: timeStringToMinutes(time), weekdays });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSettings(r.settings);
      toast.success(`Preparation Schedule saved — takes effect ${formatDateKeyCompact(r.settings.nextEffectiveFrom)}.`);
    });
  }

  return (
    <section className="glass space-y-5 rounded-2xl p-5" aria-labelledby="prep-schedule-title" data-testid="preparation-schedule-card">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
          <CalendarClock className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="prep-schedule-title" className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            Preparation Schedule
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scores your pre-session process — completion and punctuality, never P&amp;L or trades. Completed scheduled days build your
            Preparation Streak.
          </p>
        </div>
      </div>

      <ScheduleStatus current={settings.current} upcoming={settings.upcoming} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="prep-timezone">Timezone</Label>
            <select
              id="prep-timezone"
              className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              aria-describedby="prep-timezone-help"
            >
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p id="prep-timezone-help" className="text-xs text-muted-foreground">
              This is your{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                trading timezone
              </Link>{" "}
              — one setting for Today, the Journal and Preparation.
              {changesTimezone && settings.trader.configured && (
                <span className="text-warning"> Saving changes your trading timezone too, from your next local day.</span>
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prep-target">Target preparation time</Label>
            <Input
              id="prep-target"
              type="time"
              step={60}
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-describedby="prep-target-help"
              className="w-full font-mono tabular-nums sm:w-36"
            />
          </div>
        </div>
        <p id="prep-target-help" className="-mt-2 text-xs text-muted-foreground">
          This is when you aim to have your pre-session preparation completed, in {timezone}.
        </p>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Trading weekdays</legend>
          <div role="group" aria-label="Trading weekdays" className="flex flex-wrap gap-1.5">
            {WEEKDAYS_MONDAY_FIRST.map((w) => {
              const on = weekdays.includes(w.day);
              return (
                <button
                  key={w.day}
                  type="button"
                  aria-pressed={on}
                  aria-label={w.name}
                  title={w.name}
                  onClick={() => toggleDay(w.day)}
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-lg border font-mono text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    on ? "border-primary/50 bg-primary/10 font-semibold text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {w.letter}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{weekdays.length ? weekdaysSummary(weekdays) : "Choose at least one day."}</p>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={saving || weekdays.length === 0 || !timeValid}>
            {settings.current || settings.upcoming ? "Save schedule" : "Start Preparation Schedule"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Changes take effect {formatDateKeyCompact(settings.nextEffectiveFrom)} — today is never changed.
          </span>
        </div>
      </div>

      {(settings.current || settings.upcoming) && <ExceptionsSection settings={settings} onSettings={setSettings} />}
    </section>
  );
}

function scheduleLine(s: PreparationScheduleDTO) {
  return `${weekdaysSummary(s.weekdays)} · Target ${formatTargetMinutes(s.targetMinutes)} · ${s.timezone}`;
}

function ScheduleStatus({ current, upcoming }: { current: PreparationScheduleDTO | null; upcoming: PreparationScheduleDTO | null }) {
  if (!current && !upcoming) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
        Not set up. Today shows no Preparation Score until you save a schedule.
      </p>
    );
  }
  return (
    <dl className="divide-y divide-border/60 rounded-lg border border-border text-sm">
      {current && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5">
          <dt className="w-20 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Current</dt>
          <dd className="min-w-0 font-mono text-xs tabular-nums">{scheduleLine(current)}</dd>
        </div>
      )}
      {upcoming && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5">
          <dt className="w-20 font-mono text-[11px] tracking-wider text-primary uppercase">Upcoming</dt>
          <dd className="min-w-0 space-y-0.5">
            <span className="block font-mono text-xs tabular-nums">{scheduleLine(upcoming)}</span>
            <span className="block text-xs text-muted-foreground">Changes take effect: {formatDateKeyCompact(upcoming.effectiveFrom)}</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

const KIND_COPY = {
  DAY_OFF: { label: "Day off", meaning: "Day off — does not affect your Preparation Streak." },
  EXTRA_DAY: { label: "Extra trading day", meaning: "This day will count toward your Preparation Streak." },
} as const;

function ExceptionsSection({ settings, onSettings }: { settings: PreparationSettingsDTO; onSettings: (s: PreparationSettingsDTO) => void }) {
  const [dateKey, setDateKey] = useState("");
  const [kind, setKind] = useState<"DAY_OFF" | "EXTRA_DAY">("DAY_OFF");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();

  function add() {
    setError(null);
    startAdd(async () => {
      const r = await addPreparationExceptionAction({ dateKey, kind, note: note || undefined });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onSettings(r.settings);
      setDateKey("");
      setNote("");
      toast.success(`${KIND_COPY[kind].label} set for ${formatDateKeyCompact(dateKey)}.`);
    });
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div>
        <h3 className="text-sm font-medium">Days off &amp; extra days</h3>
        <p className="text-xs text-muted-foreground">Set before that day&apos;s target time. Afterwards the day stands as scheduled.</p>
      </div>

      {settings.upcomingExceptions.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border" aria-label="Upcoming days off and extra days">
          {settings.upcomingExceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="w-14 font-mono text-xs tabular-nums">{formatDateKeyMonthDay(e.dateKey)}</span>
              <span className="flex items-center gap-1.5 font-medium">
                {e.kind === "DAY_OFF" ? <CalendarOff className="size-3.5" aria-hidden /> : <CalendarPlus className="size-3.5" aria-hidden />}
                {KIND_COPY[e.kind].label}
              </span>
              {e.note && <span className="min-w-0 truncate text-xs text-muted-foreground">{e.note}</span>}
              <span className="basis-full pl-[4.25rem] text-xs text-muted-foreground max-sm:pl-0">{KIND_COPY[e.kind].meaning}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No upcoming days off or extra days.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="prep-exception-date">Date</Label>
          <Input
            id="prep-exception-date"
            type="date"
            min={settings.todayKey}
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="w-full font-mono tabular-nums sm:w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prep-exception-kind">Type</Label>
          <select
            id="prep-exception-kind"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm sm:w-44"
            value={kind}
            onChange={(e) => setKind(e.target.value as "DAY_OFF" | "EXTRA_DAY")}
          >
            <option value="DAY_OFF">Day off</option>
            <option value="EXTRA_DAY">Extra trading day</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prep-exception-note">Reason (optional)</Label>
          <Input id="prep-exception-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Travel" />
        </div>
        <Button type="button" variant="outline" onClick={add} disabled={adding || !dateKey}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{KIND_COPY[kind].meaning}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
