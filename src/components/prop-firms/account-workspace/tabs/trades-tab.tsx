"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LineChart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { ExecutionDTO, PropFirmAccountDTO, TrackRecordDTO } from "@/types/prop-firms";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  PLANNED: "outline",
  ALLOCATED: "outline",
  EXECUTED: "secondary",
  PARTIALLY_CLOSED: "secondary",
  CLOSED: "default",
  CANCELLED: "outline",
  MISSED: "outline",
  NOT_TAKEN: "outline",
};

type ResultKind = "win" | "loss" | "breakeven" | "missed" | "open";

/** Semantic result classification (spec §6): green/red/gray/amber, never
 *  inferred from status alone — a CLOSED execution's result comes from its
 *  netPnl, not from being closed. */
function resultKind(execution: ExecutionDTO): ResultKind {
  if (execution.status === "MISSED" || execution.status === "NOT_TAKEN" || execution.status === "CANCELLED") return "missed";
  if (execution.netPnl == null) return "open";
  if (execution.netPnl > 0) return "win";
  if (execution.netPnl < 0) return "loss";
  return "breakeven";
}

const RESULT_LABEL: Record<ResultKind, string> = {
  win: "Win",
  loss: "Loss",
  breakeven: "Breakeven",
  missed: "Missed / cancelled",
  open: "Open",
};

const RESULT_CLASS: Record<ResultKind, string> = {
  win: "text-success",
  loss: "text-danger",
  breakeven: "text-muted-foreground",
  missed: "text-muted-foreground",
  open: "text-muted-foreground",
};

type ResultFilter = "ALL" | "WIN" | "LOSS" | "BREAKEVEN" | "MISSED";

