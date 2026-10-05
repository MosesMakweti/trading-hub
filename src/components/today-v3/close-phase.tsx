"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CircleCheck, FlagOff, Loader2, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyShort } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SaveDot } from "@/components/today/today-ui";
import { formatRR, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { useDayRef } from "@/components/workspace/workspace-context";
import { closeTradingDayV3Action, saveDailyReflectionAction } from "@/actions/close-day.actions";
import { MISSED_OUTCOME_LABELS, MISS_REASON_LABELS } from "@/types/opportunity";
import type { DailyReflectionInput } from "@/lib/validation/close-day";
import type { CloseDayV3DTO } from "@/server/services/close-day-v3.service";
import type { AttentionItem } from "@/domain/today/close-day";
import type { TradeStageKey } from "@/domain/trades/trade-lifecycle";

type ReflectionKey = keyof DailyReflectionInput;

const INTENT_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  FOMO: "FOMO",
  REVENGE: "Revenge",
  BOREDOM: "Boredom",
  IMPULSE: "Impulse",
  MANUAL_OVERRIDE: "Manual override",
};

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);
const tradeLabel = (n: number | null, asset: string) => `${n != null ? `#${n} ` : ""}${asset}`;

/**
 * Today V3 (Phase 4) — CLOSE: one end-of-day surface replacing LIVE Today's
 * Day Summary + "Mark day reviewed" + Close dialog. What happened (derived),
 * did I follow my process (derived from the trades' reviews), what still
 * needs attention (derived), what did I learn and what's next session's
 * focus (asked once), then Close trading day. Incomplete final reviews and
 * open positions warn and confirm — they never block the close.
 */
