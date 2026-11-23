"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Gauge,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pause,
  Pin,
  PinOff,
  Play,
  Radio,
} from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { MAX_SPEED_MS, MIN_SPEED_MS, PLAYBACK_SPEEDS_MS, PLAYBACK_TIMEFRAMES, type PlaybackTimeframe, type ReplayBarSettings, type ReplaySettings } from "@/domain/charting/workspace";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { barFractions, barPosition } from "./replay-bar-layout";

export interface ReplayBarProps {
  /** The chart area the toolbar floats in (positions are relative to it). */
  areaRef: React.RefObject<HTMLElement | null>;
  settings: ReplaySettings;
  onSettings: (patch: Partial<Omit<ReplaySettings, "bar">>) => void;
  onBar: (patch: Partial<ReplayBarSettings>) => void;
  clockMinute: number | null;
  periodFrom: number;
  periodTo: number;
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
  /** Slider released / jump chosen at `minute` (≤ clock → review; > clock → seek forward). */
  onGoTo: (minute: number) => void;
  onLive: () => void;
  onNextDay: () => void;
  /** Extra controls (session navigator). */
  extra?: React.ReactNode;
}

const fmtSpeed = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(2)}s` : `${ms}ms`);
const btn = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

/**
 * The floating replay toolbar: playback controls over the chart. Floating
 * (draggable, clamped to the chart area), or docked top/bottom; pin,
 * collapse and position are saved with the workspace.
 */
export function ReplayBar(p: ReplayBarProps) {
  const { settings, onBar } = p;
  const bar = settings.bar;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  /** The area to float in. The toolbar's own parent is the chart area; the ref
   *  prop can still be null during the first commit (parent refs attach after
   *  children's layout effects), so fall back to the DOM parent. */
  const areaOf = () => p.areaRef.current ?? ref.current?.parentElement ?? null;

  // Place within the chart area; re-place on area / toolbar resize.
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

  const view = p.reviewMinute ?? p.clockMinute ?? p.periodFrom;
  const span = Math.max(1, p.periodTo - p.periodFrom);
  const revealedPct = p.clockMinute == null ? 0 : ((p.clockMinute - p.periodFrom) / span) * 100;
  const reviewing = p.reviewMinute != null;

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
      <button type="button" onClick={() => onBar({ visible: true })} className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-[#1b1c20]/95 px-3 py-1 text-xs text-muted-foreground shadow-lg hover:text-foreground">
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
      className="absolute z-30 flex max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-lg border border-white/10 bg-[#1b1c20]/95 p-1 text-foreground shadow-xl backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={bar.pinned || bar.mode !== "floating" ? "Toolbar handle (pinned)" : "Drag to move the toolbar"}
        title={bar.pinned ? "Pinned — unpin to move" : bar.mode !== "floating" ? "Docked — float it to move" : "Drag to move"}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        className={cn(btn, "w-5 touch-none", !bar.pinned && bar.mode === "floating" ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-50")}
      >
        <GripVertical className="size-4" />
      </button>

      {bar.collapsed ? (
        <>
          <PlayPause {...p} />
          <TimeLabel minute={view} reviewing={reviewing} />
          <button type="button" className={btn} onClick={() => onBar({ collapsed: false })} aria-label="Expand replay controls" title="Expand">
            <ChevronUp className="size-4" />
          </button>
        </>
      ) : (
        <>
          <button type="button" className={btn} onClick={p.onPrevCandle} disabled={!p.clockMinute || p.playing} aria-label={`Back to the previous ${p.chartTf} boundary`} title={`Previous ${p.chartTf} boundary (review)`}>
            <ChevronFirst className="size-4" />
          </button>
          <button type="button" className={btn} onClick={p.onPrevBar} disabled={!p.clockMinute || p.playing} aria-label={`Back one ${settings.playbackTf} bar`} title={`Back one ${settings.playbackTf} bar (review)`}>
            <ChevronLeft className="size-4" />
          </button>

          <div className="relative mx-1 hidden w-40 items-center sm:flex lg:w-56">
            <input
              type="range"
              aria-label="Timeline"
              min={p.periodFrom}
              max={p.periodTo}
              step={1}
              value={scrub ?? view}
              disabled={!p.clockMinute || p.playing}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub != null) p.onGoTo(scrub);
                setScrub(null);
              }}
              onKeyUp={(e) => {
                if (scrub != null && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.startsWith("Page"))) {
                  p.onGoTo(scrub);
                  setScrub(null);
                }
              }}
              className="replay-slider h-1.5 w-full cursor-pointer appearance-none rounded-full"
              style={{ background: `linear-gradient(to right, rgba(138,180,248,.75) ${revealedPct}%, rgba(255,255,255,.12) ${revealedPct}%)` }}
            />
            {scrub != null && (
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                {formatReplayTime(scrub)}
                {p.clockMinute != null && scrub > p.clockMinute ? " · jump forward" : ""}
              </span>
            )}
          </div>

          <PlayPause {...p} />

          <select
            aria-label="Playback timeframe"
            title="Playback timeframe: the bar each step reveals (independent of the chart timeframe)"
            value={settings.playbackTf}
            onChange={(e) => p.onSettings({ playbackTf: e.target.value as PlaybackTimeframe })}
            className="h-7 rounded-md border border-white/10 bg-transparent px-1 font-mono text-[11px] text-foreground"
          >
            {PLAYBACK_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf} className="bg-[#1b1c20]">
                {tf}
              </option>
            ))}
          </select>

          <button type="button" className={btn} onClick={p.onNextBar} disabled={(!p.canMove && !reviewing) || p.busy || p.playing} aria-label={`Next ${settings.playbackTf} bar`} title={`Next ${settings.playbackTf} bar (→)`}>
            <ChevronRight className="size-4" />
          </button>
          <button type="button" className={btn} onClick={p.onNextCandle} disabled={(!p.canMove && !reviewing) || p.busy || p.playing} aria-label={`Next ${p.chartTf} candle`} title={`Finish the ${p.chartTf} candle (Shift+→)`}>
            <ChevronLast className="size-4" />
          </button>

          <SpeedControl ms={settings.speedMs} onChange={(speedMs) => p.onSettings({ speedMs })} />
          {p.extra}
          <TimeLabel minute={view} reviewing={reviewing} />
          {reviewing && (
            <button type="button" onClick={p.onLive} className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-500/15 px-2 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25" title="Back to the live replay position">
              <Radio className="size-3" /> Live
            </button>
          )}
          {p.busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Working" />}

          <MoreMenu {...p} />
          <button type="button" className={btn} onClick={() => onBar({ pinned: !bar.pinned })} aria-pressed={bar.pinned} aria-label={bar.pinned ? "Unpin toolbar" : "Pin toolbar"} title={bar.pinned ? "Unpin (allow moving)" : "Pin in place"}>
            {bar.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button type="button" className={btn} onClick={() => onBar({ collapsed: true })} aria-label="Collapse replay controls" title="Collapse">
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
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-foreground hover:bg-white/20 disabled:opacity-35"
    >
      {p.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
    </button>
  );
}

function TimeLabel({ minute, reviewing }: { minute: number; reviewing: boolean }) {
  return (
    <span className={cn("hidden whitespace-nowrap px-1.5 font-mono text-[11px] tabular-nums md:inline", reviewing ? "text-sky-300" : "text-muted-foreground")} aria-live="polite" title={reviewing ? "Reviewing (live replay is further on)" : "Replay time (broker server clock)"}>
      {formatReplayTime(minute)}
    </span>
  );
}

function SpeedControl({ ms, onChange }: { ms: number; onChange: (ms: number) => void }) {
  const [custom, setCustom] = useState("");
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label={`Playback speed: one bar every ${fmtSpeed(ms)}`} title="Time between playback bars">
        <Gauge className="size-3.5" />
        {fmtSpeed(ms)}
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-52 p-1.5">
        <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">One playback bar every</p>
        <div className="grid grid-cols-3 gap-1">
          {PLAYBACK_SPEEDS_MS.map((s) => (
            <button key={s} type="button" onClick={() => onChange(s)} aria-pressed={ms === s} className={cn("rounded px-1 py-1 font-mono text-xs", ms === s ? "bg-foreground text-background" : "hover:bg-muted")}>
              {fmtSpeed(s)}
            </button>
          ))}
        </div>
        <form
          className="mt-1.5 flex items-center gap-1 border-t border-border pt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Math.round(Number(custom));
            if (Number.isFinite(v)) onChange(Math.min(MAX_SPEED_MS, Math.max(MIN_SPEED_MS, v)));
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder="Custom ms" aria-label="Custom speed in milliseconds" className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs tabular-nums" />
          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Set</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function MoreMenu(p: ReplayBarProps) {
  const [jump, setJump] = useState(false);
  const [value, setValue] = useState("");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={btn} aria-label="More replay actions">
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => {
              setValue("");
              setJump(true);
            }}
          >
            Jump to date & time…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!p.canMove || p.playing} onClick={p.onNextDay}>Finish the trading day</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Toolbar</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={p.settings.bar.mode} onValueChange={(v) => p.onBar({ mode: v as ReplayBarSettings["mode"] })}>
            <DropdownMenuRadioItem value="floating">Floating</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="top">Docked top</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="bottom">Docked bottom</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onClick={() => p.onBar({ mode: "floating", x: 0.5, y: 0.9, pinned: false, collapsed: false })}>Reset position</DropdownMenuItem>
          <DropdownMenuItem onClick={() => p.onBar({ visible: false })}>Hide toolbar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {jump && (
        <form
          className="absolute bottom-full right-0 mb-2 flex items-center gap-1 rounded-md border border-white/10 bg-[#1b1c20] p-1.5 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            const m = parseWallClock(value);
            if (m != null) p.onGoTo(m);
            setJump(false);
          }}
        >
          <input type="datetime-local" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Jump to (server time)" className="h-7 rounded-md border border-white/10 bg-transparent px-1.5 text-xs tabular-nums" />
          <button type="submit" className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20">Go</button>
          <button type="button" onClick={() => setJump(false)} className="px-1 text-xs text-muted-foreground">Cancel</button>
        </form>
      )}
    </>
  );
}
