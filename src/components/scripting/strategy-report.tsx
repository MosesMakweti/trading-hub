"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import type { ScriptBar, StrategyReport } from "@/domain/scripting/runtime";

const num = (n: number, d = 2) => (Number.isFinite(n) ? (Object.is(Math.round(n * 10 ** d), -0) ? 0 : n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const tone = (n: number) => (n > 0 ? "text-emerald-500" : n < 0 ? "text-red-400" : "");

/**
 * Strategy Tester results. Everything here is computed in the browser
 * sandbox from candles the account has already revealed; it is a study
 * tool, not an account result (the page says so).
 */
export function StrategyReportView({ report, bars, priceDigits, context }: { report: StrategyReport; bars: ScriptBar[]; priceDigits: number; context: string }) {
  const metrics = [
    { label: "Net profit", value: num(report.netProfit), tone: tone(report.netProfit) },
    { label: "Trades", value: String(report.totalTrades) },
    { label: "Win rate", value: report.winRate == null ? "—" : `${num(report.winRate, 1)}%` },
    { label: "Profit factor", value: report.profitFactor == null ? "—" : num(report.profitFactor) },
    { label: "Max drawdown", value: num(report.maxDrawdown), tone: report.maxDrawdown > 0 ? "text-red-400" : "" },
    { label: "Gross profit", value: num(report.grossProfit) },
    { label: "Gross loss", value: num(report.grossLoss) },
    { label: "Commission", value: num(report.commissionPaid) },
  ];
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">{context}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{m.label}</dt>
            <dd className={cn("font-mono text-sm tabular-nums", m.tone)}>{m.value}</dd>
          </div>
        ))}
      </dl>
      {report.openPosition && (
        <p className="text-xs text-muted-foreground">
          Open at the last bar: {report.openPosition.side} {num(report.openPosition.qty, 2)} @ {report.openPosition.avgPrice.toFixed(priceDigits)} · open P&L <span className={tone(report.openPosition.openPnl)}>{num(report.openPosition.openPnl)}</span> (not in the totals)
        </p>
      )}
      <EquitySpark equity={report.equity} initial={report.initialCapital} />
      {report.trades.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                {["#", "Side", "Entry", "Exit", "Qty", "P&L", "Exit reason"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {report.trades.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1">{i + 1}</td>
                  <td className="px-2 py-1">{t.side}</td>
                  <td className="whitespace-nowrap px-2 py-1">{bars[t.entryBar] ? formatReplayTime(bars[t.entryBar].time) : t.entryBar} · {t.entryPrice.toFixed(priceDigits)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{bars[t.exitBar] ? formatReplayTime(bars[t.exitBar].time) : t.exitBar} · {t.exitPrice.toFixed(priceDigits)}</td>
                  <td className="px-2 py-1">{num(t.qty, 2)}</td>
                  <td className={cn("px-2 py-1", tone(t.pnl))}>{num(t.pnl)}</td>
                  <td className="px-2 py-1 font-sans text-muted-foreground">{t.exitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EquitySpark({ equity, initial }: { equity: number[]; initial: number }) {
  const path = useMemo(() => {
    const pts = equity.filter(Number.isFinite);
    if (pts.length < 2) return null;
    const step = Math.max(1, Math.floor(pts.length / 400));
    const s = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const min = Math.min(initial, ...s);
    const max = Math.max(initial, ...s);
    const span = max - min || 1;
    const x = (i: number) => (i / (s.length - 1)) * 100;
    const y = (v: number) => 36 - ((v - min) / span) * 34;
    return { d: s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" "), base: y(initial), up: s[s.length - 1] >= initial };
  }, [equity, initial]);
  if (!path) return null;
  return (
    <figure aria-label="Equity curve">
      <svg viewBox="0 0 100 38" preserveAspectRatio="none" className="h-16 w-full">
        <line x1="0" x2="100" y1={path.base} y2={path.base} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
        <path d={path.d} fill="none" stroke={path.up ? "#10b981" : "#f87171"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="sr-only">Equity from the starting capital to the last bar.</figcaption>
    </figure>
  );
}
