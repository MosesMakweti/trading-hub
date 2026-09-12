"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRR, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { parseSymbol, formatTargetPrice } from "@/domain/trade-plan/instrument-catalog";
import { loadTradeReviewDataAction } from "@/actions/trade-review.actions";
import type { TradeReviewDataDTO } from "@/server/services/trade-review.service";

function fmtPrice(value: number | null, precision: number | null): string {
  return value == null ? "—" : formatTargetPrice(value, precision);
}

/**
 * Trade Review overhaul (Stage 7 §5/§13) — the Planned vs Actual comparison,
 * the Performance realized-R/PnL summary, and a read-only readout of the
 * Stage 4 Validation Shield's FROZEN snapshot (never recalculated from live
 * Strategy Lab config here — see trade-review.service.ts).
 */
export function TradeReviewComparisonPanel({ tradeId, assetSymbol }: { tradeId: string; assetSymbol: string }) {
  const [data, setData] = useState<TradeReviewDataDTO | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await loadTradeReviewDataAction(tradeId);
      if (active && result.success) setData(result.data);
    })();
    return () => {
      active = false;
    };
  }, [tradeId]);

  if (!data) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  const precision = parseSymbol(assetSymbol).spec?.decimalPrecision ?? null;
  const { planned, actual, differences } = data.plannedVsActual;

  return (
    <div className="space-y-4">
      {/* Planned vs Actual */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 rounded-xl border border-border bg-background/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned</div>
          <Row label="Entry" value={fmtPrice(planned.entry, precision)} />
          <Row label="Stop-loss" value={fmtPrice(planned.stopLoss, precision)} />
          {planned.targets.map((t) => (
            <Row
              key={t.targetOrder}
              label={t.label}
              value={`${fmtPrice(t.plannedPrice, precision)}${t.plannedClosePercent != null ? ` · ${t.plannedClosePercent}%` : ""}`}
            />
          ))}
          <Row label="Planned Realized R" value={planned.realizedR != null ? formatRR(planned.realizedR) : "—"} bold />
        </div>

        <div className="space-y-1.5 rounded-xl border border-border bg-background/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actual</div>
          <Row label="Entry" value={fmtPrice(actual.entry, precision)} />
          <Row label="Stop-loss" value={fmtPrice(actual.stopLoss, precision)} />
          {actual.exits.map((e) => (
            <Row
              key={e.exitOrder}
              label={`Exit #${e.exitOrder}`}
              value={`${fmtPrice(e.exitPrice, precision)}${e.percentClosed != null ? ` · ${e.percentClosed}%` : ""}`}
            />
          ))}
          {actual.exits.length === 0 && (
            <Row label="Final exit" value={fmtPrice(actual.finalExit, precision)} />
          )}
          <Row
            label={actual.isFullyClosed ? "Realized R" : "Realized R so far"}
            value={actual.realizedRSoFar != null ? formatRR(actual.realizedRSoFar) : "—"}
            bold
          />
          {!actual.isFullyClosed && actual.remainingProportionPercent > 0 && (
            <Row label="Remaining open" value={`${actual.remainingProportionPercent.toFixed(0)}%`} />
          )}
        </div>
      </div>

      {differences.realizedRDelta != null && (
        <p className="text-xs text-muted-foreground">
          {differences.realizedRDelta >= 0 ? "Outperformed plan by " : "Underperformed plan by "}
          <span className={cn("font-medium", differences.realizedRDelta >= 0 ? "text-success" : "text-danger")}>
            {formatRR(Math.abs(differences.realizedRDelta))}
          </span>
        </p>
      )}

      {/* Performance PnL — secondary to R, automatic, never a second calculation. */}
      {data.performance.settled && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3 text-sm">
          <span className="text-muted-foreground">Performance PnL</span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              (data.performance.pnl ?? 0) >= 0 ? "text-success" : "text-danger",
            )}
          >
            {data.performance.pnl != null ? formatSignedCurrency(data.performance.pnl) : "—"}
          </span>
        </div>
      )}

      {/* Validation Shield — read-only, frozen at Stage 4 time. */}
      {data.validationShield.setupTypeName && (
        <ValidationShieldReadout shield={data.validationShield} />
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", bold && "font-semibold")}>{value}</span>
    </div>
  );
}

function ValidationShieldReadout({ shield }: { shield: TradeReviewDataDTO["validationShield"] }) {
  const meta = {
    VALIDATED: { icon: ShieldCheck, className: "border-success/30 bg-success/10 text-success", label: "VALIDATED" },
    OVERRIDDEN: { icon: ShieldAlert, className: "border-danger/30 bg-danger/10 text-danger", label: "OVERRIDDEN" },
    NOT_VALIDATED: {
      icon: ShieldQuestion,
      className: "border-warning/30 bg-warning/10 text-warning",
      label: "NOT VALIDATED",
    },
  }[shield.validationState ?? "NOT_VALIDATED"];
  const Icon = meta.icon;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Setup Validation</span>
        <span className="text-xs text-muted-foreground/60">{shield.setupTypeName}</span>
      </div>
      <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium", meta.className)}>
        <Icon className="size-3.5" />
        {meta.label}
        {shield.score != null && <span className="opacity-80">· Score {shield.score}%</span>}
      </div>
      {shield.conditions.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {shield.conditions.map((c) => (
            <div key={c.name} className="flex items-center gap-1.5 text-xs">
              {c.checked ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-success" />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border border-border" />
              )}
              <span className={cn(c.checked ? "text-foreground" : "text-muted-foreground")}>{c.name}</span>
              {c.mandatory && <span className="text-[10px] text-muted-foreground/70">(mandatory)</span>}
            </div>
          ))}
        </div>
      )}
      {shield.overrideReason && (
        <p className="text-xs text-muted-foreground">
          Override reason: <span className="font-medium text-foreground">{shield.overrideReason}</span>
          {shield.overrideNote ? ` — ${shield.overrideNote}` : ""}
        </p>
      )}
      {shield.dailyBiasSnapshot && shield.dailyBiasSnapshot !== "NEUTRAL" && (
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            shield.biasAligned
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          {shield.biasAligned ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          Daily Bias: {shield.dailyBiasSnapshot}
          {!shield.biasAligned && <span className="opacity-80">· Bias Conflict</span>}
        </div>
      )}
    </div>
  );
}
