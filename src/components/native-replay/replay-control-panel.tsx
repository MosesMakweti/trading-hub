"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Pause, Play, SkipForward, StepForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { advanceReplayAction, getReplayCandlesAction, initializeReplayAction } from "@/actions/native-replay.actions";
import type { ReplayCandlesResult, ReplayCommand, ReplayStateDTO } from "@/server/services/native-replay/backtest-replay.service";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";

/**
 * Native Replay — TEMPORARY functional replay controls for the Backtesting
 * Session (the full-screen chart workspace replaces this). The server's stored
 * position is the only clock: every control sends a command, and the display
 * shows whatever position the server returns.
 *
 * Playback is browser-driven while the page is open: one command per tick,
 * sequential (never overlapping), batching bars at higher speeds so requests
 * stay ≤ 5/s. Speed changes only the delay — the revealed M1 sequence is the
 * same at every speed.
 */

const TIMEFRAMES: ReplayTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const SPEEDS = [1, 2, 5, 10, 20] as const;

/** 1x = one M1 bar per second. Ticks never faster than 200ms; faster speeds reveal several bars per tick. */
export function playbackPlan(speed: number): { intervalMs: number; barsPerTick: number } {
  const intervalMs = Math.max(200, 1000 / speed);
  return { intervalMs, barsPerTick: Math.max(1, Math.round((speed * intervalMs) / 1000)) };
}

const newCommandId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hhmm = (wallClock: string) => wallClock.slice(11);

