"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronRight, Link2, Link2Off, ShieldCheck, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  createManualComparisonLink,
  deleteManualComparisonLink,
  setMissedOpportunityClassification,
} from "@/actions/replay.actions";
import type {
  ActualVsReplayComparison,
  MatchedDecisionPair,
  UnmatchedActualEntry,
  UnmatchedReplayEntry,
} from "@/domain/replay-comparison/types";

const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const toneClass = (v: number | null) => (v == null ? "" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "");

type Row =
  | { kind: "matched"; dateKey: string; assetSymbol: string; pair: MatchedDecisionPair }
  | { kind: "unmatchedActual"; dateKey: string; assetSymbol: string; entry: UnmatchedActualEntry }
  | { kind: "unmatchedReplayTaken"; dateKey: string; assetSymbol: string; entry: UnmatchedReplayEntry }
  | { kind: "unmatchedReplaySkipped"; dateKey: string; assetSymbol: string; entry: UnmatchedReplayEntry };

function buildRows(comparison: ActualVsReplayComparison): Row[] {
  const rows: Row[] = [
    ...comparison.matched.map((pair): Row => ({ kind: "matched", dateKey: pair.dateKey, assetSymbol: pair.assetSymbol, pair })),
    ...comparison.opportunity.unmatchedActual.map((entry): Row => ({ kind: "unmatchedActual", dateKey: entry.dateKey, assetSymbol: entry.assetSymbol, entry })),
    ...comparison.opportunity.unmatchedReplayTaken.map((entry): Row => ({ kind: "unmatchedReplayTaken", dateKey: entry.dateKey, assetSymbol: entry.assetSymbol, entry })),
    ...comparison.opportunity.unmatchedReplaySkipped.map((entry): Row => ({ kind: "unmatchedReplaySkipped", dateKey: entry.dateKey, assetSymbol: entry.assetSymbol, entry })),
  ];
  return rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.assetSymbol.localeCompare(b.assetSymbol));
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  SAME_DECISION: "Same decision",
  ACTUAL_TAKEN_REPLAY_SKIPPED: "Actual took / Replay skipped",
  ACTUAL_ABSENT_REPLAY_TAKEN: "Potential missed opportunity",
  UNMATCHED_ACTUAL: "Unmatched (Actual)",
  UNMATCHED_REPLAY: "Unmatched (Replay skip)",
  EXCLUDED_DIFFERENT_OPPORTUNITY: "Confirmed different opportunity",
};

function classificationOf(row: Row): string {
  if (row.kind === "matched") return row.pair.classification;
  return row.entry.classification;
}

function ConfidenceBadge({ row }: { row: Row }) {
  if (row.kind !== "matched") return null;
  const { confidence, source } = row.pair;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        source === "MANUAL"
          ? "bg-primary/15 text-primary"
          : confidence === "HIGH"
            ? "bg-success/15 text-success"
            : "bg-warning/15 text-warning",
      )}
    >
      {source === "MANUAL" ? "Manually matched" : confidence === "HIGH" ? "Auto matched" : "Review needed"}
    </span>
  );
}

/**
 * The main opportunity-level comparison table (Stage 15.2 §23) — one row
 * per matched pair or unmatched entry, sorted chronologically. Clicking a
 * row opens the detail drawer (§24). Review actions (manual match/exclude,
 * missed-opportunity confirm/reject, remove correction) live inline, per
 * row, and never overwhelm the table with scoring internals — only a
 * subtle Auto/Manual/Review-needed badge (§2).
 */
