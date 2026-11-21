"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Info, RefreshCw, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { saveTradeAssessmentAction } from "@/actions/trade-audit.actions";
import { EXECUTION_ISSUE_LABEL, INVALID_REASON_LABEL, VERDICT_LABEL, WEAKNESS_LABEL } from "@/domain/trade-audit/labels";
import {
  AUDIT_EXECUTION_ISSUES,
  AUDIT_INVALID_REASONS,
  AUDIT_WEAKNESSES,
  type AuditTradeDTO,
  type AuditVerdictValue,
  type TradeAssessmentDTO,
  type TradeChangeDTO,
} from "@/types/trade-audit";
import { fmtPnl, fmtPrice, fmtR, toneOf, useAudit } from "@/components/edge/audit/audit-context";
import { AutosaveText, ChipGroup, RatingInput } from "@/components/edge/audit/audit-fields";
import { AuditEvidenceGallery } from "@/components/edge/audit/audit-evidence-gallery";

const OUTCOME_STYLE: Record<AuditTradeDTO["outcome"], { label: string; className: string }> = {
  WIN: { label: "Win", className: "bg-success/15 text-success" },
  LOSS: { label: "Loss", className: "bg-danger/15 text-danger" },
  BREAKEVEN: { label: "Breakeven", className: "bg-muted text-muted-foreground" },
  PENDING: { label: "Open / unsettled", className: "bg-warning/15 text-warning-foreground dark:text-warning" },
  CANCELLED: { label: "Never triggered", className: "bg-muted text-muted-foreground" },
};

export function DirectionBadge({ direction }: { direction: "LONG" | "SHORT" }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[11px] font-semibold", direction === "LONG" ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
      {direction === "LONG" ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {direction === "LONG" ? "Long" : "Short"}
    </span>
  );
}

function Fact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-mono text-xs tabular-nums", value === "—" && "text-muted-foreground/60", className)}>{value}</dd>
    </div>
  );
}

