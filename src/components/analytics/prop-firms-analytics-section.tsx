import { cn } from "@/lib/utils";
import type { PropFirmAnalyticsSummary } from "@/server/services/prop-firms-analytics.service";

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneySigned = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-semibold tabular-nums", tone === "success" && "text-success", tone === "danger" && "text-danger")}>
        {value}
      </div>
    </div>
  );
}

function PerfTable({ title, rows }: { title: string; rows: { label: string; trades: number; netPnl: number; winRate: number | null; avgR: number | null }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">Label</th>
              <th className="py-2 pr-4 text-right font-normal">Trades</th>
              <th className="py-2 pr-4 text-right font-normal">Win Rate</th>
              <th className="py-2 pr-4 text-right font-normal">Avg R</th>
              <th className="py-2 text-right font-normal">Net PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/50 last:border-0">
                <td className="py-2.5 pr-4 font-medium">{r.label}</td>
                <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{r.trades}</td>
                <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{r.avgR == null ? "—" : `${r.avgR.toFixed(2)}R`}</td>
                <td className={cn("py-2.5 text-right font-medium tabular-nums", r.netPnl > 0 && "text-success", r.netPnl < 0 && "text-danger")}>
                  {moneySigned(r.netPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PropFirmsAnalyticsSection({ data }: { data: PropFirmAnalyticsSummary }) {
  const hasAnyData =
    data.performanceByFirm.length > 0 || data.stageFailureReasons.length > 0 || data.paidPayoutsCount > 0;
  if (!hasAnyData) return null;

  return (
    <section className="space-y-3">
      <SectionHeading title="Prop Firms Performance" hint="from account executions — separate from the Performance Account above" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Challenge pass rate" value={data.challengePassRatePercent == null ? "—" : `${data.challengePassRatePercent.toFixed(0)}%`} />
        <Stat label="Avg time to pass" value={data.avgTimeToPassDays == null ? "—" : `${data.avgTimeToPassDays.toFixed(1)}d`} />
        <Stat label="Net prop-firm profit" value={moneySigned(data.netPropFirmProfit)} tone={data.netPropFirmProfit >= 0 ? "success" : "danger"} />
        <Stat
          label="Trader investment ROI"
          value={data.traderInvestmentRoiPercent == null ? "—" : `${data.traderInvestmentRoiPercent >= 0 ? "+" : ""}${data.traderInvestmentRoiPercent.toFixed(1)}%`}
          tone={data.traderInvestmentRoiPercent != null ? (data.traderInvestmentRoiPercent >= 0 ? "success" : "danger") : undefined}
        />
        <Stat label="Paid payouts" value={`${data.paidPayoutsCount} · ${money(data.paidPayoutsTotal)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PerfTable title="Performance by firm" rows={data.performanceByFirm} />
        <PerfTable title="Performance by account" rows={data.performanceByAccount} />
        <PerfTable title="CFD vs Futures" rows={data.performanceByMarketCategory} />
        <PerfTable title="Funded vs Challenge" rows={data.performanceByFundedOrChallenge} />
      </div>

      {data.riskAllocationVsOutcome.length > 0 && (
        <div className="glass space-y-3 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-muted-foreground">Risk allocation vs. outcome</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.riskAllocationVsOutcome.map((b) => (
              <div key={b.bucketLabel} className="rounded-lg border border-border p-3 text-xs">
                <div className="font-medium">{b.bucketLabel}</div>
                <div className="mt-1 text-muted-foreground">{b.trades} trades</div>
                <div className="text-muted-foreground">{b.winRate != null ? `${b.winRate.toFixed(0)}% win rate` : "—"}</div>
                <div className="text-muted-foreground">{b.avgActualR != null ? `${b.avgActualR.toFixed(2)}R avg` : "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(data.stageFailureReasons.length > 0 || data.ruleBreachFrequency.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.stageFailureReasons.length > 0 && (
            <div className="glass space-y-2 rounded-2xl p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Stage failure reasons</h3>
              {data.stageFailureReasons.map((r) => (
                <div key={r.reason} className="flex items-center justify-between text-xs">
                  <span>{r.reason}</span>
                  <span className="font-medium text-muted-foreground">{r.count}</span>
                </div>
              ))}
            </div>
          )}
          {data.ruleBreachFrequency.length > 0 && (
            <div className="glass space-y-2 rounded-2xl p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Rule breach frequency</h3>
              {data.ruleBreachFrequency.map((r) => (
                <div key={r.ruleKey} className="flex items-center justify-between text-xs">
                  <span>{r.ruleKey.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="font-medium text-danger">{r.breachCount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