export function EdgeComparisonTable({
  sessionId,
  comparison,
}: {
  sessionId: string;
  comparison: ActualVsReplayComparison;
}) {
  const rows = buildRows(comparison);
  const [openRow, setOpenRow] = useState<Row | null>(null);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No Actual trades or Replay decisions to compare yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="pb-2 text-left font-medium">Date</th>
              <th className="pb-2 text-left font-medium">Asset</th>
              <th className="pb-2 text-left font-medium">Actual</th>
              <th className="pb-2 text-left font-medium">Replay</th>
              <th className="pb-2 text-right font-medium">Actual R</th>
              <th className="pb-2 text-right font-medium">Replay R</th>
              <th className="pb-2 text-left font-medium">Classification</th>
              <th className="pb-2 text-left font-medium">Match</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row, i) => (
              <tr key={i} className="cursor-pointer hover:bg-accent/30" onClick={() => setOpenRow(row)}>
                <td className="py-1.5">{row.dateKey}</td>
                <td className="py-1.5 font-mono">{row.assetSymbol}</td>
                <td className="py-1.5">
                  {row.kind === "matched" ? row.pair.decision.actualDirection : row.kind === "unmatchedActual" ? row.entry.actual.direction : "—"}
                </td>
                <td className="py-1.5">
                  {row.kind === "matched"
                    ? row.pair.replay.decisionType === "SKIPPED"
                      ? "Skipped"
                      : row.pair.replay.direction
                    : row.kind === "unmatchedReplayTaken" || row.kind === "unmatchedReplaySkipped"
                      ? row.entry.replay.decisionType === "SKIPPED"
                        ? "Skipped"
                        : row.entry.replay.direction
                      : "—"}
                </td>
                <td className={cn("py-1.5 text-right tabular-nums", toneClass(row.kind === "matched" ? row.pair.outcome.actualR : row.kind === "unmatchedActual" ? row.entry.actual.realizedR : null))}>
                  {rr(row.kind === "matched" ? row.pair.outcome.actualR : row.kind === "unmatchedActual" ? row.entry.actual.realizedR : null)}
                </td>
                <td
                  className={cn(
                    "py-1.5 text-right tabular-nums",
                    toneClass(
                      row.kind === "matched"
                        ? row.pair.outcome.replayR
                        : row.kind === "unmatchedReplayTaken"
                          ? row.entry.replay.realizedReplayR
                          : null,
                    ),
                  )}
                >
                  {rr(
                    row.kind === "matched"
                      ? row.pair.outcome.replayR
                      : row.kind === "unmatchedReplayTaken"
                        ? row.entry.replay.realizedReplayR
                        : null,
                  )}
                </td>
                <td className="py-1.5 text-muted-foreground">{CLASSIFICATION_LABEL[classificationOf(row)] ?? classificationOf(row)}</td>
                <td className="py-1.5">
                  <ConfidenceBadge row={row} />
                </td>
                <td className="py-1.5 text-right">
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={openRow != null} onOpenChange={(open) => !open && setOpenRow(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg">
          {openRow && <RowDetail sessionId={sessionId} row={openRow} onClose={() => setOpenRow(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function fmt(v: number | null): string {
  return v == null ? "—" : String(v);
}

function RowDetail({ sessionId, row, onClose }: { sessionId: string; row: Row; onClose: () => void }) {
  const [pending, startTransition] = useTransition();

  function runAction(action: () => Promise<{ success: true } | { success: false; error: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      onClose();
    });
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {row.assetSymbol} · {row.dateKey}
        </SheetTitle>
      </SheetHeader>

      <div className="space-y-4 px-1 pb-6 text-sm">
        <span className="inline-block rounded bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          {CLASSIFICATION_LABEL[classificationOf(row)] ?? classificationOf(row)}
        </span>

        {row.kind === "matched" && <MatchedDetail pair={row.pair} />}
        {row.kind === "unmatchedActual" && <UnmatchedActualDetail entry={row.entry} />}
        {(row.kind === "unmatchedReplayTaken" || row.kind === "unmatchedReplaySkipped") && <UnmatchedReplayDetail entry={row.entry} />}

        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">Review Action</p>
          {row.kind === "matched" && (
            <div className="flex flex-wrap gap-1.5">
              {row.pair.source === "MANUAL" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => deleteManualComparisonLink(sessionId, { actualTradeId: row.pair.actual.tradeId, replayTradeId: row.pair.replay.id }),
                      "Manual correction removed.",
                    )
                  }
                >
                  <Link2Off className="mr-1 size-3.5" /> Remove manual match
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        () =>
                          createManualComparisonLink(sessionId, {
                            actualTradeId: row.pair.actual.tradeId,
                            replayTradeId: row.pair.replay.id,
                            linkType: "MATCHED",
                          }),
                        "Match confirmed.",
                      )
                    }
                  >
                    <ShieldCheck className="mr-1 size-3.5" /> Confirm match
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        () =>
                          createManualComparisonLink(sessionId, {
                            actualTradeId: row.pair.actual.tradeId,
                            replayTradeId: row.pair.replay.id,
                            linkType: "EXCLUDED",
                          }),
                        "Marked as a different opportunity.",
                      )
                    }
                  >
                    <ShieldQuestion className="mr-1 size-3.5" /> This is a different opportunity
                  </Button>
                </>
              )}
            </div>
          )}

          {row.kind === "unmatchedActual" && <MatchPicker sessionId={sessionId} actualTradeId={row.entry.actual.tradeId} pending={pending} runAction={runAction} />}

          {row.kind === "unmatchedReplayTaken" && (
            <div className="space-y-2">
              <MatchPicker sessionId={sessionId} replayTradeId={row.entry.replay.id} pending={pending} runAction={runAction} />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => setMissedOpportunityClassification(sessionId, { replayTradeId: row.entry.replay.id, classification: "CONFIRMED_MISSED" }),
                      "Confirmed as a missed opportunity.",
                    )
                  }
                >
                  Confirm Missed Opportunity
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => setMissedOpportunityClassification(sessionId, { replayTradeId: row.entry.replay.id, classification: "NOT_MISSED" }),
                      "Marked as not a missed opportunity.",
                    )
                  }
                >
                  Not a Missed Opportunity
                </Button>
              </div>
              {row.entry.missedOpportunityStatus && row.entry.missedOpportunityStatus !== "UNCONFIRMED" && (
                <p className="text-[11px] text-muted-foreground">
                  Currently: {row.entry.missedOpportunityStatus === "CONFIRMED_MISSED" ? "Confirmed missed" : "Not a missed opportunity"}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** A compact "Match to..." picker (§2) — shown on an unmatched row so the
 *  trader can link it to a specific counterpart on the other side. */
function MatchPicker({
  sessionId,
  actualTradeId,
  replayTradeId,
  pending,
  runAction,
}: {
  sessionId: string;
  actualTradeId?: string;
  replayTradeId?: string;
  pending: boolean;
  runAction: (action: () => Promise<{ success: true } | { success: false; error: string }>, message: string) => void;
}) {
  const [counterpartId, setCounterpartId] = useState<string | null>(null);
  // Deliberately does not enumerate candidates itself — the trader supplies
  // the id of the specific Actual trade or Replay decision they know is the
  // match (e.g. from the Journal or the Replay tab); kept minimal rather
  // than duplicating a full picker UI here.
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        placeholder={actualTradeId ? "Replay decision id" : "Actual trade id"}
        value={counterpartId ?? ""}
        onChange={(e) => setCounterpartId(e.target.value || null)}
        className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !counterpartId}
        onClick={() =>
          counterpartId &&
          runAction(
            () =>
              createManualComparisonLink(sessionId, {
                actualTradeId: actualTradeId ?? counterpartId,
                replayTradeId: replayTradeId ?? counterpartId,
                linkType: "MATCHED",
              }),
            "Linked.",
          )
        }
      >
        <Link2 className="mr-1 size-3.5" /> Link
      </Button>
    </div>
  );
}

