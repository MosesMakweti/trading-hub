"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { SaveDot } from "@/components/today/today-ui";
import type { SaveState } from "@/hooks/use-debounced-autosave";
import { updateTodaysPlan } from "@/actions/today.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import {
  confirmationState,
  suggestLimit,
  suggestSessions,
  summarizeDayRules,
  type LimitSuggestion,
} from "@/domain/today/rule-suggestions";
import type { SessionWindow } from "@/domain/schedule/session-countdown";
import type { TodaysPlanDTO, TodaysRulesDTO, TodaysRulesStrategyDTO } from "@/types/today";

function fmt(n: number) {
  return Number(n.toFixed(2)).toString();
}

/**
 * One soft day limit. SYSTEM SUGGESTS (Strategy Lab, strictest of today's
 * strategies) → TRADER CONFIRMS (explicit button). The input may show the
 * suggestion as a starting value, but nothing is stored until Confirm, so a
 * suggestion can never masquerade as a decision. A confirmed value that
 * differs from the suggestion stays as the trader set it.
 */
function LimitRow({
  label,
  unit,
  suggestion,
  confirmed,
  validate,
  onSave,
  disabled,
}: {
  label: string;
  unit: "%" | "trades";
  suggestion: LimitSuggestion | null;
  confirmed: number | null;
  validate: (n: number) => string | null;
  onSave: (value: number | null) => Promise<boolean>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(
    confirmed != null ? fmt(confirmed) : suggestion != null ? fmt(suggestion.value) : "",
  );
  const [pending, start] = useTransition();
  const state = confirmationState(suggestion?.value ?? null, confirmed);

  const parsed = draft.trim() === "" ? null : Number(draft);
  const error = parsed == null ? null : Number.isNaN(parsed) ? "Enter a number." : validate(parsed);
  const isDirty = parsed == null ? confirmed != null : confirmed == null || Math.abs(parsed - confirmed) > 1e-9;
  const canConfirm = !disabled && !error && parsed != null && isDirty;

  function confirm(value: number | null) {
    start(async () => {
      const ok = await onSave(value);
      if (ok && value == null) setDraft(suggestion != null ? fmt(suggestion.value) : "");
    });
  }

  const unitLabel = unit === "%" ? "%" : " trades";
  const sourceNote = suggestion
    ? suggestion.sources.length > 1
      ? `strictest of ${suggestion.sources.length}: ${suggestion.strictestFrom.join(", ")}`
      : suggestion.strictestFrom[0]
    : null;

  return (
    <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start">
      <div className="pt-1.5 text-sm font-medium">{label}</div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={unit === "%" ? "0.1" : "1"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={label}
              aria-invalid={error ? true : undefined}
              disabled={disabled}
              className="h-8 w-24 font-mono tabular-nums"
            />
            <span className="text-sm text-muted-foreground">{unit === "%" ? "%" : "trades"}</span>
          </div>
          {canConfirm && (
            <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => confirm(parsed)} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {confirmed == null ? "Confirm" : "Update"}
            </Button>
          )}
          {confirmed != null && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => confirm(null)}
              disabled={pending}
            >
              Clear
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {state === "SUGGESTED" && (
            <span className="text-warning">Not confirmed yet</span>
          )}
          {(state === "CONFIRMED" || state === "CONFIRMED_DIFFERENT" || state === "CONFIRMED_MANUAL") && confirmed != null && (
            <span className="flex items-center gap-1 text-success">
              <Check className="size-3" />
              Confirmed today: <span className="font-mono tabular-nums">{fmt(confirmed)}{unitLabel}</span>
            </span>
          )}
          {suggestion && (
            <span className="text-muted-foreground" title={suggestion.sources.map((s) => `${s.strategyName}: ${fmt(s.value)}${unitLabel}`).join("\n")}>
              Suggested <span className="font-mono tabular-nums text-foreground">{fmt(suggestion.value)}{unitLabel}</span> from {sourceNote}
            </span>
          )}
          {!suggestion && state === "NOT_SET" && (
            <span className="text-muted-foreground">No limit in today&apos;s strategies — set one if you trade with one.</span>
          )}
        </p>
        {suggestion && suggestion.sources.length > 1 && (
          <ul className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground" aria-label={`${label} by strategy`}>
            {suggestion.sources.map((s) => (
              <li key={s.strategyId} className="rounded border border-border px-1.5 py-0.5 font-mono tabular-nums">
                {s.strategyName} {fmt(s.value)}{unitLabel}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ManagementReference({ strategy }: { strategy: TodaysRulesStrategyDTO }) {
  const m = strategy.management;
  const rows: [string, string | null][] = [
    [
      "Partial TPs",
      m.partialTakeProfits.length > 0
        ? m.partialTakeProfits
            .map((p) => [p.percentToClose != null ? `${fmt(p.percentToClose)}%` : null, p.trigger, p.reason].filter(Boolean).join(" · "))
            .join("  |  ")
        : null,
    ],
    ["Stop placement", m.initialStopPlacement],
    ["Break-even", m.breakEven],
    ["Trailing", m.trailing],
    ["Scaling in", m.scalingIn],
    ["Scaling out", m.scalingOut],
    ["Max holding", m.maxHoldingTime],
    ["Custom rules", m.customRules.length > 0 ? m.customRules.join("  |  ") : null],
  ];
  const filled = rows.filter(([, v]) => v);

  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm select-none">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">{strategy.name}</span>
        <span className="text-xs text-muted-foreground">
          {filled.length === 0 ? "no management rules set" : `${filled.length} rule${filled.length === 1 ? "" : "s"}`}
        </span>
      </summary>
      {filled.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1.5 border-t border-border px-3 py-2.5 text-xs sm:grid-cols-[110px_minmax(0,1fr)]">
          {filled.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}

/**
 * Today V3 — "Today's Rules": what Traditorium already knows about today's
 * boundaries, from Strategy Lab (today's active strategies) and the
 * Performance Account. Limits are suggested and explicitly confirmed into
 * the existing TradingDay columns; sessions keep their existing autosave;
 * management rules are a read-only reference (never copied onto the day).
 */
export function TodaysRules({
  dateKey,
  plan,
  rules,
  sessionWindows,
  readOnly,
}: {
  dateKey: string;
  plan: TodaysPlanDTO;
  rules: TodaysRulesDTO | null;
  sessionWindows: SessionWindow[];
  readOnly: boolean;
}) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const strategies = rules?.strategies ?? [];
  const limitSources = strategies.map((s) => ({
    strategyId: s.id,
    strategyName: s.name,
    maxDailyRiskPercent: s.maxDailyRiskPercent,
    maxTradesPerDay: s.maxTradesPerDay,
  }));
  const riskSuggestion = suggestLimit(limitSources, "maxDailyRiskPercent");
  const tradesSuggestion = suggestLimit(limitSources, "maxTradesPerDay");

  const [sessions, setSessions] = useState<string[]>(plan.activeSessions);
  const [sessionsSave, setSessionsSave] = useState<SaveState>("idle");
  const sessionSuggestions = suggestSessions(
    strategies.length > 0 ? strategies.map((s) => s.sessions) : [sessionWindows.map((w) => w.name)],
    sessions,
  );

  async function saveLimit(patch: { riskBudgetPercent?: number | null; maxTradesPerDay?: number | null }) {
    const r = await updateTodaysPlan(dayRef, patch);
    if (!r.success) {
      toast.error(r.error);
      return false;
    }
    router.refresh(); // status strip limit state
    return true;
  }

  async function changeSessions(next: string[]) {
    setSessions(next);
    setSessionsSave("saving");
    const r = await updateTodaysPlan(dayRef, { activeSessions: next });
    if (r.success) setSessionsSave("saved");
    else {
      setSessionsSave("error");
      toast.error(r.error);
    }
  }

  const caps = strategies.filter((s) => s.maxRiskPercent != null);

  return (
    <div className="space-y-4">
      {strategies.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Pick an active strategy on an asset below to see your Strategy Lab limits suggested here. You can still set
          today&apos;s limits by hand.
        </p>
      )}

      <LimitRow
        key={`risk-${plan.riskBudgetPercent ?? "none"}-${riskSuggestion?.value ?? "none"}`}
        label="Daily risk limit"
        unit="%"
        suggestion={riskSuggestion}
        confirmed={plan.riskBudgetPercent}
        validate={(n) => (n < 0 || n > 100 ? "Risk budget must be 0–100%." : null)}
        onSave={(v) => saveLimit({ riskBudgetPercent: v })}
        disabled={readOnly}
      />
      <LimitRow
        key={`trades-${plan.maxTradesPerDay ?? "none"}-${tradesSuggestion?.value ?? "none"}`}
        label="Max trades"
        unit="trades"
        suggestion={tradesSuggestion}
        confirmed={plan.maxTradesPerDay}
        validate={(n) => (n < 0 || !Number.isInteger(n) ? "Max trades must be a whole number." : null)}
        onSave={(v) => saveLimit({ maxTradesPerDay: v })}
        disabled={readOnly}
      />

      <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="text-sm font-medium">Risk per trade</div>
        <p className="text-sm text-muted-foreground">
          {rules ? (
            <>
              <span className="font-mono tabular-nums text-foreground">{fmt(rules.performance.defaultRiskPercent)}%</span> default
              {rules.performance.maxRiskPercent != null && (
                <>
                  {" "}· <span className="font-mono tabular-nums text-foreground">{fmt(rules.performance.maxRiskPercent)}%</span> max
                </>
              )}{" "}
              <span className="text-xs">(Performance account)</span>
              {caps.map((s) => (
                <span key={s.id} className="ml-2 text-xs">
                  · {s.name} cap <span className="font-mono tabular-nums text-foreground">{fmt(s.maxRiskPercent!)}%</span>
                </span>
              ))}
            </>
          ) : (
            "—"
          )}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex items-center gap-1.5 pt-1.5 text-sm font-medium">
          Sessions
          <SaveDot state={sessionsSave} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <AssetTagInput value={sessions} onChange={changeSessions} disabled={readOnly} placeholder="e.g. London, New York" />
          {!readOnly && sessionSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">
                {strategies.length > 0 ? "From today's strategies:" : "Your session windows:"}
              </span>
              {sessionSuggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => changeSessions([...sessions, name])}
                  className="flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
                >
                  <Plus className="size-3" />
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {strategies.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="pt-2 text-sm font-medium">Management rules</div>
          <div className={cn("min-w-0 space-y-1.5")}>
            {strategies.map((s) => (
              <ManagementReference key={s.id} strategy={s} />
            ))}
            <p className="text-[11px] text-muted-foreground">Read-only — edit these in Strategy Lab.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Plan UX — the compact, quiet form of Today's Rules: one line of what's
 * already known (inherited limits, risk per trade, sessions), a single
 * "Confirm" when Strategy Lab suggests limits the trader hasn't confirmed
 * yet (writes exactly the suggested values into the same TradingDay
 * columns — a suggestion is still never stored without that click), and
 * "View strategy rules" for the full editable detail (TodaysRules).
 */
export function RulesSummary({
  dateKey,
  plan,
  rules,
  sessionWindows,
  readOnly,
}: {
  dateKey: string;
  plan: TodaysPlanDTO;
  rules: TodaysRulesDTO | null;
  sessionWindows: SessionWindow[];
  readOnly: boolean;
}) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const strategies = rules?.strategies ?? [];
  const summary = summarizeDayRules(
    strategies.map((s) => ({ strategyId: s.id, strategyName: s.name, maxDailyRiskPercent: s.maxDailyRiskPercent, maxTradesPerDay: s.maxTradesPerDay })),
    { riskBudgetPercent: plan.riskBudgetPercent, maxTradesPerDay: plan.maxTradesPerDay },
    { active: plan.activeSessions, strategySessions: strategies.map((s) => s.sessions) },
  );

  function confirmAll() {
    if (!summary.confirmPatch) return;
    const patch = summary.confirmPatch;
    start(async () => {
      const r = await updateTodaysPlan(dayRef, patch);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      router.refresh();
    });
  }

  const item = (label: string, value: string, muted = false) => (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span className={cn("font-mono tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>{value}</span>
    </span>
  );

  return (
    <section aria-label="Strategy rules" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {summary.noLimits ? (
          <span className="text-muted-foreground">No daily limits set</span>
        ) : summary.allConfirmed ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5" />
            Strategy rules
          </span>
        ) : (
          <span className="text-warning">Rules not confirmed</span>
        )}
        {summary.risk.value != null && item("Risk", `${fmt(summary.risk.value)}%`, summary.risk.state === "SUGGESTED")}
        {summary.maxTrades.value != null && item("Max trades", fmt(summary.maxTrades.value), summary.maxTrades.state === "SUGGESTED")}
        {rules && item("Per trade", `${fmt(rules.performance.defaultRiskPercent)}%`)}
        {summary.sessions.names.length > 0 && (
          <span className={cn("whitespace-nowrap", summary.sessions.suggested ? "text-muted-foreground" : "text-foreground")}>
            {summary.sessions.names.join(", ")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {summary.confirmPatch && !readOnly && (
            <Button type="button" size="sm" className="h-7 gap-1.5" onClick={confirmAll} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Confirm
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {summary.noLimits && !readOnly ? "Set limits" : "View strategy rules"}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </span>
      </div>
      {open && (
        <div className="rounded-xl border border-border/60 p-4">
          <TodaysRules dateKey={dateKey} plan={plan} rules={rules} sessionWindows={sessionWindows} readOnly={readOnly} />
        </div>
      )}
    </section>
  );
}
