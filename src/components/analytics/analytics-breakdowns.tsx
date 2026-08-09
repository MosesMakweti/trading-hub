import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { MonthlyReturnsChart } from "@/components/analytics/monthly-returns-chart";
import type { getAnalyticsData } from "@/server/services/analytics.service";

type TradingData = Awaited<ReturnType<typeof getAnalyticsData>>["trading"];
type DayPerf = TradingData["breakdowns"]["dayOfWeek"][number];
type MonthPerf = TradingData["breakdowns"]["monthly"][number];
type LabeledPerf = TradingData["breakdowns"]["longShort"][number];

const money = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const ratio = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
    </div>
  );
}

/** Colors a bar on a 5-tier strength scale (strong/positive/neutral/negative/strong). */
function strengthClass(value: number, maxAbs: number): string {
  if (value === 0 || maxAbs === 0) return "bg-muted-foreground/40";
  const ratioOf = Math.abs(value) / maxAbs;
  if (value > 0) return ratioOf >= 0.66 ? "bg-success" : ratioOf >= 0.33 ? "bg-success/60" : "bg-success/35";
  return ratioOf >= 0.66 ? "bg-danger" : ratioOf >= 0.33 ? "bg-danger/60" : "bg-danger/35";
}

function PerfBar({
  label,
  value,
  maxAbs,
  valueText,
  sub,
}: {
  label: string;
  value: number;
  maxAbs: number;
  valueText: string;
  sub: string;
}) {
  const width = maxAbs > 0 ? Math.max(3, (Math.abs(value) / maxAbs) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-3">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
          <div className={cn("h-full rounded-full transition-all", strengthClass(value, maxAbs))} style={{ width: `${width}%` }} />
        </div>
        <span
          className={cn(
            "text-right text-sm font-medium tabular-nums",
            value > 0 && "text-success",
            value < 0 && "text-danger",
          )}
        >
          {valueText}
        </span>
      </div>
      <div className="pl-[5.75rem] text-xs text-muted-foreground/70">{sub}</div>
    </div>
  );
}

