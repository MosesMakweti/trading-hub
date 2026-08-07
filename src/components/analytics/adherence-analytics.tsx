import { Tag, colorForName } from "@/components/ui/tag";
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

      {board.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Confluence win rates</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium">Confluence</th>
                  <th className="pb-1.5 text-right font-medium">Trades</th>
                  <th className="pb-1.5 text-right font-medium">W / L</th>
                  <th className="pb-1.5 text-right font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {board.map((c) => (
                  <tr key={c.name} className="border-t border-border/60">
                    <td className="py-1.5">
                      <Tag color={colorForName(c.name)}>{c.name}</Tag>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{c.trades}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {c.wins} / {c.losses}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {c.winRate == null ? "—" : `${c.winRate.toFixed(1)}%`}
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