function matchesResultFilter(execution: ExecutionDTO, filter: ResultFilter): boolean {
  if (filter === "ALL") return true;
  const kind = resultKind(execution);
  if (filter === "WIN") return kind === "win";
  if (filter === "LOSS") return kind === "loss";
  if (filter === "BREAKEVEN") return kind === "breakeven";
  return kind === "missed";
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function toneClass(n: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "text-success" : "text-danger";
}

function SummaryPanel({ trackRecord, account, scopeLabel }: { trackRecord: TrackRecordDTO; account: PropFirmAccountDTO; scopeLabel: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Track record summary</h2>
        <span className="text-xs text-muted-foreground">{scopeLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Participating" value={String(trackRecord.totalParticipatingTrades)} />
        <Stat label="Executed" value={String(trackRecord.executedTrades)} />
        <Stat label="Missed/cancelled" value={String(trackRecord.missedOrCancelledTrades)} />
        <Stat label="W / L / BE" value={`${trackRecord.wins} / ${trackRecord.losses} / ${trackRecord.breakeven}`} />
        <Stat label="Win rate" value={trackRecord.winRatePercent != null ? `${trackRecord.winRatePercent.toFixed(0)}%` : "—"} />
        <Stat label="Profit factor" value={trackRecord.profitFactor != null ? trackRecord.profitFactor.toFixed(2) : "—"} />
        <Stat label="Total net PnL" value={formatSignedCurrency(trackRecord.netPnl)} tone={toneClass(trackRecord.netPnl)} />
        <Stat label="Current balance" value={formatCurrency(trackRecord.currentBalance)} />
        <Stat label="ROI" value={trackRecord.roiPercent != null ? `${trackRecord.roiPercent >= 0 ? "+" : ""}${trackRecord.roiPercent.toFixed(1)}%` : "—"} tone={toneClass(trackRecord.roiPercent)} />
        <Stat label="Avg risk %" value={trackRecord.avgRiskPercent != null ? `${trackRecord.avgRiskPercent.toFixed(2)}%` : "—"} />
        <Stat label="Avg realized R" value={trackRecord.avgR != null ? trackRecord.avgR.toFixed(2) : "—"} />
        <Stat label="Total R" value={trackRecord.totalR != null ? `${trackRecord.totalR >= 0 ? "+" : ""}${trackRecord.totalR.toFixed(2)}R` : "—"} tone={toneClass(trackRecord.totalR)} />
        <Stat label="Largest win" value={trackRecord.largestWin != null ? formatSignedCurrency(trackRecord.largestWin) : "—"} tone="text-success" />
        <Stat label="Largest loss" value={trackRecord.largestLoss != null ? formatSignedCurrency(trackRecord.largestLoss) : "—"} tone="text-danger" />
        <Stat label="Max drawdown" value={formatCurrency(trackRecord.maxRealizedDrawdown)} />
        <Stat
          label="Current streak"
          value={trackRecord.currentStreak === 0 ? "—" : `${Math.abs(trackRecord.currentStreak)} ${trackRecord.currentStreak > 0 ? "win" : "loss"}${Math.abs(trackRecord.currentStreak) > 1 ? "s" : ""}`}
          tone={trackRecord.currentStreak > 0 ? "text-success" : trackRecord.currentStreak < 0 ? "text-danger" : ""}
        />
      </div>
      {account.accountCurrency !== "USD" && (
        <p className="mt-2 text-[10px] text-muted-foreground">All figures in {account.accountCurrency} — this account&apos;s own currency.</p>
      )}
    </div>
  );
}

export function TradesTab({
  account,
  executions,
  lifetimeTrackRecord,
  stageTrackRecords,
}: {
  account: PropFirmAccountDTO;
  executions: ExecutionDTO[];
  lifetimeTrackRecord: TrackRecordDTO;
  stageTrackRecords: Record<string, TrackRecordDTO>;
}) {
  const currentStage = account.stages.find((s) => s.status === "ACTIVE") ?? null;

  const [scope, setScope] = useState<string>("LIFETIME");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [strategyFilter, setStrategyFilter] = useState<string>("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState<string>("ALL");

  const strategyOptions = useMemo(
    () => [...new Set(executions.map((e) => e.strategyName).filter((s): s is string => Boolean(s)))].sort(),
    [executions],
  );
  const instrumentOptions = useMemo(() => [...new Set(executions.map((e) => e.assetSymbol))].sort(), [executions]);

  const scopedExecutions = useMemo(() => {
    if (scope === "LIFETIME") return executions;
    return executions.filter((e) => e.accountStageId === scope);
  }, [executions, scope]);

  const filtered = useMemo(() => {
    return scopedExecutions
      .filter((e) => (stageFilter === "ALL" ? true : e.accountStageId === stageFilter))
      .filter((e) => matchesResultFilter(e, resultFilter))
      .filter((e) => (strategyFilter === "ALL" ? true : e.strategyName === strategyFilter))
      .filter((e) => (instrumentFilter === "ALL" ? true : e.assetSymbol === instrumentFilter))
      .filter((e) => (fromDate ? e.tradeDate >= fromDate : true))
      .filter((e) => (toDate ? e.tradeDate <= toDate : true));
  }, [scopedExecutions, stageFilter, resultFilter, strategyFilter, instrumentFilter, fromDate, toDate]);

  const scopeTrackRecord = scope === "LIFETIME" ? lifetimeTrackRecord : (stageTrackRecords[scope] ?? lifetimeTrackRecord);
  const scopeLabel =
    scope === "LIFETIME" ? "Lifetime" : (account.stages.find((s) => s.id === scope)?.name ?? "Stage");

  const scopeOptions: Record<string, string> = {
    LIFETIME: "Lifetime",
    ...Object.fromEntries(account.stages.map((s) => [s.id, `${s.name}${s.id === currentStage?.id ? " (current)" : ""}`])),
  };
  const stageFilterOptions: Record<string, string> = { ALL: "All stages", ...Object.fromEntries(account.stages.map((s) => [s.id, s.name])) };
  const resultFilterOptions: Record<ResultFilter, string> = { ALL: "All results", WIN: "Wins", LOSS: "Losses", BREAKEVEN: "Breakeven", MISSED: "Missed/cancelled" };
  const strategyFilterOptions: Record<string, string> = { ALL: "All strategies", ...Object.fromEntries(strategyOptions.map((s) => [s, s])) };
  const instrumentFilterOptions: Record<string, string> = { ALL: "All instruments", ...Object.fromEntries(instrumentOptions.map((s) => [s, s])) };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Scope</span>
        <Select items={scopeOptions} value={scope} onValueChange={(v) => v && setScope(v)}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(scopeOptions).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SummaryPanel trackRecord={scopeTrackRecord} account={account} scopeLabel={scopeLabel} />

      <div className="glass flex flex-wrap items-center gap-2 rounded-xl p-3">
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-36 text-xs" aria-label="From date" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-36 text-xs" aria-label="To date" />
        {scope === "LIFETIME" && (
          <Select items={stageFilterOptions} value={stageFilter} onValueChange={(v) => v && setStageFilter(v)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(stageFilterOptions).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select items={resultFilterOptions} value={resultFilter} onValueChange={(v) => v && setResultFilter(v as ResultFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(resultFilterOptions).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {strategyOptions.length > 0 && (
          <Select items={strategyFilterOptions} value={strategyFilter} onValueChange={(v) => v && setStrategyFilter(v)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(strategyFilterOptions).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select items={instrumentFilterOptions} value={instrumentFilter} onValueChange={(v) => v && setInstrumentFilter(v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(instrumentFilterOptions).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center">
          <LineChart className="size-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">No trade allocations{executions.length > 0 ? " match these filters" : " yet"}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {executions.length > 0
              ? "Try widening the date range or clearing a filter."
              : "Allocate a Trade Idea to this account from the Journal to see its executions here."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((execution) => {
            const kind = resultKind(execution);
            return (
              <Link
                key={execution.id}
                href={`/journal/${execution.tradeDate}/trades/${execution.tradeId}`}
                className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {execution.assetSymbol}
                    <Badge variant={execution.direction === "LONG" ? "success" : "danger"}>{execution.direction}</Badge>
                    <Badge variant={STATUS_VARIANT[execution.status] ?? "secondary"}>{execution.status.replace(/_/g, " ")}</Badge>
                    <span className={`text-xs font-medium ${RESULT_CLASS[kind]}`}>{RESULT_LABEL[kind]}</span>
                    {execution.isPnlEstimated && <Badge variant="warning">Estimated</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{execution.tradeDate}</span>
                    <span>· {execution.stageName}</span>
                    {execution.strategyName && <span>· {execution.strategyName}</span>}
                    {execution.entryModelName && <span>· {execution.entryModelName}</span>}
                    {execution.riskPercentOfBase != null && <span>· Risk {execution.riskPercentOfBase.toFixed(2)}%</span>}
                    <span>· {formatCurrency(execution.plannedRiskAmount)}</span>
                    {execution.plannedR != null && <span>· Planned {execution.plannedR.toFixed(1)}R</span>}
                  </div>
                  {(execution.balanceBefore != null || execution.balanceAfter != null) && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Balance {execution.balanceBefore != null ? formatCurrency(execution.balanceBefore) : "—"} →{" "}
                      {execution.balanceAfter != null ? formatCurrency(execution.balanceAfter) : "—"}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${RESULT_CLASS[kind]}`}>
                    {execution.netPnl != null ? formatSignedCurrency(execution.netPnl) : "—"}
                  </div>
                  {execution.actualR != null && (
                    <div className="text-xs text-muted-foreground">{execution.actualR >= 0 ? "+" : ""}{execution.actualR.toFixed(2)}R</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
