"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, CircleDashed, Loader2, Plus, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { saveDayAuditAction, setDayStatusAction } from "@/actions/trade-audit.actions";
import { NO_TRADE_REASON_LABEL } from "@/domain/trade-audit/labels";
import { NO_TRADE_REASONS, type AuditDayDTO, type DailyAuditStatusValue, type NoTradeReasonValue } from "@/types/trade-audit";
import { dayLabel, fmtR, toneOf, useAudit } from "@/components/edge/audit/audit-context";
import { AutosaveText } from "@/components/edge/audit/audit-fields";
import { AuditEvidenceGallery } from "@/components/edge/audit/audit-evidence-gallery";
import { ActualTradeCell, TradeJudgmentCell } from "@/components/edge/audit/audit-trade-cells";
import { AddExpectedTradeForm, ExpectedTradeCell, LiveMissedCell, NotTakenCell } from "@/components/edge/audit/audit-expected-cells";

export const DAY_STATUS: Record<DailyAuditStatusValue, { label: string; icon: typeof Circle; className: string }> = {
  NOT_STARTED: { label: "Not started", icon: CircleDashed, className: "text-muted-foreground" },
  IN_PROGRESS: { label: "In progress", icon: Circle, className: "text-warning-foreground dark:text-warning" },
  COMPLETED: { label: "Reviewed", icon: CheckCircle2, className: "text-success" },
};

/**
 * One decision = one row: ACTUAL on the left, EXPECTED on the right. On small
 * screens the two halves stack, each labelled, so the comparison survives.
 */
function DecisionRow({ actual, expected, highlight }: { actual: React.ReactNode; expected: React.ReactNode; highlight?: "invalid" | "missed" }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 overflow-hidden rounded-xl border lg:grid-cols-2",
        highlight === "invalid" ? "border-danger/40" : highlight === "missed" ? "border-amber-500/40" : "border-border",
      )}
    >
      <div className="border-l-[3px] border-l-sky-500/70 p-3">
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-sky-700 uppercase lg:hidden dark:text-sky-300">Actual</p>
        {actual}
      </div>
      <div className="border-t border-l-[3px] border-t-border border-l-amber-500/70 bg-amber-500/[0.03] p-3 lg:border-t-0">
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-amber-700 uppercase lg:hidden dark:text-amber-300">Expected</p>
        {expected}
      </div>
    </div>
  );
}

function NoTradeCell({ day }: { day: AuditDayDTO }) {
  const router = useRouter();
  const { scope, locked } = useAudit();
  const [reason, setReason] = useState<NoTradeReasonValue | null>(day.noTradeReason);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">No trades taken</p>
      <p className="text-xs text-muted-foreground">Why? Not trading is a decision worth judging too.</p>
      <div className="grid gap-1.5" role="radiogroup" aria-label="Why no trades were taken">
        {NO_TRADE_REASONS.filter((r) => !locked || r === reason).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            disabled={locked || pending}
            onClick={() => {
              const next = reason === r ? null : r;
              setReason(next);
              startTransition(async () => {
                const result = await saveDayAuditAction({ scope, dateKey: day.dateKey, patch: { noTradeReason: next } });
                if (!result.success) toast.error(result.error);
                else router.refresh();
              });
            }}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-default",
              reason === r ? "border-primary/60 bg-primary/10" : "border-border hover:border-foreground/30",
            )}
          >
            <span className="block text-xs font-medium">{NO_TRADE_REASON_LABEL[r].label}</span>
            <span className="block text-[11px] text-muted-foreground">{NO_TRADE_REASON_LABEL[r].hint}</span>
          </button>
        ))}
      </div>
      {day.schedule === "DAY_OFF" && !reason && <p className="text-[11px] text-muted-foreground">Marked as a day off in your schedule.</p>}
    </div>
  );
}

