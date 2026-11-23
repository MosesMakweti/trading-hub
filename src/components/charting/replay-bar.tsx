"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarClock, ChevronDown, ChevronLast, ChevronLeft, ChevronRight, ChevronUp, Footprints, Gauge, GripVertical, Loader2, MoreHorizontal, Pause, Pin, PinOff, Play, Radio } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import { formatWallClock, parseWallClock } from "@/domain/native-replay/wall-clock";
import { PLAYBACK_SPEEDS_MS, type PlaybackTimeframe, type ReplayBarSettings, type ReplaySettings } from "@/domain/charting/workspace";
import { clampSpeed, formatSpeed, intervalAvailable, intervalLabel, PLAYBACK_INTERVALS, positionToSpeed, speedToPosition, SPEED_STOPS_MS } from "@/domain/charting/playback-speed";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { barFractions, barPosition } from "./replay-bar-layout";

/** MT5 exports are 1-minute bars: the finest playback interval the data supports. */
const DATA_RESOLUTION_SECONDS = 60;

/** The minute on screen while playing (ahead of renders: steps update it directly). */
export interface MinuteStore {
  get: () => number | null;
  set: (minute: number | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export interface ReplayBarProps {
  /** The chart area the toolbar floats in (positions are relative to it). */
  areaRef: React.RefObject<HTMLElement | null>;
  settings: ReplaySettings;
  onSettings: (patch: Partial<Omit<ReplaySettings, "bar">>) => void;
  onBar: (patch: Partial<ReplayBarSettings>) => void;
  clockMinute: number | null;
  /** While playing: the minute currently shown on the charts. */
  liveMinute?: MinuteStore;
  /** Review position (≤ clock) or null when following the live replay. */
  reviewMinute: number | null;
  chartTf: ReplayTimeframe;
  playing: boolean;
  busy: boolean;
  canMove: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNextBar: () => void;
  onNextCandle: () => void;
  onPrevBar: () => void;
  onPrevCandle: () => void;
  /** Jump to a date/time (≤ clock → review; > clock → move forward). Historical navigation only. */
  onGoTo: (minute: number) => void;
  onLive: () => void;
  onNextDay: () => void;
  /** Extra controls (session navigator). */
  extra?: React.ReactNode;
}

// High-contrast tokens for both themes: primary icons near-white on the dark
// toolbar (near-black on the light one), secondary a step softer, accent sky.
const ICON_BTN =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-700 transition-colors hover:bg-zinc-900/10 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent dark:text-zinc-100 dark:hover:bg-white/15 dark:hover:text-white dark:disabled:text-zinc-500";
const DIVIDER = "mx-0.5 h-5 w-px shrink-0 bg-zinc-300 dark:bg-white/15";

/**
 * The floating replay toolbar. Two independent playback controls:
 *  - Step (playback interval): how much market time each step reveals.
 *  - Speed (slider): real time between steps. It only paces playback — it is
 *    not a timeline and never moves the replay position.
 * Historical navigation (jump to date/time, sessions) has its own controls.
 */
export function ReplayBar(p: ReplayBarProps) {
  const { settings, onBar } = p;
  const bar = settings.bar;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  /** The area to float in (the DOM parent if the ref isn't attached yet). */
  const areaOf = () => p.areaRef.current ?? ref.current?.parentElement ?? null;

  useLayoutEffect(() => {
    const area = areaOf();
    const el = ref.current;
    if (!area || !el) return;
    const place = () => {
      if (drag.current) return;
      setPos(barPosition({ w: area.clientWidth, h: area.clientHeight }, { w: el.offsetWidth, h: el.offsetHeight }, bar));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(area);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- areaOf reads refs
  }, [bar]);

  const view = p.reviewMinute ?? p.clockMinute;
  const reviewing = p.reviewMinute != null;
  const stepLabel = intervalLabel(settings.playbackTf);
  const stepDisabled = (!p.canMove && !reviewing) || p.busy || p.playing;

  const onHandleDown = (e: React.PointerEvent) => {
    if (bar.pinned || bar.mode !== "floating") return;
    const el = ref.current!;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const area = areaOf();
    const el = ref.current;
    if (!drag.current || !area || !el) return;
    const a = area.getBoundingClientRect();
    const f = barFractions({ w: a.width, h: a.height }, { w: el.offsetWidth, h: el.offsetHeight }, e.clientX - a.left - drag.current.dx, e.clientY - a.top - drag.current.dy);
    setPos(barPosition({ w: a.width, h: a.height }, { w: el.offsetWidth, h: el.offsetHeight }, { mode: "floating", ...f }));
  };
  const onHandleUp = (e: React.PointerEvent) => {
    const area = areaOf();
    const el = ref.current;
    if (!drag.current || !area || !el || !pos) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onBar(barFractions({ w: area.clientWidth, h: area.clientHeight }, { w: el.offsetWidth, h: el.offsetHeight }, pos.left, pos.top));
  };

  if (!bar.visible) {
    return (
      <button type="button" onClick={() => onBar({ visible: true })} className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-zinc-300 bg-white/95 px-3 py-1 text-xs font-medium text-zinc-800 shadow-lg hover:bg-white dark:border-white/15 dark:bg-[#262a31]/95 dark:text-zinc-100">
        Show replay controls
      </button>
    );
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Replay controls"
      data-replay-bar
      onPointerDown={(e) => e.stopPropagation()}
      style={pos ? { left: pos.left, top: pos.top } : { left: "50%", bottom: 12, transform: "translateX(-50%)" }}
      className="absolute z-30 flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-lg border border-zinc-300/90 bg-white/95 p-1 text-zinc-900 shadow-xl backdrop-blur-sm [scrollbar-width:none] dark:border-white/15 dark:bg-[#262a31]/95 dark:text-zinc-50"
    >
      <button
        type="button"
        aria-label={bar.pinned || bar.mode !== "floating" ? "Toolbar handle (pinned)" : "Drag to move the toolbar"}
        title={bar.pinned ? "Pinned — unpin to move" : bar.mode !== "floating" ? "Docked — float it to move" : "Drag to move"}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        className={cn(ICON_BTN, "w-5 touch-none text-zinc-500 dark:text-zinc-400", !bar.pinned && bar.mode === "floating" ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
      >
        <GripVertical className="size-4" />
      </button>

      {bar.collapsed ? (
        <>
          <PlayPause {...p} />
          <SpeedValue ms={settings.speedMs} onChange={(speedMs) => p.onSettings({ speedMs })} compact />
          {view != null && <TimeLabel minute={view} live={p.liveMinute} reviewing={reviewing} />}
          <button type="button" className={ICON_BTN} onClick={() => onBar({ collapsed: false })} aria-label="Expand replay controls" title="Expand">
            <ChevronUp className="size-4" />
          </button>
        </>
      ) : (
        <>
          <button type="button" className={ICON_BTN} onClick={p.onPrevBar} disabled={!p.clockMinute || p.playing} aria-label={`Previous step: back one ${stepLabel} (review)`} title={`Back one ${stepLabel} step (←). Reviews revealed bars; the replay itself never moves back.`}>
            <ChevronLeft className="size-4" />
          </button>

          <SpeedSlider ms={settings.speedMs} onChange={(speedMs) => p.onSettings({ speedMs })} />

          <PlayPause {...p} />

          <StepSelect value={settings.playbackTf} onChange={(playbackTf) => p.onSettings({ playbackTf })} />

          <button type="button" className={ICON_BTN} onClick={p.onNextBar} disabled={stepDisabled} aria-label={`Next step: ${stepLabel}`} title={`Next ${stepLabel} step (→)`}>
            <ChevronRight className="size-4" />
          </button>
          <button type="button" className={ICON_BTN} onClick={p.onNextCandle} disabled={stepDisabled} aria-label={`Next ${p.chartTf} chart candle`} title={`Finish the current ${p.chartTf} chart candle (Shift+→)`}>
            <ChevronLast className="size-4" />
          </button>

          <span className={DIVIDER} aria-hidden />
          {p.extra}
          <JumpTo {...p} />
          {view != null && <TimeLabel minute={view} live={p.liveMinute} reviewing={reviewing} />}
          {reviewing && (
            <button type="button" onClick={p.onLive} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2 text-[11px] font-semibold text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" title="Back to the live replay position">
              <Radio className="size-3" /> Live
            </button>
          )}
          {p.busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-600 dark:text-zinc-300" aria-label="Working" />}

          <MoreMenu {...p} />
          <button type="button" className={ICON_BTN} onClick={() => onBar({ pinned: !bar.pinned })} aria-pressed={bar.pinned} aria-label={bar.pinned ? "Unpin toolbar" : "Pin toolbar"} title={bar.pinned ? "Unpin (allow moving)" : "Pin in place"}>
            {bar.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button type="button" className={ICON_BTN} onClick={() => onBar({ collapsed: true })} aria-label="Collapse replay controls" title="Collapse">
            <ChevronDown className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}

function PlayPause(p: ReplayBarProps) {
  return (
    <button
      type="button"
      onClick={() => (p.playing ? p.onPause() : p.onPlay())}
      disabled={!p.canMove && !p.playing && p.reviewMinute == null}
      aria-pressed={p.playing}
      aria-label={p.playing ? "Pause" : "Play"}
      title="Play / pause (Space)"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white shadow-sm transition-colors hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-600 dark:disabled:text-zinc-300"
    >
      {p.playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
    </button>
  );
}

/**
 * Playback speed: the real time between two steps. Stops on a log scale;
 * dragging applies immediately (also while playing). Nothing here touches
 * the replay position or loads data.
 */
function SpeedSlider({ ms, onChange }: { ms: number; onChange: (ms: number) => void }) {
  const position = speedToPosition(ms);
  const max = SPEED_STOPS_MS.length - 1;
  // Left = fast, right = slow? Traders expect "more" to the right = faster, so invert.
  const sliderValue = max - position;
  const fill = (sliderValue / max) * 100;
  return (
    <div className="mx-1 flex shrink-0 items-center gap-1.5" title="Playback speed: real time between steps (← slower · faster →). It never changes where the replay is.">
      <Gauge className="size-3.5 shrink-0 text-zinc-600 dark:text-zinc-300" aria-hidden />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={sliderValue}
        onChange={(e) => onChange(positionToSpeed(max - Number(e.target.value)))}
        aria-label="Playback speed"
        aria-valuetext={`${formatSpeed(ms)} per bar`}
        className="speed-slider w-24 cursor-pointer lg:w-32"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
      <SpeedValue ms={ms} onChange={onChange} />
    </div>
  );
}

/** The numeric speed; click for presets and a custom value. */
function SpeedValue({ ms, onChange, compact = false }: { ms: number; onChange: (ms: number) => void; compact?: boolean }) {
  const [custom, setCustom] = useState("");
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-300 bg-zinc-100 px-1.5 font-mono text-[11px] font-medium tabular-nums text-zinc-900 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-white/15 dark:bg-white/10 dark:text-zinc-50 dark:hover:bg-white/20"
        aria-label={`Playback speed: ${formatSpeed(ms)} per bar. Change`}
        title="Playback speed (time between steps) — presets and custom"
      >
        {compact && <Gauge className="size-3" aria-hidden />}
        {formatSpeed(ms)}
        <span className="font-sans text-[10px] font-normal text-zinc-600 dark:text-zinc-300">/bar</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-56 p-2">
        <p className="pb-1 text-xs font-semibold">Playback speed: {formatSpeed(ms)}/bar</p>
        <p className="pb-2 text-[11px] text-muted-foreground">Real time between steps. How much market time a step reveals is set by Step. Steps appear one at a time, so the fastest settings run at one step per screen refresh (about 16 ms on a 60 Hz display).</p>
        <div className="grid grid-cols-3 gap-1">
          {PLAYBACK_SPEEDS_MS.map((s) => (
            <button key={s} type="button" onClick={() => onChange(s)} aria-pressed={ms === s} className={cn("rounded px-1 py-1 font-mono text-xs", ms === s ? "bg-sky-600 text-white" : "hover:bg-muted")}>
              {formatSpeed(s)}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex items-center gap-1 border-t border-border pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(custom);
            if (Number.isFinite(v) && v > 0) onChange(clampSpeed(v));
            setCustom("");
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder="Custom ms (5–60000)" aria-label="Custom speed in milliseconds" className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs tabular-nums" />
          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Set</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Playback interval: how much market time each step reveals. Independent of the chart timeframe. */
function StepSelect({ value, onChange }: { value: PlaybackTimeframe; onChange: (tf: PlaybackTimeframe) => void }) {
  return (
    <label className="ml-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-sky-600/50 bg-sky-500/10 pl-1.5 text-sky-800 focus-within:ring-2 focus-within:ring-sky-500 dark:border-sky-400/50 dark:text-sky-200" title="Step: market time revealed per playback step (independent of the chart timeframe)">
      <Footprints className="size-3.5" aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-wide">Step</span>
      <select
        aria-label="Playback interval (market time per step)"
        value={value}
        onChange={(e) => onChange(e.target.value as PlaybackTimeframe)}
        className="h-full w-[3.25rem] cursor-pointer rounded-r-md bg-transparent pr-1 font-mono text-[11px] font-semibold text-inherit outline-none"
      >
        {PLAYBACK_INTERVALS.map((i) => {
          const ok = intervalAvailable(i, DATA_RESOLUTION_SECONDS);
          return (
            <option key={i.id} value={i.timeframe ?? i.id} disabled={!ok} className="bg-white text-zinc-900 dark:bg-[#262a31] dark:text-zinc-100">
              {i.label}
              {ok ? "" : " (no second data)"}
            </option>
          );
        })}
      </select>
    </label>
  );
}

const noStore = { subscribe: () => () => {}, get: () => null };

function TimeLabel({ minute: settled, live, reviewing }: { minute: number; live?: MinuteStore; reviewing: boolean }) {
  const store = live ?? noStore;
  const playing = useSyncExternalStore(store.subscribe, store.get, () => null);
  const minute = playing ?? settled;
  return (
    <span className={cn("hidden shrink-0 whitespace-nowrap px-1 font-mono text-[11px] font-medium tabular-nums md:inline", reviewing ? "text-sky-700 dark:text-sky-300" : "text-zinc-800 dark:text-zinc-100")} aria-live="polite" title={reviewing ? "Reviewing (the live replay is further on)" : "Replay time (broker server clock)"}>
      {formatReplayTime(minute)}
    </span>
  );
}

/** Historical navigation: jump to a date & time. Separate from speed by design. */
function JumpTo(p: ReplayBarProps) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(p.reviewMinute != null || p.clockMinute != null ? formatWallClock((p.reviewMinute ?? p.clockMinute)!) : "");
      }}
    >
      <PopoverTrigger className={ICON_BTN} disabled={!p.clockMinute || p.playing} aria-label="Jump to date and time" title="Jump to a date & time">
        <CalendarClock className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-64 p-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const m = parseWallClock(value);
            if (m != null) p.onGoTo(m);
            setOpen(false);
          }}
        >
          <p className="text-xs font-semibold">Jump to (server time)</p>
          <input type="datetime-local" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Jump to (server time)" className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs tabular-nums" />
          <p className="text-[11px] text-muted-foreground">Earlier than now: review what&apos;s already revealed. Later: the replay moves forward to the first bar at that time.</p>
          <button type="submit" className="w-full rounded-md bg-sky-600 py-1 text-xs font-medium text-white hover:bg-sky-500">Go</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function MoreMenu(p: ReplayBarProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={ICON_BTN} aria-label="More replay actions">
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-60">
        <DropdownMenuItem disabled={!p.clockMinute || p.playing} onClick={p.onPrevCandle}>
          Back to the previous {p.chartTf} candle (Shift+←)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.canMove || p.playing} onClick={p.onNextDay}>Finish the trading day</DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Base UI: a menu label must live inside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Toolbar</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={p.settings.bar.mode} onValueChange={(v) => p.onBar({ mode: v as ReplayBarSettings["mode"] })}>
            <DropdownMenuRadioItem value="floating">Floating</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="top">Docked top</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="bottom">Docked bottom</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onClick={() => p.onBar({ mode: "floating", x: 0.5, y: 0.9, pinned: false, collapsed: false })}>Reset position</DropdownMenuItem>
          <DropdownMenuItem onClick={() => p.onBar({ visible: false })}>Hide toolbar</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
