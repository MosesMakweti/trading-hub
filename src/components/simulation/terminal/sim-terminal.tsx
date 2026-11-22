"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ArrowLeft, FastForward, Loader2, Pause, Play, Redo2, SkipForward, StepForward } from "lucide-react";
import { LineStyle, type IPriceLine } from "lightweight-charts";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/backtesting/button-link";
import { cn } from "@/lib/utils";
import { ReplayChart, type CrosshairInfo, type ReplayChartHandle } from "@/components/native-replay/chart/replay-chart";
import { fromWire } from "@/domain/native-replay/chart-model";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { advanceSimClockAction, getSimAccountStateAction, getSimCandlesAction, startSimClockAction } from "@/actions/simulation.actions";
import type { SimAccountStateDTO } from "@/types/simulation";
import { fmtMoney, fmtWallClock, pnlTone } from "../format";
import { OrderTicket } from "./order-ticket";
import { TradeDock } from "./trade-dock";
import { QuickObservation, type StudyOption } from "../studies/quick-observation";
import { PropRulesPanel } from "../prop/prop-rules-panel";

const TIMEFRAMES: ReplayTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const SPEEDS = [1, 5, 15, 60] as const;
type Speed = (typeof SPEEDS)[number];
type Command = { kind: "BARS"; count: number } | { kind: "CANDLE"; timeframe: ReplayTimeframe } | { kind: "SEEK"; to: number } | { kind: "NEXT_DAY" };

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-500",
  CREATED: "border-border text-muted-foreground",
  BREACHED: "border-red-400/50 text-red-400",
  FAILED: "border-red-400/50 text-red-400",
  PASSED: "border-sky-400/50 text-sky-400",
  COMPLETED: "border-sky-400/50 text-sky-400",
};

/**
 * The shared trading terminal (Strategy Lab and Prop Firm Simulator).
 *
 * Server wins: the chart, quotes, positions and money are re-read from the
 * server's reply after every replay step and every order — nothing is
 * computed or advanced optimistically in the browser, and the chart only
 * ever holds candles up to the account's clock.
 */