function MatchedDetail({ pair }: { pair: MatchedDecisionPair }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Actual</p>
        <DetailRow label="Direction" value={pair.decision.actualDirection} />
        <DetailRow label="Strategy" value={pair.decision.actualStrategyName ?? "—"} />
        <DetailRow label="Setup" value={pair.decision.actualSetupTypeName ?? "—"} />
        <DetailRow label="Validation" value={pair.decision.actualValidationState ?? "—"} />
        <DetailRow label="Entry" value={fmt(pair.execution.entry.actual)} />
        <DetailRow label="Stop" value={fmt(pair.execution.initialStop.actual)} />
        <DetailRow label="Exit" value={fmt(pair.execution.actualFullExit)} />
        <DetailRow label="Realized R" value={rr(pair.outcome.actualR)} />
        {pair.behaviour.actualBehaviourLabels.length > 0 && (
          <DetailRow label="Behaviour" value={pair.behaviour.actualBehaviourLabels.map((l) => l.name).join(", ")} />
        )}
        {pair.behaviour.actualMoodTags.length > 0 && <DetailRow label="Mood" value={pair.behaviour.actualMoodTags.join(", ")} />}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Replay</p>
        <DetailRow label="Direction" value={pair.decision.replayDirection ?? "—"} />
        <DetailRow label="Decision" value={pair.replay.decisionType} />
        <DetailRow label="Strategy" value={pair.decision.replayStrategyName ?? "—"} />
        <DetailRow label="Setup" value={pair.decision.replaySetupTypeName ?? "—"} />
        <DetailRow label="Validation" value={pair.decision.replayValidationState ?? "—"} />
        <DetailRow label="Entry" value={fmt(pair.execution.entry.replay)} />
        <DetailRow label="Stop" value={fmt(pair.execution.initialStop.replay)} />
        <DetailRow label="Exit" value={fmt(pair.execution.replayFullExit)} />
        <DetailRow label="Realized R" value={rr(pair.outcome.replayR)} />
      </div>
      <div className="col-span-2 space-y-1 border-t border-border/60 pt-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Differences</p>
        <DetailRow label="Outcome Difference" value={rr(pair.outcome.deltaR)} />
        {pair.execution.comparable && (
          <>
            <DetailRow
              label="Entry Difference"
              value={pair.execution.entry.rDistance != null ? `${pair.execution.entry.rDistance.toFixed(2)}R` : "—"}
            />
            <DetailRow
              label="Stop Difference"
              value={pair.execution.initialStop.rDistance != null ? `${pair.execution.initialStop.rDistance.toFixed(2)}R` : "—"}
            />
          </>
        )}
        {!pair.validation.comparable && pair.validation.incompatibilityReason && (
          <p className="text-[11px] text-muted-foreground italic">{pair.validation.incompatibilityReason}</p>
        )}
        {pair.validation.comparable && pair.validation.mandatoryDifferenceNames.length > 0 && (
          <DetailRow label="Mandatory differs" value={pair.validation.mandatoryDifferenceNames.join(", ")} />
        )}
      </div>
    </div>
  );
}