export function AuditDaySection({ day, defaultOpen }: { day: AuditDayDTO; defaultOpen: boolean }) {
  const router = useRouter();
  const { scope, locked } = useAudit();
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = dayLabel(day.dateKey);
  const status = DAY_STATUS[day.status];
  const StatusIcon = status.icon;

  const executed = day.trades.filter((t) => t.outcome !== "CANCELLED");
  const netR = executed.reduce((s, t) => s + (t.realizedR ?? 0), 0);
  const invalid = day.trades.filter((t) => day.assessments[t.id]?.verdict === "INVALID").length;
  const missed = day.expectedTrades.length + day.liveMissed.length;
  // In-progress: edits/moves are flagged on the trade's own row. Finalized:
  // every drift is listed in the day banner (the rows show the frozen week).
  const changeByTrade = new Map(locked ? [] : day.changes.filter((c) => c.kind === "EDITED" || c.kind === "MOVED").map((c) => [c.tradeId, c]));
  const otherChanges = locked ? day.changes : day.changes.filter((c) => c.kind === "REMOVED");

  const saveDay = (field: "wentWell" | "wentWrong" | "couldDoBetter" | "mainLesson") => (value: string | null) => saveDayAuditAction({ scope, dateKey: day.dateKey, patch: { [field]: value } });

  function setStatus(next: "IN_PROGRESS" | "COMPLETED") {
    startTransition(async () => {
      const result = await setDayStatusAction({ scope, dateKey: day.dateKey, status: next });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (next === "COMPLETED") {
        toast.success(`${label.weekday} reviewed.`);
        setOpen(false);
      }
      router.refresh();
    });
  }

  return (
    <section id={`day-${day.dateKey}`} aria-labelledby={`day-${day.dateKey}-title`} className="glass scroll-mt-20 rounded-2xl">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-left">
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <h2 id={`day-${day.dateKey}-title`} className="text-base font-semibold">
            {label.weekday} <span className="font-normal text-muted-foreground">{label.date}</span>
          </h2>
        </button>
        {day.schedule === "DAY_OFF" && <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Day off</span>}
        {day.schedule === "UNSCHEDULED" && <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Outside your schedule</span>}
        <span className="text-xs text-muted-foreground">
          {executed.length} {executed.length === 1 ? "trade" : "trades"}
          {executed.length > 0 && <span className={cn("ml-1.5 font-mono font-medium", toneOf(netR))}>{fmtR(netR)}</span>}
        </span>
        {invalid > 0 && <span className="rounded bg-danger/10 px-1.5 py-px text-[11px] font-medium text-danger">{invalid} invalid</span>}
        {missed > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300">{missed} missed</span>}
        {day.changes.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-px text-[11px] font-medium text-warning-foreground dark:text-warning">
            <AlertTriangle className="size-3" /> Trades changed
          </span>
        )}
        <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium", status.className)}>
          <StatusIcon className="size-3.5" /> {status.label}
        </span>
        {!locked &&
          (day.status === "COMPLETED" ? (
            <Button type="button" variant="ghost" size="sm" className="gap-1" disabled={pending} onClick={() => setStatus("IN_PROGRESS")}>
              <RotateCcw className="size-3.5" /> Reopen day
            </Button>
          ) : (
            <Button type="button" size="sm" className="gap-1" disabled={pending} onClick={() => setStatus("COMPLETED")}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Mark day reviewed
            </Button>
          ))}
      </header>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {otherChanges.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" />
                {locked ? "The live trades no longer match this finalized day" : "A trade you assessed is no longer in this week"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {otherChanges.map((c) => (
                  <li key={`${c.kind}-${c.tradeId}`}>
                    {c.label}: {c.kind === "ADDED" ? "added after finalizing" : c.kind === "REMOVED" ? "deleted or moved out of this week" : `${c.kind === "MOVED" ? "moved" : "edited"} (${c.fields.join(", ")})`}
                  </li>
                ))}
              </ul>
              {locked && <p className="mt-1 text-muted-foreground">This review keeps what you saw when you finalized it. Reopen the week to re-review against the current trades.</p>}
            </div>
          )}

          <div className="hidden grid-cols-2 gap-0 text-[11px] font-semibold tracking-wider uppercase lg:grid">
            <p className="pl-3 text-sky-700 dark:text-sky-300">Actual trading</p>
            <p className="pl-3 text-amber-700 dark:text-amber-300">Expected / ideal decisions</p>
          </div>

          {day.trades.map((t) => (
            <DecisionRow
              key={t.id}
              highlight={day.assessments[t.id]?.verdict === "INVALID" ? "invalid" : undefined}
              actual={<ActualTradeCell trade={t} />}
              expected={<TradeJudgmentCell trade={t} assessment={day.assessments[t.id]} change={changeByTrade.get(t.id)} />}
            />
          ))}

          {day.trades.length === 0 && (
            <DecisionRow
              actual={<NoTradeCell day={day} />}
              expected={
                missed === 0 ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">Was staying flat correct?</p>
                    <p>If a valid setup appeared that you didn&apos;t take, record it below so the miss is judged against your strategy.</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Missed setups for this day are listed below.</p>
                )
              }
            />
          )}

          {day.liveMissed.map((o) => (
            <DecisionRow key={o.id} highlight="missed" actual={<NotTakenCell />} expected={<LiveMissedCell opportunity={o} />} />
          ))}
          {day.expectedTrades.map((e) => (
            <DecisionRow key={e.id} highlight="missed" actual={<NotTakenCell />} expected={<ExpectedTradeCell expected={e} />} />
          ))}

          {!locked &&
            (adding ? (
              <div className="lg:ml-[50%] lg:pl-1">
                <AddExpectedTradeForm dateKey={day.dateKey} defaultAsset={scope.assetSymbols.length === 1 ? scope.assetSymbols[0] : undefined} onDone={() => setAdding(false)} />
              </div>
            ) : (
              <div className="flex lg:justify-end">
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setAdding(true)}>
                  <Plus className="size-3.5" /> Record a trade I should have taken
                </Button>
              </div>
            ))}

          <div className="space-y-3 rounded-xl border border-border p-3">
            <h3 className="text-sm font-semibold">{label.weekday}&apos;s reflection</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <AutosaveText label="What went well?" initial={day.wentWell} disabled={locked} onSave={saveDay("wentWell")} />
              <AutosaveText label="What went wrong?" initial={day.wentWrong} disabled={locked} onSave={saveDay("wentWrong")} />
              <AutosaveText label="What could I have done better?" initial={day.couldDoBetter} disabled={locked} onSave={saveDay("couldDoBetter")} />
              <AutosaveText label="Main lesson from today" initial={day.mainLesson} disabled={locked} onSave={saveDay("mainLesson")} />
            </div>
            {locked && !day.wentWell && !day.wentWrong && !day.couldDoBetter && !day.mainLesson && <p className="text-xs text-muted-foreground">No reflection recorded.</p>}
            <div className="space-y-1">
              <p className="text-xs font-medium">Day screenshots</p>
              <AuditEvidenceGallery images={day.dayImages} upload={{ kind: "DAY", dateKey: day.dateKey }} category="DAY" compact emptyLabel={locked ? "None." : undefined} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