export function SimTerminal({ initialState, backHref, studies, resultsHref }: { initialState: SimAccountStateDTO; backHref: string; studies?: StudyOption[]; resultsHref?: string }) {
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState(initialState);
  const [symbol, setSymbol] = useState(initialState.assets[0]);
  const [timeframe, setTimeframe] = useState<ReplayTimeframe>("M15");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [jumpTo, setJumpTo] = useState("");
  const [following, setFollowing] = useState(true);
  const [hover, setHover] = useState<EngineCandle | null>(null);
  const chartRef = useRef<ReplayChartHandle>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);
  const viewRef = useRef({ symbol, timeframe });
  useEffect(() => {
    viewRef.current = { symbol, timeframe };
  }, [symbol, timeframe]);

  const quote = state.quotes.find((q) => q.symbol === symbol);
  const priceScale = quote?.priceScale ?? 5;
  const started = state.clock != null;
  const tradable = started && state.status === "ACTIVE";
  const canMove = tradable && !state.clock?.atPeriodEnd;

  const loadCandles = useCallback(
    async (fit: boolean) => {
      const view = viewRef.current;
      const res = await getSimCandlesAction({ accountId: state.id, symbol: view.symbol, timeframe: view.timeframe, limit: 500 });
      if (!res.success) return toast.error(res.error);
      if (viewRef.current.symbol !== view.symbol || viewRef.current.timeframe !== view.timeframe) return; // view changed meanwhile
      chartRef.current?.setCandles(res.candles.candles.map((c) => fromWire(c, res.candles.priceScale)), { fit });
    },
    [state.id],
  );

  useEffect(() => {
    if (started) void loadCandles(true);
  }, [started, symbol, timeframe, loadCandles]);

  // Entry / SL / TP / pending lines for the viewed instrument.
  useEffect(() => {
    const series = chartRef.current?.series();
    if (!series) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    const add = (price: string | null, color: string, title: string, style = LineStyle.Solid) => {
      if (price == null) return;
      linesRef.current.push(series.createPriceLine({ price: Number(price), color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    };
    for (const p of state.positions.filter((x) => x.symbol === symbol)) {
      add(p.entryPrice, "#94a3b8", `${p.side === "BUY" ? "Buy" : "Sell"} ${p.remainingQuantity}`);
      add(p.stopLoss, "#f87171", "SL", LineStyle.Dashed);
      add(p.takeProfit, "#34d399", "TP", LineStyle.Dashed);
    }
    for (const o of state.orders.filter((x) => x.symbol === symbol)) add(o.price, "#fbbf24", `${o.side === "BUY" ? "Buy" : "Sell"} ${o.type.toLowerCase()} ${o.quantity}`, LineStyle.Dotted);
  }, [state, symbol]);

  const run = useCallback(
    async (command: Command): Promise<boolean> => {
      const res = await advanceSimClockAction({ accountId: state.id, command, commandId: crypto.randomUUID() });
      if (!res.success) {
        toast.error(res.error);
        return false;
      }
      setState(res.state);
      if (res.outcome.halted) {
        const msg = { PASSED: "Phase passed — the next stage is ready in the challenge history.", BREACHED: `Breached: ${res.state.statusReason ?? "a rule was broken"}`, FAILED: res.state.statusReason ?? "Phase failed." }[res.state.status as "PASSED" | "BREACHED" | "FAILED"];
        if (msg) (res.state.status === "PASSED" ? toast.success : toast.error)(msg, { duration: 8000 });
      }
      if (res.outcome.filledOrders > 0) toast.message(`${res.outcome.filledOrders} order${res.outcome.filledOrders === 1 ? "" : "s"} filled`);
      if (res.outcome.closedPositions > 0) toast.message(`${res.outcome.closedPositions} position${res.outcome.closedPositions === 1 ? "" : "s"} closed`);
      if (res.outcome.moved) await loadCandles(false);
      return res.outcome.moved && res.state.status === "ACTIVE" && !res.state.clock?.atPeriodEnd;
    },
    [state.id, loadCandles],
  );

  const step = async (command: Command) => {
    if (busy || playingRef.current) return;
    setBusy(true);
    await run(command);
    setBusy(false);
  };

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    while (playingRef.current) {
      const t0 = performance.now();
      const more = await run({ kind: "BARS", count: speedRef.current });
      if (!more) break;
      const wait = 700 - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    playingRef.current = false;
    setPlaying(false);
  }, [run]);

  useEffect(() => () => void (playingRef.current = false), []);

  const refreshState = useCallback(async () => {
    const res = await getSimAccountStateAction({ accountId: state.id });
    if (res.success) setState(res.state);
  }, [state.id]);

  const start = async () => {
    setBusy(true);
    const res = await startSimClockAction({ accountId: state.id });
    setBusy(false);
    if (!res.success) return toast.error(res.error);
    setState(res.state);
  };

  // Keyboard: Space play/pause · → +1m · Shift+→ +1 candle · R return to replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[data-sim-side]"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (playingRef.current) pause();
        else if (canMove) void play();
      } else if (e.key === "ArrowRight" && canMove) {
        e.preventDefault();
        void step(e.shiftKey ? { kind: "CANDLE", timeframe: viewRef.current.timeframe } : { kind: "BARS", count: 1 });
      } else if (e.key === "r" || e.key === "R") {
        chartRef.current?.scrollToReplay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onCrosshair = useCallback((info: CrosshairInfo) => setHover(info.candle), []);
  const onNearLeftEdge = useCallback(() => {}, []);
  const onFollowChange = useCallback((f: boolean) => setFollowing(f), []);
  const fmt = (n: number) => (n / 10 ** priceScale).toFixed(priceScale);

  const money = state.money;
  const strip = useMemo(
    () => [
      { label: "Balance", value: fmtMoney(money.balance, state.currency) },
      { label: "Equity", value: fmtMoney(money.equity, state.currency) },
      { label: "Floating", value: fmtMoney(money.floatingPnl, state.currency, { sign: true }), tone: pnlTone(money.floatingPnl) },
      { label: "Realized", value: fmtMoney(money.realizedPnl, state.currency, { sign: true }), tone: pnlTone(money.realizedPnl) },
      { label: "Costs", value: fmtMoney(Number(money.commissions) + Number(money.swaps), state.currency) },
    ],
    [money, state.currency],
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <ButtonLink href={backHref} size="icon-sm" variant="ghost" aria-label="Back">
          <ArrowLeft />
        </ButtonLink>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{state.name}</h1>
            <span className={cn("rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider", STATUS_TONE[state.status] ?? "border-border text-muted-foreground")}>{state.status.toLowerCase()}</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtWallClock(state.period.start)} → {fmtWallClock(state.period.end)} · server time</p>
        </div>
        <div className="mx-1 h-6 w-px bg-border" aria-hidden />
        {state.assets.length > 1 ? (
          <select aria-label="Instrument" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-medium">
            {state.assets.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : (
          <span className="text-xs font-medium">{symbol}</span>
        )}
        <div role="group" aria-label="Timeframe" className="flex items-center rounded-md border border-border">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" aria-pressed={timeframe === tf} onClick={() => setTimeframe(tf)} className={cn("h-6 px-1.5 font-mono text-[11px] first:rounded-l-md last:rounded-r-md", timeframe === tf ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {tf}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs tabular-nums" aria-live="polite" title="Replay time (broker server clock)">
            {state.clock ? fmtWallClock(state.clock.time) : "Not started"}
          </span>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "BARS", count: 1 })} title="Advance one minute (→)"><StepForward /> 1m</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "BARS", count: 5 })}>5m</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "CANDLE", timeframe })} title={`Finish the current ${timeframe} candle (Shift+→)`}><SkipForward /> Candle</Button>
          <Button size="sm" variant="ghost" disabled={!canMove || busy || playing} onClick={() => void step({ kind: "NEXT_DAY" })} title="Finish the trading day"><FastForward /> Day</Button>
          <Button size="sm" variant={playing ? "secondary" : "outline"} disabled={!canMove && !playing} onClick={() => (playing ? pause() : void play())} aria-pressed={playing} title="Play / pause (Space)">
            {playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}
          </Button>
          <div role="group" aria-label="Replay speed (minutes per step)" className="flex items-center rounded-md border border-border">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => { speedRef.current = s; setSpeed(s); }} className={cn("h-6 px-1.5 text-[11px] tabular-nums first:rounded-l-md last:rounded-r-md", speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {s}m
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const to = parseWallClock(jumpTo);
              if (to == null) return toast.error("Pick a date and time to jump to.");
              void step({ kind: "SEEK", to });
            }}
          >
            <input type="datetime-local" aria-label="Jump to (server time)" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs tabular-nums" />
            <Button type="submit" size="sm" variant="outline" disabled={!canMove || busy || playing || !jumpTo}>Jump</Button>
          </form>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Working" />}
          {resultsHref && <ButtonLink href={resultsHref} size="sm" variant="ghost">Results</ButtonLink>}
        </div>
      </header>

      {/* ── Account strip ───────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-4 py-1.5" aria-label="Account">
        {strip.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
            <span className={cn("font-mono text-sm tabular-nums", s.tone)}>{s.value}</span>
          </div>
        ))}
        {state.statusReason && <span className="text-xs text-red-400">{state.statusReason}</span>}
      </div>

      {/* ── Chart + side panel ──────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label={`${symbol} chart`}>
          {started && (
            <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] tabular-nums">
              <span className="font-sans text-xs font-semibold">{symbol} · {timeframe}</span>
              {hover && (
                <>
                  <span>O {fmt(hover.open)}</span><span>H {fmt(hover.high)}</span><span>L {fmt(hover.low)}</span><span>C {fmt(hover.close)}</span>
                  {hover.state === "FORMING" && <span className="font-sans text-muted-foreground">forming</span>}
                </>
              )}
            </div>
          )}
          <ReplayChart ref={chartRef} theme={resolvedTheme} priceScale={priceScale} showVolume={false} onCrosshair={onCrosshair} onNearLeftEdge={onNearLeftEdge} onFollowChange={onFollowChange} />
          {!following && started && (
            <Button type="button" size="sm" variant="secondary" className="absolute bottom-4 right-16 z-20 shadow" onClick={() => chartRef.current?.scrollToReplay()} title="Return to the replay position (R)">
              <Redo2 /> Return to replay
            </Button>
          )}
          {state.clock?.atPeriodEnd && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-sm" role="status">
              End of this account&apos;s historical period.
            </div>
          )}
          {!started && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-background/80 p-6">
              <div className="max-w-sm space-y-3 text-center">
                <h2 className="text-base font-semibold">Ready to replay</h2>
                <p className="text-sm text-muted-foreground">
                  The chart starts at the first bar of {fmtWallClock(state.period.start)}. From then on time only moves forward, and this account&apos;s data and costs are locked.
                </p>
                <Button onClick={() => void start()} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Start replay</Button>
              </div>
            </div>
          )}
        </main>

        <aside data-sim-side aria-label="Trade" className="flex w-[19rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-3 max-md:hidden">
          <OrderTicket state={state} quote={quote} disabled={!tradable || playing} onPlaced={setState} />
          {studies && started && <QuickObservation state={state} studies={studies} timeframe={timeframe} />}
          {state.product === "PROP_FIRM" && <PropRulesPanel state={state} onPaidOut={() => void refreshState()} />}
        </aside>
      </div>

      {/* ── Dock ─────────────────────────────────────────────────────────── */}
      <div className="h-56 shrink-0 border-t border-border">
        <TradeDock state={state} readOnly={!tradable} onState={setState} />
      </div>
    </div>
  );
}
