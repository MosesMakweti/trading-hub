"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SquareArrowOutUpRight, Target, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { tradeBiasDisplay, tradeTimeDisplay } from "@/domain/trades/display-facts";
import { Badge } from "@/components/ui/badge";
import { Tag, TAG_STYLES, colorForName } from "@/components/ui/tag";
import { TradeQualityBadge } from "@/components/journal/adherence-score";
import { RatingBadge } from "@/components/journal/setup-score-card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { archiveTrade } from "@/actions/trades.actions";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import { parseSymbol, formatTargetPrice } from "@/domain/trade-plan/instrument-catalog";
import { PRE_TRADE_MOOD_TAG_LABELS, type PreTradeMoodTagValue } from "@/domain/psychology/pre-trade-mood";
import type { TradeListItemDTO, TradeDiscrepancyDTO } from "@/types/trades";
import { useJournalLinks, useWorkspace } from "@/components/workspace/workspace-context";

const LIFECYCLE_LABEL: Record<string, string> = {
  FULLY_CLOSED: "Fully closed",
  PARTIALLY_CLOSED: "Partially closed",
  STILL_HOLDING: "Still holding",
  CANCELLED_NEVER_TRIGGERED: "Cancelled",
};
const LIFECYCLE_CLASS: Record<string, string> = {
  FULLY_CLOSED: "border-border bg-muted/40 text-muted-foreground",
  PARTIALLY_CLOSED: "border-warning/30 bg-warning/10 text-warning",
  STILL_HOLDING: "border-primary/30 bg-primary/10 text-primary",
  // Deliberately neutral, never red/danger — a cancelled idea is not a loss.
  CANCELLED_NEVER_TRIGGERED: "border-border bg-muted/40 text-muted-foreground",
};
const VALIDATION_LABEL: Record<string, string> = {
  VALIDATED: "Validated",
  OVERRIDDEN: "Overridden",
  NOT_VALIDATED: "Not validated",
};
const VALIDATION_CLASS: Record<string, string> = {
  VALIDATED: "border-success/30 bg-success/10 text-success",
  OVERRIDDEN: "border-danger/30 bg-danger/10 text-danger",
  NOT_VALIDATED: "border-warning/30 bg-warning/10 text-warning",
};

// Per-trade discrepancy badge (Counterfactual model): clean = neutral/positive,
// avoidable leakage = danger, a breach with no measurable R = warning.
function discrepancyBadge(d: TradeDiscrepancyDTO): { label: string; className: string } {
  if (d.avoidableR > 0)
    return { label: "Avoidable gap", className: "border-danger/30 bg-danger/10 text-danger" };
  if (d.processBreach)
    return { label: "Process breach", className: "border-warning/30 bg-warning/10 text-warning" };
  if (d.actualR != null && d.actualR > 0)
    return { label: "Clean win", className: "border-success/30 bg-success/10 text-success" };
  return { label: "Clean", className: "border-border bg-muted/40 text-muted-foreground" };
}

function percent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtR(n: number | null) {
  return n == null ? "—" : `${n.toFixed(2)}R`;
}

