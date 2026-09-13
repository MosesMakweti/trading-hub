"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  SkipForward,
  Trash2,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildSetupValidationSnapshot } from "@/domain/trades/setup-validation";
import { findHistoricalScenario, toReplayResolvedConditions } from "@/domain/replay/replay-validation";
import {
  cancelReplayTradePendingOrder,
  closeReplayTradePartialManually,
  closeReplayTradeRemainingManually,
  createReplayDecision,
  getReplayHistoricalStrategyContext,
  moveReplayTradeStopLoss,
  resolveReplayTradeAmbiguity,
  updateReplayTradeReasoningNote,
} from "@/actions/replay.actions";
import type { HistoricalStrategyContextDTO, ReplayTradeDTO } from "@/types/replay";
import { Crosshair, Clock3 } from "lucide-react";

/** Stage 18 §12 — a field currently "armed" to receive its next value from a
 *  chart click, and the point the chart last delivered once one lands.
 *  `nonce` changes on every click so the effect that consumes `point` fires
 *  even if the trader clicks the exact same price twice in a row. */
export interface ChartPriceSelection {
  armedField: "entry" | "stop" | `target-${number}` | null;
  point: { time: number; price: number } | null;
  nonce: number;
}

const NO_STRATEGY = "__none__";
const NO_SETUP = "__none__";

const OVERRIDE_REASONS: { value: string; label: string }[] = [
  { value: "ANTICIPATING_CONFIRMATION", label: "Anticipating confirmation" },
  { value: "DISCRETIONARY_OVERRIDE", label: "Discretionary override" },
  { value: "FOMO", label: "Fear of missing the move" },
  { value: "MOMENTUM_FAST_MARKET", label: "Momentum / fast market" },
  { value: "NEWS_DRIVEN", label: "News-driven setup" },
  { value: "OTHER", label: "Other" },
];

const ACTIVE_LIFECYCLES = new Set(["PLANNED", "PENDING", "OPEN", "PARTIALLY_CLOSED"]);

