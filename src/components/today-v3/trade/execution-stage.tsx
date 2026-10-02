"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { minutesToTimeString, timeStringToMinutes } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import { WorkspaceNoteField, WorkspacePriceField } from "@/components/journal/workspace/workspace-fields";
import { PartialExitsEditor } from "@/components/journal/workspace/partial-exits-editor";
import { PerformanceExecutionCard, StopLossField } from "@/components/journal/workspace/trade-execution-section";
import { AccountAllocationSection } from "@/components/journal/workspace/account-allocation-section";
import { formatRR } from "@/components/journal/workspace/workspace-ui";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { LimitOverrideField } from "@/components/today-v3/trade/limit-override-field";
import {
  recordEntryAction,
  updateEntryTimeAction,
  updateExecutionConfirmationsAction,
} from "@/actions/today-v3.actions";
import { evaluateNewTradeOverride, type DayUsage } from "@/domain/today/limit-state";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";
import type { TradeLifecycleFactsDTO } from "@/server/services/today-trade.service";

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Today V3 — Execution: what actually happened. Only execution facts:
 * entry time, actual entry, initial → current stop, exits, execution
 * confirmations, notes, accounts. Results (realized R, PnL) are read-only
 * from the canonical Performance engine.
 */
export function ExecutionStage({
  trade,
  facts,
  usage,
  limits,
  propFirmAccounts,
  executions,
}: {
  trade: TradeWorkspaceDTO;
  facts: TradeLifecycleFactsDTO | undefined;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executions: ExecutionDTO[];
}) {
  const entered = trade.actualEntry != null;
  return (
    <div className="space-y-4">
      {entered ? (
        <EnteredPosition trade={trade} />
      ) : (
        <RecordEntry trade={trade} facts={facts} usage={usage} limits={limits} />
      )}

      <ExecutionConfirmations trade={trade} options={facts?.expectedExecution ?? []} />

      {entered && (
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="executionNotes"
          label="Execution notes"
          initialValue={trade.executionNotes}
          placeholder="How did the entry and management actually go?"
        />
      )}

      <details className="group rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs select-none">
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="font-medium">Accounts</span>
          <span className="text-muted-foreground">
            Performance risk {trade.performanceRisk ? `${trade.performanceRisk.riskPercent}% (locked)` : "· default unless overridden before entry"}
          </span>
        </summary>
        <div className="border-t border-border p-3">
          <AccountAllocationSection dateKey={trade.dateKey} tradeId={trade.id} propFirmAccounts={propFirmAccounts} executions={executions} />
        </div>
      </details>
    </div>
  );
}

/** Taking the trade: first actual entry + real Entry Time (+ initial stop). */
function RecordEntry({
  trade,
  facts,
  usage,
  limits,
}: {
  trade: TradeWorkspaceDTO;
  facts: TradeLifecycleFactsDTO | undefined;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [entryTime, setEntryTime] = useState(nowHHMM);
  const [entry, setEntry] = useState("");
  const hasPlannedStop = trade.plannedStopLoss != null;
  const [stop, setStop] = useState(hasPlannedStop ? String(trade.plannedStopLoss) : "");
  const [overrideReason, setOverrideReason] = useState("");
  const [serverOverride, setServerOverride] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const perfRisk = trade.accounts.find((a) => a.kind === "PERFORMANCE")?.riskValue ?? null;
  const override = evaluateNewTradeOverride(usage, limits, perfRisk);
  const needsReason = !facts?.limitOverrideReason && (serverOverride != null || override.required);
  const messages = serverOverride ?? (override.required && !facts?.limitOverrideReason ? override.messages : []);

  const entryNum = entry.trim() === "" ? null : Number(entry);
  const stopNum = stop.trim() === "" ? null : Number(stop);
  const valid =
    entryNum != null &&
    Number.isFinite(entryNum) &&
    /^\d{2}:\d{2}$/.test(entryTime) &&
    (hasPlannedStop || (stopNum != null && Number.isFinite(stopNum))) &&
    (!needsReason || overrideReason.trim() !== "");

  function record() {
    if (entryNum == null) return;
    start(async () => {
      const r = await recordEntryAction(trade.dateKey, trade.id, {
        actualEntry: entryNum,
        entryMinutes: timeStringToMinutes(entryTime),
        actualStopLoss: stopNum,
        limitOverrideReason: overrideReason || null,
      });
      if (!r.success) {
        if (r.override) setServerOverride(r.override.messages);
        toast.error(r.error);
        return;
      }
      toast.success("Entry recorded — the plan is locked and 1R is frozen.");
      router.refresh();
    });
  }

  if (!editable) return <p className="text-sm text-muted-foreground">No entry was recorded.</p>;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Record entry</h4>
        <span className="text-[11px] text-muted-foreground">
          {facts?.hasConfirmedPlan ? "Recording it locks the confirmed plan" : "No confirmed plan — the initial stop is required"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Entry time</span>
          <Input
            type="time"
            value={entryTime}
            onChange={(e) => setEntryTime(e.target.value)}
            suppressHydrationWarning
            className="font-mono tabular-nums"
          />
        </label>
        <label className="space-y-1">
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            Actual entry
            {trade.plannedEntry != null && (
              <button type="button" onClick={() => setEntry(String(trade.plannedEntry))} className="text-primary hover:underline">
                Same as plan ({trade.plannedEntry})
              </button>
            )}
          </span>
          <Input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} className="font-mono tabular-nums" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Initial stop {hasPlannedStop ? "· from plan (editable)" : <span className="text-danger">(required)</span>}
          </span>
          <Input type="number" step="any" value={stop} onChange={(e) => setStop(e.target.value)} className="font-mono tabular-nums" />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The initial stop defines your original risk (1R) and freezes on entry. Moving your stop later changes the current
        stop only.
      </p>
      <LimitOverrideField id={`override-${trade.id}`} messages={needsReason ? messages : []} value={overrideReason} onChange={setOverrideReason} />
      <div className="flex justify-end">
        <Button type="button" onClick={record} disabled={!valid || pending} className="gap-1.5">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Record entry
        </Button>
      </div>
    </div>
  );
}