function AssetReplay({ initial, dataHref }: { initial: ReplayStateDTO; dataHref: string }) {
  const [state, setState] = useState(initial);
  const [timeframe, setTimeframe] = useState<ReplayTimeframe>("M30");
  const [candles, setCandles] = useState<ReplayCandlesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [jumpTo, setJumpTo] = useState("");
  const playingRef = useRef(false);
  const speedRef = useRef(speed);
  const tfRef = useRef(timeframe);
  const ref = { runId: state.runId, dateKey: state.dateKey, assetSymbol: state.assetSymbol };
  const refKey = JSON.stringify(ref);

  const loadCandles = useCallback(async (tf: ReplayTimeframe) => {
    const res = await getReplayCandlesAction({ ...JSON.parse(refKey), timeframe: tf, limit: 6 });
    if (res.success) setCandles(res.candles);
  }, [refKey]);

  // Initial readout once replay is running.
  const active = state.status === "ACTIVE";
  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const res = await getReplayCandlesAction({ ...JSON.parse(refKey), timeframe: tfRef.current, limit: 6 });
      if (live && res.success) setCandles(res.candles);
    })();
    return () => {
      live = false;
    };
  }, [active, refKey]);

  useEffect(() => () => {
    playingRef.current = false;
  }, []);

  function chooseSpeed(s: (typeof SPEEDS)[number]) {
    speedRef.current = s; // a running playback loop picks it up on its next tick
    setSpeed(s);
  }

  function chooseTimeframe(tf: ReplayTimeframe) {
    // A view change only — the replay position doesn't move.
    tfRef.current = tf;
    setTimeframe(tf);
    void loadCandles(tf);
  }

  async function send(command: ReplayCommand | { kind: "SEEK"; to: string }): Promise<boolean> {
    const res = await advanceReplayAction({ ...ref, command, commandId: newCommandId() });
    if (!res.success) {
      toast.error(res.error);
      return false;
    }
    setState(res.result.state);
    await loadCandles(tfRef.current);
    return res.result.moved;
  }

  async function run(command: Parameters<typeof send>[0]) {
    setBusy(true);
    try {
      await send(command);
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    try {
      while (playingRef.current) {
        const { intervalMs, barsPerTick } = playbackPlan(speedRef.current);
        const started = Date.now();
        const moved = await send({ kind: "BARS", count: barsPerTick });
        if (!moved) break; // end of the simulation day (or an error)
        const wait = intervalMs - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    } finally {
      playingRef.current = false;
      setPlaying(false);
    }
  }

  function pause() {
    // Stops immediately: no further command is sent. A command already in
    // flight completes and its (authoritative) position is shown.
    playingRef.current = false;
    setPlaying(false);
  }

  async function start() {
    setBusy(true);
    const res = await initializeReplayAction(ref);
    setBusy(false);
    if (!res.success) toast.error(res.error);
    else setState(res.state);
  }

  if (state.status === "NO_DATASET") {
    return (
      <p className="text-sm text-muted-foreground">
        No historical data attached for {state.assetSymbol}.{" "}
        <Link href={dataHref} className="underline underline-offset-2">Attach an MT5 M1 dataset</Link>
      </p>
    );
  }
  if (state.status === "NO_BARS_FOR_DATE") {
    return <p className="text-sm text-muted-foreground">The {state.dataset?.symbol} dataset has no bars on {state.dateKey}.</p>;
  }
  if (state.status === "NOT_STARTED") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {state.dataset?.symbol} · {hhmm(state.day!.firstBar)}–{hhmm(state.day!.lastBar)} · {state.day!.barCount} M1 bars
        </span>
        {!state.readOnly && (
          <Button type="button" size="sm" onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            Start replay at {hhmm(state.day!.firstBar)}
          </Button>
        )}
      </div>
    );
  }

  const pos = state.position!;
  const disabled = busy || playing || state.readOnly || pos.atDayEnd;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p aria-live="polite">
          <span className="text-muted-foreground">Replay time </span>
          <span className="font-mono text-base font-semibold tabular-nums">{pos.time.replace("T", " ")}</span>
          <span className="text-xs text-muted-foreground"> (broker/server time)</span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {pos.revealedBarsToday}/{state.day!.barCount} bars revealed · day {hhmm(state.day!.firstBar)}–{hhmm(state.day!.lastBar)}
          {pos.atDayEnd ? " · end of day" : ""}
          {state.readOnly ? " · read-only run" : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run({ kind: "BARS", count: 1 })} aria-label="Advance one M1 bar">
          <StepForward /> +1m
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run({ kind: "BARS", count: 5 })} aria-label="Advance five M1 bars">
          +5
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run({ kind: "CANDLE", timeframe })} aria-label={`Advance one ${timeframe} candle`}>
          <SkipForward /> +1 {timeframe}
        </Button>
        {playing ? (
          <Button type="button" size="sm" onClick={pause}>
            <Pause /> Pause
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={disabled} onClick={play}>
            <Play /> Play
          </Button>
        )}
        <div role="group" aria-label="Replay speed" className="flex rounded-md border border-border">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => chooseSpeed(s)}
              className={cn("px-2 py-1 text-xs tabular-nums", speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {s}x
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{2}:\d{2}$/.test(jumpTo)) void run({ kind: "SEEK", to: `${state.dateKey}T${jumpTo}` });
          }}
        >
          <Input type="time" aria-label="Jump to time" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} className="h-8 w-36" />
          <Button type="submit" size="sm" variant="outline" disabled={disabled || !jumpTo}>
            Jump →
          </Button>
        </form>
      </div>

      <div className="space-y-1">
        <div role="group" aria-label="Timeframe" className="flex flex-wrap gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={timeframe === tf}
              onClick={() => chooseTimeframe(tf)}
              className={cn("rounded px-2 py-0.5 text-xs", timeframe === tf ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {tf}
            </button>
          ))}
        </div>
        {candles && (
          <table className="w-full max-w-xl font-mono text-xs tabular-nums">
            <caption className="sr-only">Latest {timeframe} candles at the replay time</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">{timeframe}</th>
                <th className="text-right font-normal">Open</th>
                <th className="text-right font-normal">High</th>
                <th className="text-right font-normal">Low</th>
                <th className="text-right font-normal">Close</th>
                <th className="text-right font-normal">Bars</th>
                <th className="text-right font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {candles.candles.map((c) => (
                <tr key={c.minute} className={c.state === "FORMING" ? "text-foreground" : "text-muted-foreground"}>
                  <td>{c.time.replace("T", " ").slice(5)}</td>
                  <td className="text-right">{c.open.toFixed(candles.priceScale)}</td>
                  <td className="text-right">{c.high.toFixed(candles.priceScale)}</td>
                  <td className="text-right">{c.low.toFixed(candles.priceScale)}</td>
                  <td className="text-right">{c.close.toFixed(candles.priceScale)}</td>
                  <td className="text-right">{c.barCount}</td>
                  <td className="text-right">{c.state === "FORMING" ? "forming" : "done"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ReplayControlPanel({ states }: { states: ReplayStateDTO[] }) {
  const [asset, setAsset] = useState(states[0]?.assetSymbol ?? null);
  if (states.length === 0 || asset == null) return null;
  const current = states.find((s) => s.assetSymbol === asset) ?? states[0];
  return (
    <section aria-labelledby="replay-heading" className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="replay-heading" className="text-sm font-medium">Native Replay <span className="text-xs font-normal text-muted-foreground">(preview controls)</span></h2>
        {states.length > 1 && (
          <div role="group" aria-label="Asset" className="flex gap-1">
            {states.map((s) => (
              <button
                key={s.assetSymbol}
                type="button"
                aria-pressed={s.assetSymbol === current.assetSymbol}
                onClick={() => setAsset(s.assetSymbol)}
                className={cn("rounded px-2 py-0.5 text-xs", s.assetSymbol === current.assetSymbol ? "bg-muted font-medium" : "text-muted-foreground")}
              >
                {s.assetSymbol}
              </button>
            ))}
          </div>
        )}
      </div>
      <AssetReplay key={`${current.dateKey}|${current.assetSymbol}`} initial={current} dataHref="/backtesting/data" />
    </section>
  );
}