function fmt(n: number | null): string {
  return n == null ? "—" : n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The Replay decision/position widget (Stage 14 §2, §9, §15, §34) — the
 * side panel next to the (visually dominant) chart. Shows the decision form
 * when there's no open simulated position for the current asset, or the
 * position panel once one exists. Never reads or renders a real Trade.
 */
export function ReplayDecisionPanel({
  sessionId,
  asset,
  currentTime,
  executionPrice,
  unrealizedR,
  strategies,
  activeTrade,
  onTradeChanged,
  priceSelection,
  onArmField,
}: {
  sessionId: string;
  asset: string;
  currentTime: number;
  /** The finest-data currently-available Replay price (§11/§13) — the ONLY
   *  price a MARKET order may fill at. Null while base data hasn't loaded. */
  executionPrice: number | null;
  /** Stage 18 §21-22 — strictly derived server-side from `executionPrice`
   *  (never computed here — §41). Null when flat/pending/closed. */
  unrealizedR: number | null;
  strategies: { id: string; name: string }[];
  activeTrade: ReplayTradeDTO | null;
  onTradeChanged: (trade: ReplayTradeDTO) => void;
  /** Stage 18 §12 — chart-assisted price selection state, owned by the
   *  parent (which also owns the chart's click handler) so a click can
   *  reach whichever field is currently armed. */
  priceSelection: ChartPriceSelection;
  onArmField: (field: ChartPriceSelection["armedField"]) => void;
}) {
  if (activeTrade && ACTIVE_LIFECYCLES.has(activeTrade.lifecycle)) {
    return <ReplayPositionPanel trade={activeTrade} currentTime={currentTime} unrealizedR={unrealizedR} onTradeChanged={onTradeChanged} />;
  }
  return (
    <ReplayNewDecisionForm
      sessionId={sessionId}
      asset={asset}
      currentTime={currentTime}
      executionPrice={executionPrice}
      strategies={strategies}
      onTradeChanged={onTradeChanged}
      priceSelection={priceSelection}
      onArmField={onArmField}
    />
  );
}

function ReplayNewDecisionForm({
  sessionId,
  asset,
  currentTime,
  executionPrice,
  strategies,
  onTradeChanged,
  priceSelection,
  onArmField,
}: {
  sessionId: string;
  asset: string;
  currentTime: number;
  executionPrice: number | null;
  strategies: { id: string; name: string }[];
  onTradeChanged: (trade: ReplayTradeDTO) => void;
  priceSelection: ChartPriceSelection;
  onArmField: (field: ChartPriceSelection["armedField"]) => void;
}) {
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [historicalContext, setHistoricalContext] = useState<HistoricalStrategyContextDTO | null | undefined>(undefined);
  const [loadingContext, setLoadingContext] = useState(false);
  const [setupTypeName, setSetupTypeName] = useState<string | null>(null);
  const [selectedConditionIds, setSelectedConditionIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState<string | null>(null);
  const [overrideNote, setOverrideNote] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  const [orderType, setOrderType] = useState<"MARKET" | "PENDING">("MARKET");
  const [pendingEntryPrice, setPendingEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [targets, setTargets] = useState<{ price: string; percent: string }[]>([{ price: "", percent: "100" }]);

  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const [pending, startTransition] = useTransition();

  // MARKET orders always fill at the current execution price — never
  // trader-editable (§11); PENDING orders use the trader's own trigger
  // price. Derived directly from props/state rather than mirrored into a
  // second piece of state via an effect.
  const entryPrice = orderType === "MARKET" ? (executionPrice != null ? String(executionPrice) : "") : pendingEntryPrice;

  // Stage 18 §12 — consume a chart-click price the moment one arrives for
  // whichever field is currently armed. This is React's documented
  // "adjusting state when a prop changes" pattern (applied DURING render,
  // not inside a useEffect, and using useState rather than a ref — refs
  // must never be read/written during render) — `nonce` is compared
  // against the last-seen value so a repeat click on the same price still
  // registers exactly once, without an effect+setState cascade.
  const [lastConsumedNonce, setLastConsumedNonce] = useState(-1);
  if (priceSelection.nonce !== lastConsumedNonce) {
    setLastConsumedNonce(priceSelection.nonce);
    if (priceSelection.point && priceSelection.armedField) {
      const price = priceSelection.point.price;
      if (priceSelection.armedField === "entry") {
        if (orderType === "PENDING") setPendingEntryPrice(String(price));
      } else if (priceSelection.armedField === "stop") {
        setStopLoss(String(price));
      } else if (priceSelection.armedField.startsWith("target-")) {
        const idx = Number(priceSelection.armedField.slice("target-".length));
        updateTarget(idx, "price", String(price));
      }
      onArmField(null); // one shot — the trader re-arms explicitly for another pick
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!strategyId) {
        if (active) {
          setHistoricalContext(undefined);
          setSetupTypeName(null);
        }
        return;
      }
      if (active) setLoadingContext(true);
      const ctx = await getReplayHistoricalStrategyContext(strategyId, currentTime);
      if (!active) return;
      setHistoricalContext(ctx);
      setLoadingContext(false);
    })();
    return () => {
      active = false;
    };
    // Only re-resolve when the strategy changes — the server re-resolves
    // authoritatively at submission time regardless of client staleness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId]);

  const setupTypes = historicalContext?.snapshot.setupTypes ?? [];
  const found = setupTypeName ? findHistoricalScenario(setupTypes, setupTypeName, direction) : null;
  const conditions = found ? toReplayResolvedConditions(found.scenario) : [];
  const mandatory = conditions.filter((c) => c.mandatory);
  const optional = conditions.filter((c) => !c.mandatory);

  const preview = found
    ? buildSetupValidationSnapshot({
        strategyName: historicalContext!.strategyName,
        strategyVersion: historicalContext!.version,
        setupType: { id: found.setupType.name, name: found.setupType.name },
        scenario: { id: `${found.setupType.name}:${found.scenario.direction}`, direction: found.scenario.direction },
        conditions,
        selectedChecklistItemIds: selectedConditionIds,
        overrideReason: (overrideReason as never) ?? null,
        overrideNote: overrideNote || null,
      })
    : null;

  function toggleCondition(id: string) {
    setSelectedConditionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const entry = Number(entryPrice);
  const sl = Number(stopLoss);
  const validPlan = Number.isFinite(entry) && Number.isFinite(sl) && entry !== sl && entryPrice !== "" && stopLoss !== "";
  const totalPercent = targets.reduce((sum, t) => sum + (Number(t.percent) || 0), 0);

  function targetR(price: string): number | null {
    const p = Number(price);
    if (!validPlan || !Number.isFinite(p)) return null;
    const risk = Math.abs(entry - sl);
    if (risk === 0) return null;
    const diff = direction === "LONG" ? p - entry : entry - p;
    return diff / risk;
  }

  function addTarget() {
    setTargets((prev) => [...prev, { price: "", percent: "" }]);
  }
  function removeTarget(i: number) {
    setTargets((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateTarget(i: number, field: "price" | "percent", value: string) {
    setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }

  function placeTrade() {
    if (!validPlan) {
      toast.error("Enter a valid entry price and stop loss.");
      return;
    }
    const parsedTargets = targets
      .filter((t) => t.price !== "" && t.percent !== "")
      .map((t) => ({ price: Number(t.price), percentToClose: Number(t.percent) }));
    if (parsedTargets.some((t) => !Number.isFinite(t.price) || !Number.isFinite(t.percentToClose))) {
      toast.error("Every target needs a price and a % to close.");
      return;
    }

    startTransition(async () => {
      const result = await createReplayDecision(sessionId, {
        historicalTimestamp: currentTime,
        assetSymbol: asset,
        direction,
        decisionType: "TAKEN",
        strategyId,
        setupTypeName,
        selectedConditionIds,
        overrideReason: preview?.validationState === "OVERRIDDEN" ? overrideReason : null,
        overrideNote: preview?.validationState === "OVERRIDDEN" ? overrideNote || null : null,
        orderType,
        entryPrice: entry,
        initialStopLoss: sl,
        targets: parsedTargets,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(orderType === "MARKET" ? "Simulated trade placed and filled." : "Pending order placed.");
      onTradeChanged(result.trade);
    });
  }

  function confirmSkip() {
    startTransition(async () => {
      const result = await createReplayDecision(sessionId, {
        historicalTimestamp: currentTime,
        assetSymbol: asset,
        direction,
        decisionType: "SKIPPED",
        strategyId,
        setupTypeName,
        selectedConditionIds,
        notes: skipReason.trim() ? { skipReason: skipReason.trim() } : null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast("Recorded as skipped — no simulated PnL.");
      setSkipping(false);
      setSkipReason("");
      onTradeChanged(result.trade);
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Replay Decision</h3>
        <span className="text-[11px] text-muted-foreground/70">Only what was known at this moment</span>
      </div>
      {/* Stage 18 §21 — explicit "flat" state, since this form itself IS
       *  what "flat" looks like (no open/pending simulated position for
       *  this asset yet). */}
      <p className="text-[11px] text-muted-foreground/60">No open replay position — plan a decision below.</p>

      {/* Direction */}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          variant={direction === "LONG" ? "default" : "outline"}
          className={cn("gap-1.5", direction === "LONG" && "bg-success text-white hover:bg-success/90")}
          onClick={() => setDirection("LONG")}
        >
          <ArrowUpRight className="size-4" /> Long
        </Button>
        <Button
          type="button"
          variant={direction === "SHORT" ? "default" : "outline"}
          className={cn("gap-1.5", direction === "SHORT" && "bg-danger text-white hover:bg-danger/90")}
          onClick={() => setDirection("SHORT")}
        >
          <ArrowDownRight className="size-4" /> Short
        </Button>
      </div>

      {/* Strategy / Setup Type */}
      <div className="space-y-2">
        <Select
          items={[{ value: NO_STRATEGY, label: "No Strategy" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
          value={strategyId ?? NO_STRATEGY}
          onValueChange={(v) => {
            setStrategyId(v === NO_STRATEGY ? null : v);
            setSetupTypeName(null);
            setSelectedConditionIds([]);
            setShowOverride(false);
          }}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder="Strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STRATEGY}>No Strategy</SelectItem>
            {strategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {strategyId && loadingContext && <p className="text-xs text-muted-foreground">Resolving the historical Strategy version…</p>}

        {strategyId && !loadingContext && historicalContext === null && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            No historical Strategy version exists at this replay time — trade without Setup Type validation, or pick a different
            strategy.
          </div>
        )}

        {strategyId && historicalContext && (
          <Select
            items={[{ value: NO_SETUP, label: "No Setup Type" }, ...setupTypes.map((s) => ({ value: s.name, label: s.name }))]}
            value={setupTypeName ?? NO_SETUP}
            onValueChange={(v) => {
              setSetupTypeName(v === NO_SETUP ? null : v);
              setSelectedConditionIds([]);
              setShowOverride(false);
            }}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Setup Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SETUP}>No Setup Type</SelectItem>
              {setupTypes.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {found && conditions.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-2.5">
            {mandatory.length > 0 && <ConditionGroup label="Mandatory" items={mandatory} checked={selectedConditionIds} onToggle={toggleCondition} />}
            {optional.length > 0 && <ConditionGroup label="Optional" items={optional} checked={selectedConditionIds} onToggle={toggleCondition} />}
            {preview && <ValidationBanner state={preview.validationState} score={preview.snapshot.score} />}
            {preview?.validationState === "NOT_VALIDATED" && (
              <div>
                {!showOverride ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowOverride(true)}>
                    Take Anyway
                  </Button>
                ) : (
                  <div className="space-y-1.5">
                    <Select items={OVERRIDE_REASONS} value={overrideReason ?? ""} onValueChange={(v) => setOverrideReason(v || null)}>
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue placeholder="Why are you taking it anyway?" />
                      </SelectTrigger>
                      <SelectContent>
                        {OVERRIDE_REASONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea rows={2} placeholder="Optional note…" value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trade Plan */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" size="sm" variant={orderType === "MARKET" ? "default" : "outline"} onClick={() => setOrderType("MARKET")}>
            Market
          </Button>
          <Button type="button" size="sm" variant={orderType === "PENDING" ? "default" : "outline"} onClick={() => setOrderType("PENDING")}>
            Pending
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Entry
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="any"
                value={entryPrice}
                disabled={orderType === "MARKET"}
                onChange={(e) => setPendingEntryPrice(e.target.value)}
                placeholder={orderType === "MARKET" ? "current price" : "trigger price"}
                className="h-8 text-xs"
              />
              {orderType === "PENDING" && (
                <ChartSelectButton
                  active={priceSelection.armedField === "entry"}
                  onClick={() => onArmField(priceSelection.armedField === "entry" ? null : "entry")}
                  label="Set entry from chart"
                />
              )}
            </div>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Stop Loss
            <div className="flex items-center gap-1">
              <Input type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="h-8 text-xs" />
              <ChartSelectButton
                active={priceSelection.armedField === "stop"}
                onClick={() => onArmField(priceSelection.armedField === "stop" ? null : "stop")}
                label="Set stop from chart"
              />
            </div>
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Targets</span>
            <span className={cn("text-[11px]", totalPercent > 100 ? "text-danger" : "text-muted-foreground/70")}>{totalPercent}% allocated</span>
          </div>
          {targets.map((t, i) => {
            const r = targetR(t.price);
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  type="number"
                  step="any"
                  placeholder="Price"
                  value={t.price}
                  onChange={(e) => updateTarget(i, "price", e.target.value)}
                  className="h-8 text-xs"
                />
                <ChartSelectButton
                  active={priceSelection.armedField === `target-${i}`}
                  onClick={() => onArmField(priceSelection.armedField === `target-${i}` ? null : `target-${i}`)}
                  label={`Set target ${i + 1} from chart`}
                />
                <Input
                  type="number"
                  step="any"
                  placeholder="%"
                  value={t.percent}
                  onChange={(e) => updateTarget(i, "percent", e.target.value)}
                  className="h-8 w-16 text-xs"
                />
                <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground">{r != null ? `${r.toFixed(2)}R` : "—"}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove target" onClick={() => removeTarget(i)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={addTarget}>
            <Plus className="size-3.5" /> Add target
          </Button>
        </div>
      </div>

      {!skipping ? (
        <div className="grid grid-cols-2 gap-1.5 border-t border-border/60 pt-3">
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => setSkipping(true)} disabled={pending}>
            <SkipForward className="size-3.5" /> Skip
          </Button>
          <Button type="button" className="gap-1.5" onClick={placeTrade} disabled={pending || !validPlan}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            Place Trade
          </Button>
        </div>
      ) : (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <Textarea rows={2} placeholder="Why skip this? (optional)" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
          <div className="grid grid-cols-2 gap-1.5">
            <Button type="button" variant="ghost" onClick={() => setSkipping(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={confirmSkip} disabled={pending}>
              {pending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Confirm Skip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stage 18 §12 — "activate selection mode and click the chart" toggle.
 *  Typed entry always remains available (this is purely additive) — the
 *  trader can ignore this button entirely and type a price instead. */
function ChartSelectButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="icon-sm"
      className="shrink-0"
      aria-label={label}
      title={active ? "Click the chart to set this price (Esc to cancel)" : label}
      onClick={onClick}
    >
      <Crosshair className="size-3.5" />
    </Button>
  );
}

function ConditionGroup({
  label,
  items,
  checked,
  onToggle,
}: {
  label: string;
  items: { checklistItemId: string; name: string; weight: number | null }[];
  checked: string[];
  onToggle: (id: string) => void;
}) {
  const checkedSet = new Set(checked);
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      {items.map((c) => (
        <label key={c.checklistItemId} className="flex cursor-pointer items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-xs">
          <Checkbox checked={checkedSet.has(c.checklistItemId)} onCheckedChange={() => onToggle(c.checklistItemId)} />
          <span>{c.name}</span>
        </label>
      ))}
    </div>
  );
}

function ValidationBanner({ state, score }: { state: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN"; score: number | null }) {
  const meta = {
    NOT_VALIDATED: { icon: ShieldQuestion, className: "border-warning/30 bg-warning/10 text-warning", title: "NOT VALIDATED" },
    VALIDATED: { icon: ShieldCheck, className: "border-success/30 bg-success/10 text-success", title: "VALIDATED" },
    OVERRIDDEN: { icon: ShieldAlert, className: "border-danger/30 bg-danger/10 text-danger", title: "OVERRIDDEN" },
  }[state];
  const Icon = meta.icon;
  return (
    <div className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium", meta.className)}>
      <Icon className="size-3.5" />
      {meta.title}
      {score != null && <span className="opacity-80">· {score}%</span>}
    </div>
  );
}

function ReplayPositionPanel({
  trade,
  currentTime,
  unrealizedR,
  onTradeChanged,
}: {
  trade: ReplayTradeDTO;
  currentTime: number;
  unrealizedR: number | null;
  onTradeChanged: (trade: ReplayTradeDTO) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [newStopLoss, setNewStopLoss] = useState(trade.currentStopLoss != null ? String(trade.currentStopLoss) : "");
  const [closePrice, setClosePrice] = useState(trade.simulatedEntry != null ? String(trade.simulatedEntry) : "");
  const [closePercent, setClosePercent] = useState("100");
  const [reasoningNote, setReasoningNote] = useState(() => {
    const notes = trade.notes as Record<string, unknown> | null;
    return typeof notes?.reasoning === "string" ? notes.reasoning : "";
  });
  const [showTimeline, setShowTimeline] = useState(false);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rColor = trade.realizedReplayR > 0 ? "text-success" : trade.realizedReplayR < 0 ? "text-danger" : "text-muted-foreground";
  const showUnrealized = (trade.lifecycle === "OPEN" || trade.lifecycle === "PARTIALLY_CLOSED") && unrealizedR != null;
  const unrealizedColor = unrealizedR != null && unrealizedR > 0 ? "text-success" : unrealizedR != null && unrealizedR < 0 ? "text-danger" : "text-muted-foreground";

  // Stage 18 §19 — lightweight autosave, debounced (never on every
  // keystroke) — same throttled-write discipline as the Clock checkpoint.
  function onReasoningChange(value: string) {
    setReasoningNote(value);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      void updateReplayTradeReasoningNote(trade.id, { note: value }).then((result) => {
        if (!result.success) toast.error(result.error);
      });
    }, 800);
  }
  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    };
  }, []);

  function run(action: () => Promise<{ success: true; trade: ReplayTradeDTO } | { success: false; error: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onTradeChanged(result.trade);
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {trade.direction === "LONG" ? <ArrowUpRight className="size-4 text-success" /> : <ArrowDownRight className="size-4 text-danger" />}
          {trade.assetSymbol}
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{trade.lifecycle}</span>
        </div>
        <div className="text-right">
          <div className={cn("text-sm font-semibold tabular-nums", rColor)}>{trade.realizedReplayR >= 0 ? "+" : ""}{trade.realizedReplayR.toFixed(2)}R</div>
          {showUnrealized && (
            <div className={cn("text-[10px] tabular-nums", unrealizedColor)}>
              {unrealizedR! >= 0 ? "+" : ""}
              {unrealizedR!.toFixed(2)}R unrealized
            </div>
          )}
        </div>
      </div>

      {trade.pendingAmbiguity != null && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" /> Ambiguous candle
          </div>
          {/* Stage 18 §24 — exact required copy, verbatim. */}
          <p className="opacity-90">
            Both stop and target were touched within the same 1-minute candle, so exact order cannot be determined.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveReplayTradeAmbiguity(trade.id, { resolution: "SL_FIRST" }))}>
              Stop first
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveReplayTradeAmbiguity(trade.id, { resolution: "TARGET_FIRST" }))}>
              Target first
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Entry</span>
        <span className="text-right tabular-nums">{fmt(trade.simulatedEntry ?? trade.plannedEntry)}</span>
        <span className="text-muted-foreground">Stop Loss</span>
        <span className="text-right tabular-nums">{fmt(trade.currentStopLoss)}</span>
        <span className="text-muted-foreground">Remaining</span>
        <span className="text-right tabular-nums">{trade.remainingPercent}%</span>
      </div>

      {trade.targets.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Targets</span>
          {trade.targets.map((t, i) => (
            <div key={t.id} className="flex items-center justify-between text-xs">
              <span className={cn(t.filledAt && "text-success")}>
                TP{i + 1} · {fmt(t.price)} ({t.percentToClose}%)
              </span>
              {t.filledAt && <CheckCircle2 className="size-3.5 text-success" />}
            </div>
          ))}
        </div>
      )}

      {trade.lifecycle === "PENDING" && (
        <Button type="button" size="sm" variant="outline" className="w-full gap-1.5" disabled={pending} onClick={() => run(() => cancelReplayTradePendingOrder(trade.id, { timestamp: currentTime }))}>
          <Ban className="size-3.5" /> Cancel Pending Order
        </Button>
      )}

      {(trade.lifecycle === "OPEN" || trade.lifecycle === "PARTIALLY_CLOSED") && (
        <div className="space-y-2 border-t border-border/60 pt-2">
          <div className="flex items-center gap-1.5">
            <Input type="number" step="any" value={newStopLoss} onChange={(e) => setNewStopLoss(e.target.value)} className="h-8 text-xs" placeholder="New stop loss" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !newStopLoss}
              onClick={() => run(() => moveReplayTradeStopLoss(trade.id, { newStopLoss: Number(newStopLoss), timestamp: currentTime }))}
            >
              Move SL
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input type="number" step="any" value={closePercent} onChange={(e) => setClosePercent(e.target.value)} className="h-8 w-16 text-xs" placeholder="%" />
            <Input type="number" step="any" value={closePrice} onChange={(e) => setClosePrice(e.target.value)} className="h-8 text-xs" placeholder="Price" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !closePrice}
              onClick={() =>
                run(() =>
                  closeReplayTradePartialManually(trade.id, {
                    percent: Number(closePercent),
                    price: Number(closePrice),
                    timestamp: currentTime,
                  }),
                )
              }
            >
              Close %
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={pending || !closePrice}
            onClick={() => run(() => closeReplayTradeRemainingManually(trade.id, { price: Number(closePrice), timestamp: currentTime }))}
          >
            Close Remaining
          </Button>
        </div>
      )}

      {/* Stage 18 §19 — lightweight reasoning notes, debounced autosave. */}
      <div className="space-y-1 border-t border-border/60 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Reasoning</span>
        <Textarea
          rows={2}
          placeholder="Why am I waiting / why I think this is invalid / what I noticed differently…"
          value={reasoningNote}
          onChange={(e) => onReasoningChange(e.target.value)}
          className="text-xs"
        />
      </div>

      {/* Stage 18 §20 — decision timeline, reusing ReplayTradeExecutionEvent
       *  rows already recorded by the execution engine (never duplicated
       *  here — this only formats what the server already computed). */}
      {trade.executionEvents.length > 0 && (
        <div className="border-t border-border/60 pt-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
            onClick={() => setShowTimeline((v) => !v)}
            aria-expanded={showTimeline}
          >
            <span className="flex items-center gap-1">
              <Clock3 className="size-3" /> Timeline ({trade.executionEvents.length})
            </span>
            <span>{showTimeline ? "Hide" : "Show"}</span>
          </button>
          {showTimeline && (
            <ul className="mt-1.5 space-y-1">
              {trade.executionEvents.map((event) => (
                <li key={event.id} className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{EXECUTION_EVENT_LABELS[event.eventType]}</span>
                  <span className="tabular-nums">{new Date(event.historicalTimestamp).toISOString().slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const EXECUTION_EVENT_LABELS: Record<string, string> = {
  ORDER_PLACED: "Order placed",
  ORDER_FILLED: "Order filled",
  SL_MOVED: "Stop moved",
  PARTIAL_CLOSE: "Partial close",
  FULL_CLOSE: "Trade closed",
  ORDER_CANCELLED: "Order cancelled",
  AMBIGUOUS_CANDLE: "Ambiguous candle",
  AMBIGUITY_RESOLVED: "Ambiguity resolved",
};
