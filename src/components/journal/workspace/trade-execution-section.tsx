import { Lock, TriangleAlert, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import { cn } from "@/lib/utils";
import { minutesToTimeString } from "@/lib/date";
import { needsExplicitInitialStopConfirmation } from "@/domain/performance/realized-r";
import {
  WorkspaceField,
  formatRR,
  formatCurrency,
  formatSignedCurrency,
} from "@/components/journal/workspace/workspace-ui";
import {
  WorkspaceNoteField,
  WorkspacePriceField,
} from "@/components/journal/workspace/workspace-fields";
import { PartialExitsEditor } from "@/components/journal/workspace/partial-exits-editor";
import { parseSymbol, formatTargetPrice } from "@/domain/trade-plan/instrument-catalog";
import type { TradeWorkspaceDTO } from "@/types/trades";

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  PROP_FIRM: "Prop firm",
  PERSONAL_BROKERAGE: "Brokerage",
};

/** Today V2 Phase 2 §10 — the Performance Account's result, compact and
 *  always-visible in Execution (never buried behind the other, secondary
 *  real-account details — §11). Reuses the exact frozen snapshot fields
 *  (never a second calculation); "Pending" until settled, never a fake $0. */
function PerformanceExecutionCard({ trade }: { trade: TradeWorkspaceDTO }) {
  const risk = trade.performanceRisk;
  if (!risk) return null; // still just an idea — no actual entry has locked a snapshot yet

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 shrink-0 text-primary" />
        <div className="text-sm font-medium">Performance</div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">Risk</div>
          <div className="text-sm tabular-nums">
            {risk.riskPercent}% · {formatCurrency(risk.riskAmount)}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">Realized</div>
          <div
            className={cn(
              "text-sm font-medium tabular-nums",
              risk.realizedR == null ? "text-muted-foreground" : risk.realizedR >= 0 ? "text-success" : "text-danger",
            )}
          >
            {risk.realizedR == null ? "Pending" : formatRR(risk.realizedR)}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">PnL</div>
          <div
            className={cn(
              "text-sm font-medium tabular-nums",
              trade.performancePnlNet == null
                ? "text-muted-foreground"
                : trade.performancePnlNet >= 0
                  ? "text-success"
                  : "text-danger",
            )}
          >
            {trade.performancePnlNet == null ? "Pending" : formatSignedCurrency(trade.performancePnlNet)}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-0.5 text-xs text-muted-foreground">Status</div>
          <div className="text-sm font-medium">{risk.settled ? "Settled" : "Pending"}</div>
        </div>
      </div>
    </div>
  );
}

/** Today V2 Phase 2 §5/§6/§7, closed by Final Phase §2 — the stop-loss field
 *  switches identity once an initial stop has actually been frozen: before
 *  that, it's THE decision that establishes the original risk unit
 *  (inherits the locked plan's stop by default — §5); after, it becomes
 *  ongoing stop MANAGEMENT (current stop), with the frozen initial stop
 *  shown alongside, read-only, so moving to break-even/trailing can never
 *  be mistaken for redefining 1R. For a genuinely planless trade (nothing
 *  to inherit), `needsExplicitInitialStopConfirmation` makes establishing
 *  it an unmissable, explicitly-labeled requirement the moment execution
 *  begins — closing the "entered the stop much later" ambiguity through
 *  interaction design, not a stop-event system (never required when a
 *  trustworthy plan exists to inherit from instead). */
function StopLossField({ trade }: { trade: TradeWorkspaceDTO }) {
  const initialStop = trade.performanceRisk?.initialStop ?? null;

  if (initialStop == null) {
    const mustConfirm = needsExplicitInitialStopConfirmation({
      hasActualEntry: trade.actualEntry != null,
      hasTrustworthyPlannedStop: trade.plannedStopLoss != null,
      initialStopResolved: false,
    });

    return (
      <div className={cn("space-y-1.5 sm:col-span-2", mustConfirm && "rounded-lg border border-warning/40 bg-warning/5 p-2")}>
        {mustConfirm && (
          <p className="flex items-center gap-1.5 text-[11px] text-warning">
            <TriangleAlert className="size-3.5 shrink-0" />
            No planned stop exists for this trade — enter the stop you actually used to establish your
            original risk. Performance stays Pending until you do.
          </p>
        )}
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualStopLoss"
          label={mustConfirm ? "Initial stop (required)" : "Initial stop"}
          initialValue={trade.actualStopLoss}
          planValue={trade.plannedStopLoss}
        />
      </div>
    );
  }

  const moved = trade.actualStopLoss != null && trade.actualStopLoss !== initialStop;
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Lock className="size-3" />
        Initial stop (frozen): <span className="tabular-nums text-foreground">{initialStop}</span>
        {moved && <span className="text-warning">· Current stop moved from initial</span>}
      </div>
      <WorkspacePriceField
        dateKey={trade.dateKey}
        tradeId={trade.id}
        field="actualStopLoss"
        label="Current stop"
        initialValue={trade.actualStopLoss}
      />
    </div>
  );
}

