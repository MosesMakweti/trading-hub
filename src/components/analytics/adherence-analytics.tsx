import { Tag, colorForName } from "@/components/ui/tag";
import {
  ConfluenceWinRateChart,
  SetupQualityChart,
  SetupQualityTrendChart,
} from "@/components/analytics/adherence-charts";
import { RowBar } from "@/components/analytics/row-bar";
import type { AdherenceSummary } from "@/domain/performance/adherence-analytics";

function fmtPercent(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function fmtCount(v: number | null) {
  return v == null ? "—" : v.toFixed(1);
}

// Strategy-adherence analytics — a discipline lens on the range, NOT a market
// prediction. Averages of the frozen per-trade scores + which confluences show
// up on winning trades.
export function AdherenceAnalytics({ data }: { data: AdherenceSummary }) {
  const board = data.confluenceLeaderboard;

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">Strategy Adherence</h3>
        <p className="text-xs text-muted-foreground/60">
          How closely trades followed their strategy — a discipline measure, not a prediction.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Confluence adherence" value={fmtPercent(data.avgConfluenceAdherence)} />
        <Stat label="Execution adherence" value={fmtPercent(data.avgExecutionAdherence)} />
        <Stat label="Trade quality" value={fmtPercent(data.avgTradeQuality)} />
        <Stat label="Avg confluences · winners" value={fmtCount(data.avgConfluencesOnWinners)} tone="success" />
        <Stat label="Avg confluences · losers" value={fmtCount(data.avgConfluencesOnLosers)} tone="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Setup quality → win rate
            <span className="ml-1 font-normal text-muted-foreground/50">
              do higher-scored setups win more?
            </span>
          </div>
          <SetupQualityChart data={data.setupQualityBuckets} />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Setup score over time
            <span className="ml-1 font-normal text-muted-foreground/50">avg per month</span>
          </div>
          <SetupQualityTrendChart data={data.setupQualityTrend} />
        </div>
      </div>

      {data.directionSplits.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Long vs short setups
            <span className="ml-1 font-normal text-muted-foreground/50">
              scored against each direction&apos;s eligible confluences
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium">Direction</th>
                  <th className="pb-1.5 text-right font-medium">Trades</th>
                  <th className="pb-1.5 text-right font-medium">W / L</th>
                  <th className="pb-1.5 text-right font-medium">Avg setup score</th>
                  <th className="pb-1.5 text-right font-medium">Confluence adherence</th>
                  <th className="pb-1.5 font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {data.directionSplits.map((d) => (
                  <tr
                    key={d.direction}
                    className="border-t border-border/60 transition-colors hover:bg-accent/50"
                  >
                    <td className="py-1.5">
                      <span
                        className={
                          d.direction === "LONG"
                            ? "inline-flex rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                            : "inline-flex rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger"
                        }
                      >
                        {d.direction === "LONG" ? "Long" : "Short"}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{d.trades}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {d.wins} / {d.losses}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {d.avgSetupScore == null ? "—" : d.avgSetupScore.toFixed(1)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtPercent(d.avgConfluenceAdherence)}
                    </td>
                    <td className="py-1.5">
                      <RowBar percent={d.winRate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.confluenceCombinations.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Best confluence combinations
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium">Combination</th>
                  <th className="pb-1.5 text-right font-medium">Trades</th>
                  <th className="pb-1.5 text-right font-medium">W / L</th>
                  <th className="pb-1.5 font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {data.confluenceCombinations.slice(0, 8).map((combo) => (
                  <tr key={combo.confluences.join("+")} className="border-t border-border/60 transition-colors hover:bg-accent/50">
                    <td className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {combo.confluences.map((name) => (
                          <Tag key={name} color={colorForName(name)}>
                            {name}
                          </Tag>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{combo.trades}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {combo.wins} / {combo.losses}
                    </td>
                    <td className="py-1.5">
                      <RowBar percent={combo.winRate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {board.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Confluence win rates</div>
          <ConfluenceWinRateChart data={board} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium">Confluence</th>
                  <th className="pb-1.5 text-right font-medium">Trades</th>
                  <th className="pb-1.5 text-right font-medium">W / L</th>
                  <th className="pb-1.5 font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {board.map((c) => (
                  <tr key={c.name} className="border-t border-border/60 transition-colors hover:bg-accent/50">
                    <td className="py-1.5">
                      <Tag color={colorForName(c.name)}>{c.name}</Tag>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{c.trades}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {c.wins} / {c.losses}
                    </td>
                    <td className="py-1.5">
                      <RowBar percent={c.winRate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "success"
            ? "text-success text-lg font-semibold tabular-nums"
            : tone === "danger"
              ? "text-danger text-lg font-semibold tabular-nums"
              : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </div>
    </div>
  );
}