/** Managing an entered position: entry time, entry, stops, exits, result. */
function EnteredPosition({ trade }: { trade: TradeWorkspaceDTO }) {
  const editable = useWorkspaceEditable();
  const [entryTime, setEntryTime] = useState(minutesToTimeString(trade.executionMinutes));
  const [saving, start] = useTransition();

  function saveEntryTime(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value) || timeStringToMinutes(value) === trade.executionMinutes) return;
    start(async () => {
      const r = await updateEntryTimeAction(trade.dateKey, trade.id, { entryMinutes: timeStringToMinutes(value) });
      if (!r.success) toast.error(r.error);
      else toast.success("Entry time updated.");
    });
  }

  const quickFills = trade.targets.map((t) => ({ label: t.label, price: t.targetPrice, percent: t.plannedClosePercent ?? null }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Entry time</span>
          <div className="flex items-center gap-1.5">
            <Input
              type="time"
              value={entryTime}
              disabled={!editable}
              onChange={(e) => setEntryTime(e.target.value)}
              onBlur={(e) => saveEntryTime(e.target.value)}
              className="font-mono tabular-nums"
            />
            {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
        </label>
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualEntry"
          label="Actual entry"
          initialValue={trade.actualEntry}
          planValue={trade.plannedEntry}
        />
        <StopLossField trade={trade} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2">
        <div>
          <div className="text-[11px] text-muted-foreground">Expected RR</div>
          <div className="font-mono text-sm tabular-nums">{trade.expectedRR != null ? `${trade.expectedRR.toFixed(2)}R` : "No plan"}</div>
        </div>
        <span className="text-muted-foreground">→</span>
        <div>
          <div className="text-[11px] text-muted-foreground">Realized</div>
          <div
            className={cn(
              "font-mono text-sm tabular-nums",
              trade.actualRR == null ? "text-muted-foreground" : trade.actualRR >= 0 ? "text-success" : "text-danger",
            )}
          >
            {trade.actualRR == null ? "Pending" : formatRR(trade.actualRR)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <PerformanceExecutionCard trade={trade} />
        </div>
      </div>

      {trade.actualExit != null && (
        <p className="text-xs text-muted-foreground">
          Single recorded exit: <span className="font-mono text-foreground">{trade.actualExit}</span> (treated as 100% unless
          partial exits are recorded).
        </p>
      )}

      <div className="rounded-xl border border-border p-3">
        <PartialExitsEditor
          dateKey={trade.dateKey}
          tradeId={trade.id}
          title="Exits"
          emptyHint="No exits yet — record each one as it happens; Performance settles when 100% is closed."
          quickFills={quickFills}
        />
      </div>
    </div>
  );
}

/** Execution confirmations — captured in Execution, scored against the
 *  trade's frozen strategy snapshot (the canonical scorer, server-side). */
function ExecutionConfirmations({ trade, options }: { trade: TradeWorkspaceDTO; options: string[] }) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(trade.executionLabels.map((l) => l.name));
  const [pending, start] = useTransition();
  const all = Array.from(new Set([...options, ...selected]));
  if (all.length === 0) return null;

  function toggle(name: string, on: boolean) {
    const next = on ? [...selected, name] : selected.filter((n) => n !== name);
    setSelected(next);
    start(async () => {
      const r = await updateExecutionConfirmationsAction(trade.dateKey, trade.id, { selected: next });
      if (!r.success) toast.error(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Execution confirmations</span>
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {all.map((name) => (
          <label key={name} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(name)} onCheckedChange={(c) => toggle(name, c === true)} disabled={!editable} />
            {name}
          </label>
        ))}
      </div>
      {trade.executionPercent != null && (
        <AdherenceMeter label="Execution adherence" percent={trade.executionPercent} className="max-w-xs" />
      )}
    </div>
  );
}