function UnmatchedActualDetail({ entry }: { entry: UnmatchedActualEntry }) {
  return (
    <div className="space-y-1">
      <DetailRow label="Direction" value={entry.actual.direction} />
      <DetailRow label="Strategy" value={entry.actual.strategyName ?? "—"} />
      <DetailRow label="Setup" value={entry.actual.setupTypeName ?? "—"} />
      <DetailRow label="Validation" value={entry.actual.validationState ?? "—"} />
      <DetailRow label="Realized R" value={rr(entry.actual.realizedR)} />
      <p className="text-[11px] text-muted-foreground/70 italic">No matching Replay decision this period.</p>
    </div>
  );
}

function UnmatchedReplayDetail({ entry }: { entry: UnmatchedReplayEntry }) {
  return (
    <div className="space-y-1">
      <DetailRow label="Direction" value={entry.replay.direction ?? "—"} />
      <DetailRow label="Decision" value={entry.replay.decisionType} />
      <DetailRow label="Strategy" value={entry.replay.strategyNameSnapshot ?? "—"} />
      <DetailRow label="Setup" value={entry.replay.setupTypeNameSnapshot ?? "—"} />
      <DetailRow label="Validation" value={entry.replay.validationState ?? "—"} />
      {entry.replay.decisionType === "TAKEN" && <DetailRow label="Replay Realized R" value={rr(entry.replay.realizedReplayR)} />}
      <p className="text-[11px] text-muted-foreground/70 italic">No matching Actual trade this period.</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
