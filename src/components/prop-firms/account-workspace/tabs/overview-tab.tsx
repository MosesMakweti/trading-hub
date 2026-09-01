import { Activity } from "lucide-react";

import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { accountRoiPercent, accountTotalCosts } from "@/domain/prop-firms/metrics";
import { RuleHealthBadge } from "@/components/prop-firms/rule-health-badge";
import { AccountBalanceCurve, ledgerEntriesToBalanceEvents } from "@/components/prop-firms/account-balance-curve";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { CountUp, type CountUpConfig } from "@/components/analytics/count-up";
import type { LedgerEntryDTO, PropFirmAccountDTO, RuleHealthDTO, TrackRecordDTO } from "@/types/prop-firms";

function toneClass(n: number | null): string {
  if (n == null || n === 0) return "text-foreground";
  return n > 0 ? "text-success" : "text-danger";
}

function countOf(v: number | null, config: Omit<CountUpConfig, "value">): CountUpConfig | undefined {
  return v == null ? undefined : { value: v, ...config };
}

function Stat({
  label,
  value,
  count,
  tone,
  hint,
}: {
  label: string;
  value: string;
  count?: CountUpConfig;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="glass rounded-xl p-3.5" title={hint}>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone ?? ""} ${value === "Unavailable" ? "text-sm text-muted-foreground italic" : ""}`}>
        {count ? <CountUp {...count} /> : value}
      </div>
    </div>
  );
}

/** A rule-health tile: a compact ring for `percentConsumed` (the one
 *  naturally 0-100% number on a RuleHealthDTO) with the status badge below
 *  it, or the badge alone when there's nothing to show a ring for. */
function RuleHealthTile({ label, health }: { label: string; health: RuleHealthDTO | undefined }) {
  const ringTone =
    health?.state === "BREACHED" || health?.state === "CRITICAL"
      ? "danger"
      : health?.state === "APPROACHING"
        ? "warning"
        : health?.state === "SAFE" || health?.state === "TARGET_REACHED"
          ? "success"
          : "muted";

  return (
    <div className="glass flex items-center gap-3 rounded-xl p-3.5">
      {health?.percentConsumed != null ? (
        <ProgressRing value={health.percentConsumed} size={52} stroke={5} tone={ringTone} />
      ) : (
        <div className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Activity className="size-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="mt-1"><RuleHealthBadge health={health} /></div>
      </div>
    </div>
  );
}

const DRAWDOWN_RULE_KEYS = ["STATIC_DRAWDOWN", "EOD_TRAILING_DRAWDOWN", "INTRADAY_TRAILING_DRAWDOWN", "MAX_TOTAL_LOSS"];

export function OverviewTab({
  account,
  trackRecord,
  ruleHealthByRuleId,
  ledger,
}: {
  account: PropFirmAccountDTO;
  trackRecord: TrackRecordDTO;
  ruleHealthByRuleId: Record<string, RuleHealthDTO>;
  ledger: LedgerEntryDTO[];
}) {
  const currentStage = account.stages.find((s) => s.status === "ACTIVE") ?? null;
  const pnl = account.currentBalance != null ? account.currentBalance - account.startingBalance : null;
  const roi = pnl != null ? accountRoiPercent(pnl, account.startingBalance) : null;
  const totalCosts = accountTotalCosts(account);
  const totalPayouts = account.payouts.filter((p) => p.status === "PAID").reduce((sum, p) => sum + (p.netReceived ?? p.grossPayout), 0);

  const timeline = account.milestones.slice(0, 6);

  const stageMarkers = account.stages
    .filter((s) => s.startDate)
    .map((s) => ({ at: s.startDate as string, label: s.name }));

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
        <Stat
          label="Balance"
          value={account.currentBalance != null ? formatCurrency(account.currentBalance) : "—"}
          count={countOf(account.currentBalance, { decimals: 2, prefix: "$", grouping: true })}
        />
        <Stat
          label="Equity"
          value={account.currentEquity != null ? formatCurrency(account.currentEquity) : "—"}
          count={countOf(account.currentEquity, { decimals: 2, prefix: "$", grouping: true })}
        />
        <Stat
          label="P&L"
          value={pnl != null ? formatSignedCurrency(pnl) : "—"}
          count={countOf(pnl, { decimals: 2, prefix: "$", grouping: true, signed: true })}
          tone={toneClass(pnl)}
        />
        <Stat
          label="ROI"
          value={roi != null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
          count={countOf(roi, { decimals: 1, suffix: "%", signed: true })}
          tone={toneClass(roi)}
        />
        <Stat
          label="Total costs"
          value={formatCurrency(totalCosts)}
          count={countOf(totalCosts, { decimals: 2, prefix: "$", grouping: true })}
        />
        <Stat
          label="Total payouts"
          value={formatCurrency(totalPayouts)}
          count={countOf(totalPayouts, { decimals: 2, prefix: "$", grouping: true })}
        />
        <div className="glass flex items-center gap-3 rounded-xl p-3.5">
          <div className="min-w-0">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Rule health</div>
            <div className="mt-1"><RuleHealthBadge health={worstRuleState} /></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RuleHealthTile label="Profit target progress" health={profitTargetHealth} />
        <RuleHealthTile label="Drawdown room used" health={drawdownHealth} />
      </div>

      <AccountBalanceCurve
        events={ledgerEntriesToBalanceEvents(ledger)}
        startingBalance={account.startingBalance}
        accountCurrency={account.accountCurrency}
        stageMarkers={stageMarkers}
        subtitle="Progressive balance since the account opened"
        showSummary={false}
        height={220}
      />

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
