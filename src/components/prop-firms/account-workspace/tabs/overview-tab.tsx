import { Activity } from "lucide-react";

import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { accountRoiPercent, accountTotalCosts } from "@/domain/prop-firms/metrics";
import { RuleHealthBadge } from "@/components/prop-firms/rule-health-badge";
import type { PropFirmAccountDTO, RuleHealthDTO, TrackRecordDTO } from "@/types/prop-firms";

function toneClass(n: number | null): string {
  if (n == null || n === 0) return "text-foreground";
  return n > 0 ? "text-success" : "text-danger";
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="glass rounded-xl p-3.5" title={hint}>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone ?? ""} ${value === "Unavailable" ? "text-sm text-muted-foreground italic" : ""}`}>
        {value}
      </div>
    </div>
  );
}

const DRAWDOWN_RULE_KEYS = ["STATIC_DRAWDOWN", "EOD_TRAILING_DRAWDOWN", "INTRADAY_TRAILING_DRAWDOWN", "MAX_TOTAL_LOSS"];

export function OverviewTab({
  account,
  trackRecord,
  ruleHealthByRuleId,
}: {
  account: PropFirmAccountDTO;
  trackRecord: TrackRecordDTO;
  ruleHealthByRuleId: Record<string, RuleHealthDTO>;
}) {
  const currentStage = account.stages.find((s) => s.status === "ACTIVE") ?? null;
  const pnl = account.currentBalance != null ? account.currentBalance - account.startingBalance : null;
  const roi = pnl != null ? accountRoiPercent(pnl, account.startingBalance) : null;
  const totalCosts = accountTotalCosts(account);
  const totalPayouts = account.payouts.filter((p) => p.status === "PAID").reduce((sum, p) => sum + (p.netReceived ?? p.grossPayout), 0);

  const timeline = account.milestones.slice(0, 6);

  const profitTargetRule = currentStage?.rules.find((r) => r.ruleKey === "PROFIT_TARGET");
  const profitTargetHealth = profitTargetRule ? ruleHealthByRuleId[profitTargetRule.id] : undefined;
  const drawdownRule = currentStage?.rules.find((r) => DRAWDOWN_RULE_KEYS.includes(r.ruleKey));
  const drawdownHealth = drawdownRule ? ruleHealthByRuleId[drawdownRule.id] : undefined;
  const worstRuleState = currentStage
    ? currentStage.rules
        .map((r) => ruleHealthByRuleId[r.id])
        .filter((h): h is RuleHealthDTO => h != null && ["SAFE", "APPROACHING", "CRITICAL", "BREACHED"].includes(h.state))
        .sort((a, b) => ["SAFE", "APPROACHING", "CRITICAL", "BREACHED"].indexOf(b.state) - ["SAFE", "APPROACHING", "CRITICAL", "BREACHED"].indexOf(a.state))[0]
    : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current stage" value={currentStage?.name ?? "—"} />
        <Stat label="Balance" value={account.currentBalance != null ? formatCurrency(account.currentBalance) : "—"} />
        <Stat label="Equity" value={account.currentEquity != null ? formatCurrency(account.currentEquity) : "—"} />
        <Stat label="P&L" value={pnl != null ? formatSignedCurrency(pnl) : "—"} tone={toneClass(pnl)} />
        <Stat
          label="ROI"
          value={roi != null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
          tone={toneClass(roi)}
        />
        <Stat label="Total costs" value={formatCurrency(totalCosts)} />
        <Stat label="Total payouts" value={formatCurrency(totalPayouts)} />
        <div className="glass rounded-xl p-3.5">
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Rule health</div>
          <div className="mt-1"><RuleHealthBadge health={worstRuleState} /></div>
        </div>
        <div className="glass rounded-xl p-3.5">
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Profit target progress</div>
          <div className="mt-1">
            {profitTargetHealth ? <RuleHealthBadge health={profitTargetHealth} /> : <span className="text-sm text-muted-foreground italic">No profit target rule</span>}
          </div>
        </div>
        <div className="glass rounded-xl p-3.5">
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Drawdown room</div>
          <div className="mt-1">
            {drawdownHealth ? <RuleHealthBadge health={drawdownHealth} /> : <span className="text-sm text-muted-foreground italic">No drawdown rule</span>}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="mb-3 text-sm font-medium">Track record</h2>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground uppercase">Win rate</div>
            <div className="mt-0.5 font-medium">{trackRecord.winRatePercent != null ? `${trackRecord.winRatePercent.toFixed(0)}%` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Avg R</div>
            <div className="mt-0.5 font-medium">{trackRecord.avgR != null ? trackRecord.avgR.toFixed(2) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Profit factor</div>
            <div className="mt-0.5 font-medium">{trackRecord.profitFactor != null ? trackRecord.profitFactor.toFixed(2) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Trades (W/L/BE)</div>
            <div className="mt-0.5 font-medium">{trackRecord.wins}/{trackRecord.losses}/{trackRecord.breakeven}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Max drawdown</div>
            <div className="mt-0.5 font-medium">{formatCurrency(trackRecord.maxRealizedDrawdown)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Current drawdown</div>
            <div className="mt-0.5 font-medium">{formatCurrency(trackRecord.currentDrawdown)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Longest win streak</div>
            <div className="mt-0.5 font-medium">{trackRecord.longestWinStreak}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase">Trading days</div>
            <div className="mt-0.5 font-medium">{trackRecord.tradingDaysCompleted}</div>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Timeline</h2>
          <Activity className="size-4 text-muted-foreground" />
        </div>
        {timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No activity recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {timeline.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs">
                <span className="font-medium">{m.title ?? m.type.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{formatDate(m.achievedAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {account.notes && (
        <div className="glass rounded-2xl p-4">
          <h2 className="mb-1.5 text-sm font-medium">Notes</h2>
          <p className="text-xs text-muted-foreground">{account.notes}</p>
        </div>
      )}
    </div>
  );
}