export function TradeCard({ dateKey, trade }: { dateKey: string; trade: TradeListItemDTO }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { isBacktest } = useWorkspace();
  const links = useJournalLinks();

  function handleDelete() {
    startTransition(async () => {
      const result = await archiveTrade(dateKey, trade.id);
      if (!result.success) {
        toast.error(result.error ?? "Failed to remove trade.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const targetPrecision = parseSymbol(trade.assetSymbol).spec?.decimalPrecision ?? null;
  const bias = tradeBiasDisplay(trade);
  const time = tradeTimeDisplay({
    executionMinutes: trade.executionMinutes,
    hasActualEntry: trade.hasActualEntry,
    hasLegacyResult: !trade.hasActualEntry && trade.actualRR != null,
  });

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">#{trade.tradeNumber}</span>
            <span className="font-semibold">{trade.assetSymbol}</span>
            <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
              {trade.direction === "LONG" ? "Long" : "Short"}
            </Badge>
            <span className="text-xs text-muted-foreground" title={time.label}>
              {time.executed ? time.time : `${time.label} ${time.time}`}
            </span>
            {trade.reviewLifecycleStatus && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  LIFECYCLE_CLASS[trade.reviewLifecycleStatus],
                )}
              >
                {LIFECYCLE_LABEL[trade.reviewLifecycleStatus]}
              </span>
            )}
            {trade.validationState && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  VALIDATION_CLASS[trade.validationState],
                )}
              >
                {VALIDATION_LABEL[trade.validationState]}
              </span>
            )}
          </div>
          {bias.value && (
            <p className="text-xs text-muted-foreground">
              {bias.label} · {bias.value}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {trade.strategyName &&
              (trade.strategyId ? (
                <Link
                  href={`/strategy-lab/${trade.strategyId}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Target className="size-3" />
                  {trade.strategyName}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Target className="size-3" />
                  {trade.strategyName}
                </span>
              ))}
            {trade.setupTypeName && (
              <span className="text-xs text-muted-foreground">Setup: {trade.setupTypeName}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          {trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED" ? (
            <div className="font-medium text-muted-foreground">Never triggered</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">Expected / Actual RR</div>
              <div className="font-medium">
                {trade.expectedRR != null ? `${trade.expectedRR.toFixed(2)}R` : "—"} /{" "}
                <span
                  className={cn(
                    trade.actualRR == null
                      ? "text-muted-foreground"
                      : trade.actualRR >= 0
                        ? "text-success"
                        : "text-danger",
                  )}
                >
                  {trade.actualRR == null ? "Open" : percent(trade.actualRR)}
                </span>
              </div>
            </>
          )}
          {trade.psychology && (
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <Badge variant={GRADE_VARIANT[trade.psychology.grade]}>
                {trade.psychology.grade}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {trade.psychology.percent.toFixed(1)}% discipline
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {trade.accounts.map((a) => (
          <div key={a.name} className="rounded-lg border border-border bg-background/40 p-2 text-xs">
            <div className="font-medium">{a.name}</div>
            <div className="text-muted-foreground">
              Risk: {a.riskValue}
              {a.riskInputType === "PERCENT" ? "%" : "$"} · Net PnL:{" "}
              {a.closingPnlNet == null ? (
                <span className="text-muted-foreground">Pending</span>
              ) : (
                <span className={a.closingPnlNet >= 0 ? "text-success" : "text-danger"}>
                  {a.closingPnlNet.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {(trade.preTradeMoodTags.length > 0 || trade.behaviourLabels.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {trade.preTradeMoodTags.map((tag) => (
            <span
              key={`mood-${tag}`}
              className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {PRE_TRADE_MOOD_TAG_LABELS[tag as PreTradeMoodTagValue] ?? tag}
            </span>
          ))}
          {trade.behaviourLabels.map((label) => {
            const s = TAG_STYLES[label.color];
            return (
              <span
                key={`behaviour-${label.name}`}
                className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", s.chip)}
              >
                <span className={cn("size-1 shrink-0 rounded-full", s.dot)} />
                {label.name}
              </span>
            );
          })}
        </div>
      )}

      {(trade.entryModelName != null ||
        trade.confluenceLabels.length > 0 ||
        trade.executionLabels.length > 0 ||
        trade.targets.length > 0 ||
        trade.tradeQualityPercent != null ||
        trade.setupValid != null ||
        trade.setupRating != null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {trade.targets.map((t) => (
            <Badge key={t.targetOrder} variant="outline">
              {t.label} {formatTargetPrice(t.targetPrice, targetPrecision)}
            </Badge>
          ))}
          {trade.entryModelName && (
            <Tag key={`m-${trade.entryModelName}`} color={colorForName(trade.entryModelName)}>
              {trade.entryModelName}
            </Tag>
          )}
          {trade.confluenceLabels.map((tag) => (
            <Tag key={`c-${tag.name}`} color={tag.color}>
              {tag.name}
            </Tag>
          ))}
          {trade.executionLabels.map((tag) => (
            <Tag key={`e-${tag.name}`} color={tag.color}>
              {tag.name}
            </Tag>
          ))}
          <TradeQualityBadge percent={trade.tradeQualityPercent} />
          {trade.setupValid === false ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
              Invalid setup
            </span>
          ) : (
            trade.setupRating && (
              <span className="inline-flex items-center gap-1">
                <RatingBadge rating={trade.setupRating} />
                {trade.setupScore != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {trade.setupScore}%
                  </span>
                )}
              </span>
            )
          )}
        </div>
      )}

      {trade.discrepancy && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
          {(() => {
            const badge = discrepancyBadge(trade.discrepancy);
            return (
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            );
          })()}
          <span className="text-muted-foreground tabular-nums">
            Actual <span className="font-medium text-foreground">{fmtR(trade.discrepancy.actualR)}</span>
            {trade.discrepancy.avoidableR > 0 && (
              <> · Process-perfect {fmtR(trade.discrepancy.processPerfectR)}</>
            )}
          </span>
          {trade.discrepancy.avoidableR > 0 ? (
            <span className="font-medium text-danger tabular-nums">
              Avoidable −{fmtR(trade.discrepancy.avoidableR)}
            </span>
          ) : (
            !trade.discrepancy.processBreach && (
              <span className="text-success tabular-nums">No avoidable leakage</span>
            )
          )}
          {trade.discrepancy.primary && (
            <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-medium text-danger">
              {trade.discrepancy.primary.label}
              {trade.discrepancy.primary.rImpact != null && (
                <span className="tabular-nums opacity-70">
                  −{fmtR(trade.discrepancy.primary.rImpact)}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="Open trade workspace"
          nativeButton={false}
          render={<Link href={links.tradeHref(dateKey, trade.id)} />}
        >
          <SquareArrowOutUpRight className="size-3.5" />
          Open
        </Button>
        {/* The Backtesting Journal is review-only — simulated trades are changed in the Session. */}
        {!isBacktest && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete trade"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove this trade?"
        description="This trade will be removed from the journal. This can't be undone from here."
        confirmLabel="Remove"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
