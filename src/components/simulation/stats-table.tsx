import { cn } from "@/lib/utils";
import type { GroupStats, SampleQuality, SetupStats } from "@/domain/simulation/study-stats";
import { fmtR, pnlTone } from "./format";

const SAMPLE: Record<SampleQuality, { label: string; tone: string; hint: string }> = {
  NONE: { label: "No trades", tone: "text-muted-foreground", hint: "No executed trade with a result yet." },
  INSUFFICIENT: { label: "Too few", tone: "text-amber-500", hint: "Fewer than 10 resolved trades — the ratios are anecdotal." },
  LOW: { label: "Small", tone: "text-amber-500/80", hint: "10–29 resolved trades — treat the ratios as early evidence." },
  ADEQUATE: { label: "30+", tone: "text-emerald-500", hint: "30 or more resolved trades." },
};

export function SampleBadge({ sample }: { sample: SampleQuality }) {
  const s = SAMPLE[sample];
  return (
    <span title={s.hint} className={cn("rounded border border-current/30 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider", s.tone)}>
      {s.label}
    </span>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const num = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

/** Headline numbers for a set of observations or trades. */
export function StatsKpis({ stats }: { stats: SetupStats }) {
  const items = [
    { label: "Occurrences", value: String(stats.occurrences) },
    { label: "Traded", value: `${stats.executed}${stats.resolved !== stats.executed ? ` (${stats.resolved} closed)` : ""}` },
    { label: "Win rate", value: pct(stats.winRate) },
    { label: "Net R", value: stats.netR == null ? "—" : fmtR(stats.netR), tone: pnlTone(stats.netR) },
    { label: "Expectancy", value: stats.expectancy == null ? "—" : fmtR(stats.expectancy), tone: pnlTone(stats.expectancy) },
    { label: "Profit factor", value: num(stats.profitFactor) },
    { label: "Avg win / loss", value: stats.averageWinR == null && stats.averageLossR == null ? "—" : `${num(stats.averageWinR)} / ${num(stats.averageLossR)}` },
    { label: "Max drawdown", value: stats.maxDrawdownR == null ? "—" : fmtR(stats.maxDrawdownR), tone: stats.maxDrawdownR ? "text-red-400" : undefined },
    { label: "Streaks W / L", value: `${stats.longestWinStreak} / ${stats.longestLossStreak}` },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SampleBadge sample={stats.sample} />
        <span className="text-xs text-muted-foreground">{SAMPLE[stats.sample].hint}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{i.label}</dt>
            <dd className={cn("font-mono text-sm tabular-nums", i.tone)}>{i.value}</dd>
          </div>
        ))}
      </dl>
      {stats.selfReported.count > 0 && (
        <p className="text-xs text-muted-foreground">
          Not traded: {stats.selfReported.count} observation{stats.selfReported.count === 1 ? "" : "s"} with a self-reported result ({stats.selfReported.wins} would have won, {stats.selfReported.losses} lost
          {stats.selfReported.netR != null ? `, ${fmtR(stats.selfReported.netR)} self-reported` : ""}). Not included above.
        </p>
      )}
    </div>
  );
}

const th = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 font-mono text-xs tabular-nums whitespace-nowrap";

/** A breakdown (by setup, instrument, hour…) with the sample size of every row. */
export function StatsTable({ title, groups, emptyText = "Nothing to compare yet." }: { title: string; groups: GroupStats[]; emptyText?: string }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr>
                <th className={th}>{title.replace(/^By /, "")}</th>
                <th className={th}>Seen</th><th className={th}>Traded</th><th className={th}>Win rate</th><th className={th}>Net R</th>
                <th className={th}>Expectancy</th><th className={th}>PF</th><th className={th}>Max DD</th><th className={th}>Sample</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-border/60">
                  <td className={cn(td, "font-sans font-medium")}>{g.label}</td>
                  <td className={td}>{g.stats.occurrences}</td>
                  <td className={td}>{g.stats.executed}</td>
                  <td className={td}>{pct(g.stats.winRate)}</td>
                  <td className={cn(td, pnlTone(g.stats.netR))}>{g.stats.netR == null ? "—" : fmtR(g.stats.netR)}</td>
                  <td className={cn(td, pnlTone(g.stats.expectancy))}>{g.stats.expectancy == null ? "—" : fmtR(g.stats.expectancy)}</td>
                  <td className={td}>{num(g.stats.profitFactor)}</td>
                  <td className={td}>{g.stats.maxDrawdownR == null ? "—" : fmtR(g.stats.maxDrawdownR)}</td>
                  <td className={td}><SampleBadge sample={g.stats.sample} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