export function ClosePhase({
  data,
  onOpenTrade,
  onOpenSetups,
  onReopen,
  reopening,
}: {
  data: CloseDayV3DTO;
  onOpenTrade: (tradeId: string, stage: TradeStageKey) => void;
  onOpenSetups: () => void;
  onReopen: () => void;
  reopening: boolean;
}) {
  const archived = data.status === "ARCHIVED";
  const dayRef = useDayRef(data.dateKey);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [closing, startClosing] = useTransition();
  // What the trader typed here, per field — sent with the close as a safety
  // net for an edit whose autosave hasn't landed (never the stale initial values).
  const edited = useRef<Partial<Record<ReflectionKey, string>>>({});
  const onEdit = (field: ReflectionKey, value: string) => {
    edited.current[field] = value;
  };

  const reviewItems = data.needsAttention.filter((i) => i.kind === "FINAL_REVIEW_REQUIRED");
  const needsConfirm = reviewItems.length > 0 || data.openPositions.length > 0;

  function close() {
    startClosing(async () => {
      const latest = Object.fromEntries(
        Object.entries(edited.current).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]),
      );
      const r = await closeTradingDayV3Action(dayRef, latest);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setConfirming(false);
      toast.success("Day closed — it's in your Journal.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {archived && <ClosedBanner data={data} onReopen={onReopen} reopening={reopening} />}

      <Performance data={data} />
      <Process data={data} />
      <NeedsAttention items={data.needsAttention} archived={archived} onOpenTrade={onOpenTrade} />
      <DayLists data={data} archived={archived} onOpenTrade={onOpenTrade} onOpenSetups={onOpenSetups} />

      <Section title="Reflection">
        <div className="grid gap-3 sm:grid-cols-2">
          <ReflectionField dateKey={data.dateKey} field="dayWentWell" label="What went well today?" initial={data.reflection.dayWentWell} readOnly={archived} onEdit={onEdit} />
          <ReflectionField dateKey={data.dateKey} field="dayToImprove" label="What needs improvement?" initial={data.reflection.dayToImprove} readOnly={archived} onEdit={onEdit} />
          <ReflectionField
            dateKey={data.dateKey}
            field="dayMainLesson"
            label="Main lesson"
            initial={data.reflection.dayMainLesson}
            readOnly={archived}
            onEdit={onEdit}
            className="sm:col-span-2"
          />
        </div>
      </Section>

      <Section title="Tomorrow">
        <ReflectionField
          dateKey={data.dateKey}
          field="dayCarryForward"
          label="What should I focus on next trading session?"
          placeholder="One concrete commitment — shown at the start of your next session."
          initial={data.reflection.dayCarryForward}
          readOnly={archived}
          onEdit={onEdit}
        />
      </Section>

      {!archived && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">Finished for today?</p>
            <p className="text-xs text-muted-foreground">
              Closing archives the day into your Journal. Open positions stay open; nothing is marked reviewed for you.
            </p>
          </div>
          <Button type="button" className="gap-1.5" disabled={closing} onClick={() => (needsConfirm ? setConfirming(true) : close())}>
            {closing ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
            Close trading day
          </Button>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Close the day with items outstanding?</DialogTitle>
            <DialogDescription>Closing never completes a review or closes a position for you.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {reviewItems.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-warning/30 bg-warning/10 p-3">
                <p className="flex items-center gap-1.5 font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  {reviewItems.length} trade{reviewItems.length === 1 ? " still requires" : "s still require"} a final review.
                </p>
                <p className="text-xs text-muted-foreground">
                  They stay “Final review required” after closing. To review a same-day trade later, reopen the day.
                </p>
                <ul className="space-y-1">
                  {reviewItems.map((i) => (
                    <li key={i.tradeId} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{tradeLabel(i.tradeNumber, i.assetSymbol)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setConfirming(false);
                          onOpenTrade(i.tradeId, "review");
                        }}
                      >
                        Review now
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.openPositions.length > 0 && (
              <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
                {data.openPositions.length} position{data.openPositions.length === 1 ? " will" : "s will"} carry forward —{" "}
                {data.openPositions.map((p) => `${tradeLabel(p.tradeNumber, p.assetSymbol)} (${p.openPercent}% open)`).join(", ")}. They
                remain open and manageable in your next session.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={closing}>
              Not yet
            </Button>
            <Button type="button" onClick={close} disabled={closing} className="gap-1.5">
              {closing ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
              Close day anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "danger" | "muted" }) {
  return (
    <div className="space-y-0.5" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ClosedBanner({ data, onReopen, reopening }: { data: CloseDayV3DTO; onReopen: () => void; reopening: boolean }) {
  const at = data.archivedAt ? new Date(data.archivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/5 px-4 py-3">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheck className="size-4 text-success" />
        <span className="font-medium">Day closed</span>
        {at && <span className="text-muted-foreground">· {at}</span>}
      </p>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onReopen} disabled={reopening}>
        {reopening ? <Loader2 className="size-3.5 animate-spin" /> : <FlagOff className="size-3.5" />}
        Reopen day
      </Button>
    </div>
  );
}

function Performance({ data }: { data: CloseDayV3DTO }) {
  const p = data.performance;
  return (
    <Section title="Today's performance">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Ideas" value={String(p.ideas)} hint="Every trade idea recorded today" />
        <Stat label="Executed" value={String(p.executed)} hint="Trades with an actual entry (Trades Used)" />
        <Stat label="Settled" value={String(p.settled)} hint="Settled by the Performance Account" />
        <Stat label="Open" value={String(p.open)} tone={p.open > 0 ? undefined : "muted"} />
        <Stat label="Cancelled" value={String(p.cancelled)} tone="muted" />
        <Stat label="Missed" value={String(p.missed)} tone="muted" hint={`${p.missedValid} scored valid`} />
        <Stat label="W / L / BE" value={`${p.wins} / ${p.losses} / ${p.breakevens}`} hint="Settled trades only" />
        <Stat label="Win rate" value={pct(p.winRatePercent)} hint="Wins ÷ settled trades" />
        <Stat label="Settled R" value={formatRR(p.settledR)} tone={p.settled === 0 ? "muted" : p.settledR >= 0 ? "success" : "danger"} />
        <Stat label="Settled PnL" value={formatSignedCurrency(p.settledPnl)} tone={p.settled === 0 ? "muted" : p.settledPnl >= 0 ? "success" : "danger"} />
        <Stat
          label="Risk used"
          value={`${Math.round(p.riskUsedPercent * 100) / 100}%${p.riskComplete ? "" : "+"}`}
          hint={p.riskComplete ? "Sum of frozen Performance risk" : "An executed trade has no risk snapshot — lower bound"}
        />
        {p.pendingSettlement > 0 && <Stat label="Pending settlement" value={String(p.pendingSettlement)} tone="muted" />}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Only settled trades are classified. An open or unsettled trade is never a win or a loss, whatever its running PnL.
      </p>
    </Section>
  );
}

function Process({ data }: { data: CloseDayV3DTO }) {
  const p = data.process;
  if (p.executed === 0 && p.limitOverrides === 0 && p.setupOverrides === 0) {
    return (
      <Section title="Process">
        <p className="text-sm text-muted-foreground">No executed trades today — nothing to read process from.</p>
      </Section>
    );
  }
  const motives = Object.entries(p.motives);
  return (
    <Section
      title="Process"
      aside={
        <span className="text-[11px] text-muted-foreground">
          From your trade reviews · {p.finalReviewsComplete} final review{p.finalReviewsComplete === 1 ? "" : "s"} complete
        </span>
      }
    >
      <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {p.adherence.map((a) => (
          <div key={a.key} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{a.prompt}</span>
            <span className="font-mono text-xs tabular-nums">
              <span className="text-success">{a.yes} yes</span> · <span className={a.no > 0 ? "text-warning" : ""}>{a.no} no</span>
              {a.unanswered > 0 && <span className="text-muted-foreground"> · {a.unanswered} unanswered</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
        <Stat label="Setup quality (avg)" value={pct(p.averageSetupScore)} hint={`${p.setupInvalidCount} invalid setup${p.setupInvalidCount === 1 ? "" : "s"}`} />
        <Stat label="Execution quality (avg)" value={pct(p.averageExecutionPercent)} />
        <Stat label="Psychology (avg)" value={pct(p.averagePsychologyPercent)} hint={`${p.psychologyCount} scored`} />
        <Stat label="Would not take again" value={String(p.wouldNotTakeAgain)} tone="muted" />
        <Stat label="Daily-limit overrides" value={String(p.limitOverrides)} tone={p.limitOverrides > 0 ? undefined : "muted"} />
        <Stat label="Setup-validation overrides" value={String(p.setupOverrides)} tone={p.setupOverrides > 0 ? undefined : "muted"} />
      </div>
      {motives.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Motive: {motives.map(([k, n]) => `${INTENT_LABEL[k] ?? k} ${n}`).join(" · ")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Process is read separately from outcome — a green day isn&apos;t automatically a good-process day, or vice versa.</p>
    </Section>
  );
}

function NeedsAttention({
  items,
  archived,
  onOpenTrade,
}: {
  items: AttentionItem[];
  archived: boolean;
  onOpenTrade: (tradeId: string, stage: TradeStageKey) => void;
}) {
  return (
    <Section title={`Needs attention${items.length > 0 ? ` — ${items.length}` : ""}`}>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" />
          Nothing outstanding.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={`${i.kind}:${i.tradeId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm">
                  <span className="font-medium">{i.title}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{tradeLabel(i.tradeNumber, i.assetSymbol)}</span>
                  {i.carried && <span className="ml-1 text-xs text-muted-foreground">(carried)</span>}
                </p>
                <p className="text-xs text-muted-foreground">{i.detail}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => onOpenTrade(i.tradeId, i.stage)}>
                {i.kind === "FINAL_REVIEW_REQUIRED" && !archived ? "Review now" : "Open"}
                <ArrowRight className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DayLists({
  data,
  archived,
  onOpenTrade,
  onOpenSetups,
}: {
  data: CloseDayV3DTO;
  archived: boolean;
  onOpenTrade: (tradeId: string, stage: TradeStageKey) => void;
  onOpenSetups: () => void;
}) {
  const { missedOpportunities: missed, cancelledIdeas: cancelled, limitOverrides, setupOverrides, openPositions } = data;
  if (missed.length + cancelled.length + limitOverrides.length + setupOverrides.length + openPositions.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {openPositions.length > 0 && (
        <Section title={`Open positions — ${openPositions.length}`}>
          <p className="text-xs text-muted-foreground">
            {`${openPositions.length} position${openPositions.length === 1 ? " will" : "s will"} carry forward.`} Closing the day doesn&apos;t close a
            trade.
          </p>
          <ul className="space-y-1 text-sm">
            {openPositions.map((p) => (
              <li key={p.tradeId} className="flex items-center justify-between gap-2">
                <button type="button" className="font-mono hover:underline" onClick={() => onOpenTrade(p.tradeId, "execution")}>
                  {tradeLabel(p.tradeNumber, p.assetSymbol)}
                </button>
                <span className="text-xs text-muted-foreground">
                  {p.openPercent}% open{p.carried ? ` · from ${formatDateKeyShort(p.tradeDateKey)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(missed.length > 0 || cancelled.length > 0) && (
        <Section
          title={`Missed opportunities — ${missed.length}`}
          aside={
            !archived && (
              <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onOpenSetups}>
                Edit setups
                <ArrowRight className="size-3" />
              </Button>
            )
          }
        >
          {missed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No missed setups recorded today.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {missed.map((m) => (
                <li key={m.id} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono font-semibold">{m.assetSymbol}</span>
                    <span className={m.direction === "LONG" ? "text-success" : "text-danger"}>{m.direction === "LONG" ? "Long" : "Short"}</span>
                    {m.strategyName && <span className="text-muted-foreground">{m.strategyName}</span>}
                    {m.setupValid === false && <span className="text-xs text-muted-foreground">· setup scored invalid</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      m.missReason ? MISS_REASON_LABELS[m.missReason] : null,
                      m.missedOutcome ? MISSED_OUTCOME_LABELS[m.missedOutcome] : null,
                      m.missedRealizedR != null && m.missedOutcome !== "MISSED_UNDETERMINED" ? formatRR(m.missedRealizedR) : null,
                      m.originTrade ? `from cancelled idea #${m.originTrade.tradeNumber ?? "?"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {cancelled.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-xs font-medium text-muted-foreground">
                Cancelled ideas: {cancelled.length} <span className="font-normal">(not counted as missed or executed)</span>
              </p>
              <ul className="space-y-1 text-sm">
                {cancelled.map((c) => (
                  <li key={c.tradeId} className="flex items-center justify-between gap-2">
                    <button type="button" className="font-mono hover:underline" onClick={() => onOpenTrade(c.tradeId, "review")}>
                      {tradeLabel(c.tradeNumber, c.assetSymbol)}
                    </button>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.recordedAsMissed ? "Recorded as missed" : (c.cancellationReason ?? "Cancelled before entry")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {(limitOverrides.length > 0 || setupOverrides.length > 0) && (
        <Section title="Overrides">
          {limitOverrides.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Daily-limit overrides: {limitOverrides.length}</p>
              {limitOverrides.map((o) => (
                <div key={o.tradeId} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <button type="button" className="font-mono text-xs hover:underline" onClick={() => onOpenTrade(o.tradeId, "review")}>
                    {tradeLabel(o.tradeNumber, o.assetSymbol)}
                  </button>
                  <p className="mt-0.5">“{o.reason}”</p>
                  {o.context && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {[
                        o.context.kinds.includes("MAX_TRADES") && o.context.maxTrades != null
                          ? `Max trades: ${o.context.executedCount} of ${o.context.maxTrades} already used`
                          : null,
                        o.context.kinds.includes("DAILY_RISK") && o.context.riskLimitPercent != null
                          ? `Risk: ${o.context.riskUsedPercent}% used of ${o.context.riskLimitPercent}%${o.context.projectedRiskPercent != null ? ` · +${o.context.projectedRiskPercent}% projected` : ""}`
                          : null,
                        o.context.at ? `at ${new Date(o.context.at).toLocaleTimeString(undefined, { timeStyle: "short" })}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {setupOverrides.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Setup-validation overrides: {setupOverrides.length}</p>
              {setupOverrides.map((o) => (
                <p key={o.tradeId} className="text-sm">
                  <button type="button" className="font-mono text-xs hover:underline" onClick={() => onOpenTrade(o.tradeId, "review")}>
                    {tradeLabel(o.tradeNumber, o.assetSymbol)}
                  </button>{" "}
                  <span className="text-muted-foreground">{[o.reason?.replaceAll("_", " ").toLowerCase(), o.note].filter(Boolean).join(" — ")}</span>
                </p>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function ReflectionField({
  dateKey,
  field,
  label,
  placeholder = "Optional…",
  initial,
  readOnly,
  onEdit,
  className,
}: {
  dateKey: string;
  field: ReflectionKey;
  label: string;
  placeholder?: string;
  initial: string | null;
  readOnly: boolean;
  onEdit: (field: ReflectionKey, value: string) => void;
  className?: string;
}) {
  const dayRef = useDayRef(dateKey);
  const [value, setValue] = useState(initial ?? "");
  const state = useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: (v) => saveDailyReflectionAction(dayRef, { [field]: v.trim() } as DailyReflectionInput),
    onError: (m) => {
      if (m) toast.error(m);
    },
  });
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor={`day-${field}`}>
          {label}
        </label>
        {!readOnly && <SaveDot state={state} />}
      </div>
      {readOnly ? (
        <p id={`day-${field}`} className="min-h-9 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">
          {value.trim() || <span className="text-muted-foreground">—</span>}
        </p>
      ) : (
        <Textarea
          id={`day-${field}`}
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            onEdit(field, e.target.value);
          }}
        />
      )}
    </div>
  );
}
