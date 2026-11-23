"use client";

import { useState } from "react";
import { Clock3, Settings2, SkipBack, SkipForward } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import { DATA_TIME_ZONES, localDateOf, nextOccurrence, occurrenceOn, previousOccurrence, type Occurrence, type SessionDef } from "@/domain/charting/sessions";
import type { SessionSettings } from "@/domain/charting/workspace";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const daysLabel = (days: number[]) => (days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : days.map((d) => DAY[d]).join(", "));

export interface SessionJump {
  to: number;
  align: "AT_OR_BEFORE" | "AT_OR_AFTER";
  /** Exclusive bound: land inside the session or not at all. */
  until?: number;
  label: string;
}

/**
 * Jump to a session's start or end on a date, or to its previous / next
 * occurrence. Times are converted session zone → data (broker) time with
 * each zone's own daylight saving.
 */
export function SessionNavigator({
  sessions,
  settings,
  onSettings,
  viewMinute,
  disabled,
  onJump,
  onManage,
}: {
  sessions: SessionDef[];
  settings: SessionSettings;
  onSettings: (patch: Partial<SessionSettings>) => void;
  viewMinute: number;
  disabled: boolean;
  onJump: (jump: SessionJump) => void;
  onManage: () => void;
}) {
  const enabled = sessions.filter((s) => s.enabled);
  const def = enabled.find((s) => s.id === settings.selected) ?? enabled[0];
  const tz = settings.dataTimeZone;
  const [date, setDate] = useState<string | null>(null);
  const dateKey = date ?? (def ? localDateOf(viewMinute, def, tz) : "");
  const occ: Occurrence | null = def && dateKey ? occurrenceOn(def, dateKey, tz, sessions) : null;

  const jumpTo = (o: Occurrence | null, where: "start" | "end") => {
    if (!o || !def) return;
    onJump(
      where === "start"
        ? { to: o.start, align: "AT_OR_AFTER", until: o.end, label: `${def.name} ${o.date}` }
        : { to: o.end - 1, align: "AT_OR_BEFORE", label: `${def.name} ${o.date} end` },
    );
    setDate(o.date);
  };

  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-900/10 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:text-zinc-400 dark:text-zinc-100 dark:hover:bg-white/15 dark:hover:text-white dark:disabled:text-zinc-500" aria-label="Sessions" title="Jump to a trading session">
        <Clock3 className="size-3.5" /> <span className="max-lg:hidden">{def?.name ?? "Sessions"}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-80 space-y-2.5 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Session navigator</p>
          <button type="button" onClick={onManage} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Settings2 className="size-3" /> Manage
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <select aria-label="Session" value={def?.id ?? ""} onChange={(e) => onSettings({ selected: e.target.value })} className="h-8 rounded-md border border-border bg-background px-1.5 text-sm">
            {enabled.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.builtIn ? "" : " (custom)"}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Session date" value={dateKey} onChange={(e) => setDate(e.target.value || null)} className="h-8 rounded-md border border-border bg-background px-1.5 text-sm tabular-nums" />
        </div>
        {def && (
          <p className="text-[11px] text-muted-foreground">
            {def.start}–{def.end} {def.timeZone} · {daysLabel(def.days)}
            {def.intersect && " · intersection"}
            <br />
            {occ ? (
              <>
                Chart time: <span className="font-mono text-foreground">{formatReplayTime(occ.start)} → {formatReplayTime(occ.end)}</span>
              </>
            ) : (
              <span className="text-amber-500">No {def.name} session on that date.</span>
            )}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1">
          <NavButton disabled={disabled || !def} onClick={() => def && jumpTo(previousOccurrence(def, (occ?.start ?? viewMinute), tz, sessions), "start")} title="Previous occurrence">
            <SkipBack className="size-3.5" /> Prev
          </NavButton>
          <NavButton disabled={disabled || !occ} onClick={() => jumpTo(occ, "start")} title="Session start (first bar at or after it)">Start</NavButton>
          <NavButton disabled={disabled || !occ} onClick={() => jumpTo(occ, "end")} title="Session end (last bar before it)">End</NavButton>
          <NavButton disabled={disabled || !def} onClick={() => def && jumpTo(nextOccurrence(def, (occ?.start ?? viewMinute), tz, sessions), "start")} title="Next occurrence">
            Next <SkipForward className="size-3.5" />
          </NavButton>
        </div>
        <div className="space-y-1.5 border-t border-border pt-2">
          <label className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">Data time zone</span>
            <select value={tz} onChange={(e) => onSettings({ dataTimeZone: e.target.value })} className="h-7 max-w-44 rounded-md border border-border bg-background px-1 text-[11px]" aria-label="Data time zone">
              {[...DATA_TIME_ZONES, ...(DATA_TIME_ZONES.some((z) => z.value === tz) ? [] : [{ value: tz, label: tz }])].map((z) => (
                <option key={z.value} value={z.value}>{z.label}</option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-muted-foreground">MT5 data has no time zone — set the one your broker&apos;s server uses so sessions line up.</p>
          <p className="pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Show on chart</p>
          <div className="flex flex-wrap gap-1">
            {enabled.map((s) => {
              const on = settings.show.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => onSettings({ show: on ? settings.show.filter((x) => x !== s.id) : [...settings.show, s.id].slice(-20) })} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", on ? "border-foreground/40 bg-muted" : "border-border text-muted-foreground")}>
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 text-[11px]">
            {(["shading", "highLow", "labels"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={settings[k]} onChange={(e) => onSettings({ [k]: e.target.checked })} className="size-3.5" />
                {k === "shading" ? "Shading" : k === "highLow" ? "High / low" : "Labels"}
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NavButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border text-xs hover:bg-muted disabled:opacity-40">
      {children}
    </button>
  );
}