function Histogram({ bars }: { bars: { label: string; count: number; tone: "success" | "danger" | "neutral" }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex h-32 items-end gap-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{b.count}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className={cn(
                "w-full rounded-t-sm",
                b.tone === "danger" ? "bg-danger/70" : b.tone === "success" ? "bg-success/70" : "bg-chart-2",
              )}
              style={{ height: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="text-center text-[9px] leading-tight text-muted-foreground/60">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function pickBy<T>(items: T[], score: (t: T) => number | null): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s != null && s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

/**
 * Phase B breakdowns for the Analytics module — performance by day-of-week, month,
 * direction, session, and hour, plus R-multiple distribution and risk stats. All
 * from `trading.breakdowns` (derived from the same ledger). Trade counts are shown
 * so small samples aren't read as reliable.
 */
export function AnalyticsBreakdowns({ trading }: { trading: TradingData }) {
  const b = trading.breakdowns;
  const dayMaxAbs = Math.max(0, ...b.dayOfWeek.map((d) => Math.abs(d.netPnl)));
  const sessionMaxAbs = Math.max(0, ...b.sessions.map((s) => Math.abs(s.netPnl)));

  const bestDay = pickBy(b.dayOfWeek, (d) => d.netPnl);
  const worstDay = pickBy(b.dayOfWeek, (d) => -d.netPnl);
  const mostActiveDay = pickBy(b.dayOfWeek, (d) => d.trades);
  const bestWinRateDay = pickBy(b.dayOfWeek, (d) => d.winRate);
  const bestExpectancyDay = pickBy(b.dayOfWeek, (d) => d.expectancy);

  const summary: { label: string; day: DayPerf | null; extra?: string }[] = [
    { label: "Best day", day: bestDay, extra: bestDay ? money(bestDay.netPnl) : undefined },
    { label: "Worst day", day: worstDay, extra: worstDay ? money(worstDay.netPnl) : undefined },
    { label: "Most active", day: mostActiveDay, extra: mostActiveDay ? `${mostActiveDay.trades} trades` : undefined },
    { label: "Best win rate", day: bestWinRateDay, extra: bestWinRateDay ? pct(bestWinRateDay.winRate) : undefined },
    { label: "Best expectancy", day: bestExpectancyDay, extra: bestExpectancyDay ? rr(bestExpectancyDay.expectancy) : undefined },
  ];

  return (
    <div className="space-y-8">
      {/* Performance by Day of Week */}
      <section className="space-y-3">
        <SectionHeading title="Performance by Day of Week" hint="net P&L — bar length + color show relative strength" />
        <div className="glass space-y-3 rounded-2xl p-4">
          {b.dayOfWeek.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No trades in this range yet.</p>
          ) : (
            b.dayOfWeek.map((d) => (
              <PerfBar
                key={d.weekday}
                label={d.label.slice(0, 3)}
                value={d.netPnl}
                maxAbs={dayMaxAbs}
                valueText={money(d.netPnl)}
                sub={`${d.trades} trades · ${pct(d.winRate)} win · ${rr(d.avgR)} avg · ${rr(d.expectancy)} exp`}
              />
            ))
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {summary.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="mt-0.5 text-sm font-semibold">{s.day ? s.day.label : "—"}</div>
              {s.extra && <div className="text-xs text-muted-foreground tabular-nums">{s.extra}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Performance by Month */}
      <section className="space-y-3">
        <SectionHeading title="Performance by Month" />
        <MonthlyReturnsChart data={trading.monthlyReturns} />
        {b.monthly.length > 0 && <MonthlyTable months={b.monthly} />}
      </section>

      {/* Risk Analytics */}
      <section className="space-y-3">
        <SectionHeading title="Risk Analytics" />
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="glass flex items-center justify-center rounded-2xl px-8 py-4">
            <ProgressRing value={b.risk.consistency} tone="brand" label="Risk consistency" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard label="Avg Risk / Trade" value={b.risk.avgRisk == null ? "—" : `${b.risk.avgRisk.toFixed(2)}%`} />
            <KpiCard label="Largest Risk" value={b.risk.maxRisk == null ? "—" : `${b.risk.maxRisk.toFixed(2)}%`} />
            <KpiCard label="Recovery Factor" value={ratio(trading.recoveryFactor)} />
            <KpiCard label="Max Drawdown" value={`${trading.maxDrawdownPercent.toFixed(1)}%`} tone="danger" />
            <KpiCard label="Consecutive Wins" value={String(trading.longestWinStreak)} tone="success" />
            <KpiCard label="Consecutive Losses" value={String(trading.longestLossStreak)} tone="danger" />
          </div>
        </div>
        <div className="glass space-y-2 rounded-2xl p-4">
          <div className="text-xs font-medium text-muted-foreground">R-multiple distribution</div>
          <Histogram
            bars={b.rDistribution.map((bucket) => ({
              label: bucket.label,
              count: bucket.count,
              tone: bucket.max <= 0 ? "danger" : bucket.min >= 0 ? "success" : "neutral",
            }))}
          />
        </div>
      </section>

      {/* Distributions — direction, session, hour */}
      <section className="space-y-3">
        <SectionHeading title="Distributions" hint="trade counts shown — small samples aren't reliable" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground">Long vs Short</h3>
            {b.longShort.map((ls) => (
              <DirectionRow key={ls.label} perf={ls} />
            ))}
          </div>
          <div className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground">By session</h3>
            {b.sessions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No trades in this range.</p>
            ) : (
              b.sessions.map((s) => (
                <PerfBar
                  key={s.label}
                  label={s.label}
                  value={s.netPnl}
                  maxAbs={sessionMaxAbs}
                  valueText={money(s.netPnl)}
                  sub={`${s.trades} trades · ${pct(s.winRate)} win · ${rr(s.avgR)} avg`}
                />
              ))
            )}
          </div>
        </div>
        {b.hours.length > 0 && (
          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground">Trades by hour of day</h3>
            <Histogram
              bars={b.hours.map((h) => ({
                label: `${String(h.hour).padStart(2, "0")}h`,
                count: h.trades,
                tone: h.netPnl > 0 ? "success" : h.netPnl < 0 ? "danger" : "neutral",
              }))}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function DirectionRow({ perf }: { perf: LabeledPerf }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
      <span className="font-medium">{perf.label}</span>
      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
        <span>{perf.trades} trades</span>
        <span>{pct(perf.winRate)} win</span>
        <span>{rr(perf.avgR)} avg</span>
        <span className={cn("font-medium", perf.netPnl > 0 && "text-success", perf.netPnl < 0 && "text-danger")}>
          {money(perf.netPnl)}
        </span>
      </div>
    </div>
  );
}

function MonthlyTable({ months }: { months: MonthPerf[] }) {
  return (
    <div className="glass overflow-x-auto rounded-2xl p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Month</th>
            <th className="py-2 pr-4 text-right font-normal">Trades</th>
            <th className="py-2 pr-4 text-right font-normal">Net P&L</th>
            <th className="py-2 pr-4 text-right font-normal">Return</th>
            <th className="py-2 pr-4 text-right font-normal">Win Rate</th>
            <th className="py-2 pr-4 text-right font-normal">Avg R</th>
            <th className="py-2 text-right font-normal">Expectancy</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.monthKey} className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/50">
              <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{monthLabel(m.monthKey)}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{m.trades}</td>
              <td className={cn("py-2.5 pr-4 text-right font-medium tabular-nums", m.netPnl > 0 && "text-success", m.netPnl < 0 && "text-danger")}>
                {money(m.netPnl)}
              </td>
              <td className={cn("py-2.5 pr-4 text-right tabular-nums", m.returnPercent > 0 && "text-success", m.returnPercent < 0 && "text-danger")}>
                {m.returnPercent >= 0 ? "+" : ""}
                {m.returnPercent.toFixed(2)}%
              </td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{pct(m.winRate)}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{rr(m.avgR)}</td>
              <td className="py-2.5 text-right text-muted-foreground tabular-nums">{rr(m.expectancy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