// Section 2 — Trade Execution: what actually happened. Kept separate from the plan.
export function TradeExecutionSection({ trade }: { trade: TradeWorkspaceDTO }) {
  const targetPrecision = parseSymbol(trade.assetSymbol).spec?.decimalPrecision ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <WorkspaceField label="Execution time" value={minutesToTimeString(trade.executionMinutes)} />
        <WorkspaceField
          label="Direction"
          value={
            <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
              {trade.direction === "LONG" ? "Long" : "Short"}
            </Badge>
          }
        />
      </div>

      {/* Planned vs actual RR — the core "did it play out?" comparison.
          Actual RR is DERIVED/read-only everywhere in the live workflow now
          (Phase 2 §8) — settlePerformanceTrade is its only writer. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">Expected RR</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              trade.expectedRR == null && "text-muted-foreground",
            )}
          >
            {trade.expectedRR != null ? `${trade.expectedRR.toFixed(2)}R` : "Not planned yet"}
          </div>
        </div>
        <div className="text-muted-foreground">→</div>
        <div className="flex-1 text-right">
          <div className="text-xs text-muted-foreground">Actual RR</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              trade.actualRR == null
                ? "text-muted-foreground"
                : trade.actualRR >= 0
                  ? "text-success"
                  : "text-danger",
            )}
          >
            {trade.actualRR == null ? "Pending" : formatRR(trade.actualRR)}
          </div>
        </div>
      </div>

      {/* Performance Account — the canonical trader-performance result,
          always the most prominent account here (§10/§11). */}
      <PerformanceExecutionCard trade={trade} />

      {/* Other participating (real) accounts — secondary, expandable, never
          competing with the Performance Account for attention (§11). Prop
          Firms architecture (System B) is untouched, just presented lower. */}
      {trade.accounts.some((a) => a.kind !== "PERFORMANCE") && (
        <details className="group rounded-xl border border-border bg-background/30 p-3">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
            Other participating accounts ({trade.accounts.filter((a) => a.kind !== "PERFORMANCE").length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {trade.accounts
              .filter((a) => a.kind !== "PERFORMANCE")
              .map((a) => (
                <div
                  key={`${a.name}-${a.kind}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant="outline">{ACCOUNT_KIND_LABEL[a.kind] ?? a.kind}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Risk {a.riskValue}
                      {a.riskInputType === "PERCENT" ? "%" : "$"}
                    </span>
                  </div>
                  {a.closingPnlNet == null ? (
                    <span className="font-medium tabular-nums text-muted-foreground">Pending</span>
                  ) : (
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        a.closingPnlNet >= 0 ? "text-success" : "text-danger",
                      )}
                    >
                      {formatSignedCurrency(a.closingPnlNet)}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </details>
      )}

      {(trade.targets.length > 0 || trade.executionLabels.length > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {trade.targets.map((t) => (
              <Badge key={t.targetOrder} variant="outline">
                {t.label} {formatTargetPrice(t.targetPrice, targetPrecision)}
              </Badge>
            ))}
            {trade.executionLabels.map((tag) => (
              <Tag key={tag.name} color={tag.color}>
                {tag.name}
              </Tag>
            ))}
          </div>
          <AdherenceMeter
            label="Execution adherence"
            percent={trade.executionPercent}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Combined strategy-adherence / trade-quality — a discipline score, not a
          market prediction. Shown when the trade had a strategy with expected items. */}
      {trade.tradeQualityPercent != null && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Strategy adherence</span>
            <span className="text-xs text-muted-foreground/60">selected vs the strategy&apos;s plan</span>
          </div>
          <AdherenceMeter label="Trade quality" percent={trade.tradeQualityPercent} />
        </div>
      )}

      {/* Execution details — editable inline (Phase 2). Today V2 Phase 2 §3:
          EXECUTION = PLAN — each field shows its planned counterpart as a
          one-click inheritance source rather than asking the trader to
          retype a value that didn't change. */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-2">
        <div className="text-xs font-medium text-muted-foreground sm:col-span-2">
          Execution details
        </div>
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualEntry"
          label="Actual entry"
          initialValue={trade.actualEntry}
          planValue={trade.plannedEntry}
        />
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualExit"
          label="Actual exit"
          initialValue={trade.actualExit}
          planValue={trade.plannedTarget}
          planLabel="Target"
        />
        <StopLossField trade={trade} />
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="executionNotes"
          label="Execution notes"
          initialValue={trade.executionNotes}
          placeholder="How did the entry and management actually go?"
          className="sm:col-span-2"
        />
      </div>

      {/* Actual partial exits (Stage 7 §2) — realized R / Performance PnL
          recompute automatically from these; see Trade Review for the
          weighted result and the planned-vs-actual comparison. */}
      <div className="rounded-xl border border-border bg-background/30 p-3">
        <PartialExitsEditor dateKey={trade.dateKey} tradeId={trade.id} />
      </div>
    </div>
  );
}