/** LEFT cell — what actually happened. Facts come straight from the trade record. */
export function ActualTradeCell({ trade }: { trade: AuditTradeDTO }) {
  const [showNotes, setShowNotes] = useState(false);
  const outcome = OUTCOME_STYLE[trade.outcome];
  const hasNotes = Boolean(trade.reasonForTrade || trade.executionNotes);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {trade.tradeNumber != null && <span className="text-xs text-muted-foreground">#{trade.tradeNumber}</span>}
        <span className="font-semibold">{trade.assetSymbol}</span>
        <DirectionBadge direction={trade.direction} />
        {trade.entryTime && <span className="text-xs text-muted-foreground">{trade.entryTime}</span>}
        {trade.session && <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{trade.session}</span>}
        <span className={cn("ml-auto rounded px-1.5 py-px text-[11px] font-medium", outcome.className)}>{outcome.label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {trade.strategyName && <span>{trade.strategyName}</span>}
        {trade.setupName && <span>· {trade.setupName}</span>}
        {trade.timeframe && <span>· {trade.timeframe}</span>}
        <span className="ml-auto flex gap-3">
          <span className={cn("font-mono font-semibold tabular-nums", toneOf(trade.realizedR))}>{fmtR(trade.realizedR)}</span>
          <span className={cn("font-mono tabular-nums", toneOf(trade.pnl))}>{fmtPnl(trade.pnl)}</span>
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg bg-muted/40 p-2 sm:grid-cols-6">
        <Fact label="Entry" value={fmtPrice(trade.actualEntry)} />
        <Fact label="Stop" value={fmtPrice(trade.actualStopLoss ?? trade.plannedStopLoss)} />
        <Fact label="Exit" value={fmtPrice(trade.actualExit)} />
        <Fact label="Target" value={fmtPrice(trade.plannedTarget)} />
        <Fact label="Size" value={trade.positionSize ?? "—"} />
        <Fact label="Risk" value={trade.risk ?? "—"} />
        <Fact label="Plan entry" value={fmtPrice(trade.plannedEntry)} />
        <Fact label="Planned R" value={trade.plannedR == null ? "—" : `${trade.plannedR.toFixed(2)}R`} />
        <Fact label="Closed" value={trade.closedAt ? new Date(trade.closedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"} />
      </dl>

      {trade.systemFlags.length > 0 && (
        <ul className="space-y-0.5">
          {trade.systemFlags.map((f) => (
            <li key={f.key} className="flex items-center gap-1.5 text-[11px] text-warning-foreground dark:text-warning">
              <ShieldAlert className="size-3 shrink-0" /> {f.label}
            </li>
          ))}
        </ul>
      )}

      {hasNotes && (
        <div className="text-xs">
          <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
            {showNotes ? "Hide trade notes" : "Show trade notes"}
          </button>
          {showNotes && (
            <div className="mt-1 space-y-1.5 rounded-md border border-border p-2">
              {trade.reasonForTrade && (
                <p>
                  <span className="text-muted-foreground">Reason: </span>
                  <span className="whitespace-pre-wrap">{trade.reasonForTrade}</span>
                </p>
              )}
              {trade.executionNotes && (
                <p>
                  <span className="text-muted-foreground">Execution notes: </span>
                  <span className="whitespace-pre-wrap">{trade.executionNotes}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <AuditEvidenceGallery images={trade.images} compact emptyLabel="No screenshots on the trade record." />

      <Link href={`/journal/${trade.dateKey}/trades/${trade.id}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" target="_blank">
        Open full trade <ExternalLink className="size-3" />
      </Link>
    </div>
  );
}

const VERDICT_STYLE: Record<AuditVerdictValue, string> = {
  VALID: "border-success bg-success/10 text-success",
  INVALID: "border-danger bg-danger/10 text-danger",
  UNSURE: "border-warning bg-warning/10 text-warning-foreground dark:text-warning",
};

/**
 * RIGHT cell for an actual trade — what SHOULD have happened. The verdict is
 * about the decision against the strategy, never about the result; the
 * mistake, the underlying weakness and the improvement are separate fields.
 */
export function TradeJudgmentCell({ trade, assessment, change }: { trade: AuditTradeDTO; assessment: TradeAssessmentDTO | undefined; change?: TradeChangeDTO }) {
  const router = useRouter();
  const { scope, locked } = useAudit();
  const [pending, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<AuditVerdictValue | null>(assessment?.verdict ?? null);
  const [invalidReasons, setInvalidReasons] = useState(assessment?.invalidReasons ?? []);
  const [executionIssues, setExecutionIssues] = useState(assessment?.executionIssues ?? []);
  const [quality, setQuality] = useState<number | null>(assessment?.executionQuality ?? null);
  const [weaknesses, setWeaknesses] = useState(assessment?.weaknesses ?? []);

  function save(patch: Record<string, unknown>, refresh = true) {
    startTransition(async () => {
      const result = await saveTradeAssessmentAction({ scope, tradeId: trade.id, patch });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (refresh) router.refresh();
    });
  }

  const saveText = (field: "mistake" | "underlyingWeakness" | "improvement") => (value: string | null) => saveTradeAssessmentAction({ scope, tradeId: trade.id, patch: { [field]: value } });

  const goodOutcome = trade.outcome === "WIN";
  const outcomeNote =
    verdict === "INVALID" && goodOutcome
      ? "Profitable, but against your rules — this is still a mistake."
      : verdict === "VALID" && trade.outcome === "LOSS"
        ? "A valid trade that lost is an acceptable loss, not a mistake."
        : null;

  return (
    <div className="space-y-3">
      {change && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
          <Info className="size-3.5 shrink-0" />
          <span>
            Edited after you assessed it{change.fields.length > 0 ? ` (${change.fields.join(", ")})` : ""}. Re-check your judgment.
          </span>
          {!locked && (
            <Button type="button" size="xs" variant="outline" className="ml-auto gap-1" disabled={pending} onClick={() => save({})}>
              <RefreshCw className="size-3" /> Still holds
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium">Should this trade have been taken?</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Should this trade have been taken?">
          {(["VALID", "INVALID", "UNSURE"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={verdict === v}
              disabled={locked || pending}
              onClick={() => {
                const next = verdict === v ? null : v;
                setVerdict(next);
                if (next !== "INVALID") setInvalidReasons([]);
                save({ verdict: next });
              }}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default",
                verdict === v ? VERDICT_STYLE[v] : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {VERDICT_LABEL[v]}
            </button>
          ))}
        </div>
        {outcomeNote && <p className="text-[11px] text-muted-foreground">{outcomeNote}</p>}
      </div>

      {verdict === "INVALID" && (
        <ChipGroup
          label="Why it shouldn't have been taken"
          tone="danger"
          options={AUDIT_INVALID_REASONS.map((k) => ({ key: k, label: INVALID_REASON_LABEL[k] }))}
          value={invalidReasons}
          disabled={locked}
          onChange={(next) => {
            setInvalidReasons(next);
            save({ invalidReasons: next });
          }}
        />
      )}

      <ChipGroup
        label="What could have been executed better?"
        tone="warning"
        options={AUDIT_EXECUTION_ISSUES.map((k) => ({ key: k, label: EXECUTION_ISSUE_LABEL[k] }))}
        value={executionIssues}
        disabled={locked}
        onChange={(next) => {
          setExecutionIssues(next);
          save({ executionIssues: next });
        }}
      />

      <RatingInput
        label="Execution quality"
        value={quality}
        disabled={locked}
        onChange={(next) => {
          setQuality(next);
          save({ executionQuality: next });
        }}
      />

      <div className="grid gap-3 border-t border-border pt-3">
        <AutosaveText label="Mistake" hint="What exactly went wrong in this decision?" placeholder="e.g. Entered before the 5m close confirmed the break." initial={assessment?.mistake ?? null} disabled={locked} onSave={saveText("mistake")} />
        <div className="space-y-1.5">
          <ChipGroup
            label="Underlying weakness"
            options={AUDIT_WEAKNESSES.map((k) => ({ key: k, label: WEAKNESS_LABEL[k] }))}
            value={weaknesses}
            disabled={locked}
            onChange={(next) => {
              setWeaknesses(next);
              save({ weaknesses: next });
            }}
          />
          <AutosaveText label="" placeholder="Why did it happen? e.g. Impatience — didn't wait for the complete setup." initial={assessment?.underlyingWeakness ?? null} disabled={locked} onSave={saveText("underlyingWeakness")} />
        </div>
        <AutosaveText label="Improvement" hint="The concrete rule or behaviour for next time." placeholder="e.g. Only enter after the predefined confirmation condition is satisfied." initial={assessment?.improvement ?? null} disabled={locked} onSave={saveText("improvement")} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">Review screenshots</p>
        <AuditEvidenceGallery images={assessment?.images ?? []} upload={{ kind: "ASSESSMENT", tradeId: trade.id }} category="REVIEW" compact emptyLabel={locked ? "No review screenshots." : undefined} />
      </div>
    </div>
  );
}
