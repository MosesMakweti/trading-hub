"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TradeAccountRow } from "@/components/journal/trade-account-row";
import { StrategyTagSelect } from "@/components/journal/strategy-tag-select";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import { scoreStrategyAdherence } from "@/domain/trades/strategy-adherence";
import { scoreSetup } from "@/domain/trades/setup-score";
import { PsychologyQuestionnaire } from "@/components/journal/psychology-questionnaire";
import { StrategyReferencePanel } from "@/components/journal/strategy-reference-panel";
import { TradeSetupValidationSection, DailyBiasBadge } from "@/components/journal/trade-setup-validation";
import { PreTradeMood } from "@/components/journal/pre-trade-mood";
import { PendingBeforeScreenshots, uploadPendingBeforeScreenshots } from "@/components/journal/pending-before-screenshot";
import { minutesToTimeString, timeStringToMinutes } from "@/lib/date";
import { tradeSchema, type TradeFormValues, type TradeInput } from "@/lib/validation/trades";
import { createTrade, updateTrade, loadStrategyReference } from "@/actions/trades.actions";
import { confirmPlanAction } from "@/actions/trade-plan.actions";
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { computeDistance } from "@/domain/trade-plan/distance";
import { computeTargetRMultiples, computeWeightedPlannedR } from "@/domain/trade-plan/planned-rr";
import { validatePlan, hasBlockingIssues, type PlanValidationIssue } from "@/domain/trade-plan/plan-validation";
import type { StrategyReferenceDTO } from "@/types/strategies";
import { useDayRef } from "@/components/workspace/workspace-context";

interface PlanTargetRow {
  key: string;
  targetOrder: number;
  label: string;
  targetPrice: string;
  plannedClosePercent: string;
  managementInstruction: string;
}

function emptyPlanTarget(order: number): PlanTargetRow {
  return {
    key: `plan-${order}-${Math.random().toString(36).slice(2)}`,
    targetOrder: order,
    label: `TP${order}`,
    targetPrice: "",
    plannedClosePercent: "",
    managementInstruction: "",
  };
}

const NO_SESSION = "__none__";
const NO_ENTRY_MODEL = "__no_entry_model__";
const NO_STRATEGY = "__freeform__";

const FIELD_LABELS: Record<string, string> = {
  strategyId: "Strategy",
  assetSymbol: "Asset / symbol",
  executionMinutes: "Execution time",
  biasConfidencePercent: "Bias confidence %",
  allocations: "Participating accounts",
  psychologyAnswers: "Post-trade questionnaire",
};

/** Flatten react-hook-form's nested `errors` into a display list. Repeated
 *  leaf messages (e.g. one per unanswered psychology question) are de-duped so
 *  the summary stays readable. */
function flattenErrors(errs: FieldErrors): { name: string; label: string; message: string }[] {
  const out: { name: string; label: string; message: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      const top = path.split(".")[0];
      const key = `${top}:${record.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ name: top, label: FIELD_LABELS[top] ?? top, message: record.message });
      }
      return;
    }
    for (const k of Object.keys(record)) {
      if (k === "ref" || k === "type" || k === "types" || k === "root") continue;
      walk(record[k], path ? `${path}.${k}` : k);
    }
    if (record.root) walk(record.root, path);
  };
  walk(errs, "");
  return out;
}

// Keep a currently-selected value visible even if the strategy's list changed
// since the trade was saved (e.g. an asset later removed from the strategy).
function withSelected(list: string[] | undefined, current: string | null | undefined): string[] {
  const base = list ?? [];
  return current && !base.includes(current) ? [current, ...base] : base;
}

const emptyDefaults: TradeFormValues = {
  strategyId: "",
  assetSymbol: "",
  executionMinutes: 570,
  direction: "LONG",
  higherTimeframeBias: "BULLISH",
  biasConfidencePercent: 50,
  selectedSession: null,
  // Not entered here — derived from the TradingView Trade Plan once confirmed
  // in the trade workspace (trade-plan.service.ts).
  expectedRR: null,
  actualRR: null,
  performanceRiskPercentOverride: null,
  psychPreTradeMindset: null,
  psychPostTradeReflection: null,
  psychLessonsLearned: null,
  psychWhatToWorkOn: null,
  allocations: [],
  selectedConfluences: [],
  selectedExecution: [],
  selectedEntryModel: null,
  psychologyAnswers: {},
  setupTypeId: null,
  selectedSetupConditions: [],
  setupOverrideReason: null,
  setupOverrideNote: null,
  preTradeMoodTags: [],
  preTradeMoodIntensity: null,
  preTradeMoodNote: null,
};

interface TradeFormProps {
  dateKey: string;
  mode: "create" | "edit";
  tradeId?: string;
  accounts: { id: string; name: string; kind: string }[];
  strategies: { id: string; name: string; version: number; archived?: boolean }[];
  defaultValues?: TradeFormValues;
  // When creating from a spotted opportunity, the new trade is linked to it on save
  // (the opportunity resolves to EXECUTED).
  opportunityId?: string;
  // True once this trade's Performance risk snapshot is locked (an actual
  // entry exists) — the override field below is display-only past that
  // point (the save layer already ignores a changed value, see
  // buildAllocations in trades.service.ts; this just tells the trader why).
  performanceRiskLocked?: boolean;
  // When set, the form is embedded (e.g. the Today "Add trade" dialog): on a
  // successful save it calls `onSuccess` instead of navigating away, and the
  // Cancel button calls `onCancel` instead of linking to the day.
  onSuccess?: (tradeId: string) => void;
  onCancel?: () => void;
  // Seed the Idea bias/confidence from today's plan so a trade logged mid-flow
  // starts aligned with what the trader decided this morning (create only).
  initialBias?: "BULLISH" | "BEARISH";
  initialBiasConfidence?: number;
  // Today V2 (T3) — day-context inheritance, all plain form defaults (never
  // auto-saved; the trader may freely override any of these before the
  // normal save/create action runs). initialStrategyId sources from
  // DailyAssetAnalysis.activeStrategyId (a day-plan preference, never a
  // historical trade owner) — there is deliberately no canonical numeric
  // "conviction" signal on DailyAssetAnalysis to default biasConfidencePercent
  // from (see directional-evidence.ts's own doc comment: evidence counts are
  // explicitly never to be rendered as a percentage/statistical claim), so
  // that field is intentionally NOT defaulted here.
  initialAssetSymbol?: string;
  initialStrategyId?: string;
  initialSession?: string | null;
  // Stage 6 — Today's live "Add Trade Idea" dialog passes false to declutter
  // fast, in-the-moment decision-making: the Performance Account risk
  // override and the Other Participating Accounts picker are both account-
  // allocation UI, not part of "is this my setup + how am I executing it."
  // Hidden, NOT removed — the automatic Performance Account allocation still
  // happens server-side either way (buildAllocations in trades.service.ts
  // always creates it, using the account's configured default risk% when no
  // override is given), and every other TradeForm caller (the standalone
  // /journal/[date]/trades/new and .../edit pages) keeps the full UI.
  showAccountAllocation?: boolean;
}

export function TradeForm({
  dateKey,
  mode,
  tradeId,
  accounts,
  strategies,
  defaultValues,
  opportunityId,
  performanceRiskLocked = false,
  onSuccess,
  onCancel,
  initialBias,
  initialBiasConfidence,
  initialAssetSymbol,
  initialStrategyId,
  initialSession,
  showAccountAllocation = true,
}: TradeFormProps) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<TradeFormValues, unknown, TradeInput>({
    resolver: zodResolver(tradeSchema),
    defaultValues:
      defaultValues ??
      {
        ...emptyDefaults,
        assetSymbol: initialAssetSymbol ?? emptyDefaults.assetSymbol,
        strategyId: initialStrategyId ?? emptyDefaults.strategyId,
        selectedSession: initialSession ?? emptyDefaults.selectedSession,
        higherTimeframeBias: initialBias ?? emptyDefaults.higherTimeframeBias,
        biasConfidencePercent: initialBiasConfidence ?? emptyDefaults.biasConfidencePercent,
      },
  });

  const errorList = flattenErrors(errors);

  /** Runs when the trader hits Save but validation fails — the form used to do
   *  nothing at all. Now: a toast, a summary they can act on, and a jump to it. */
  function onInvalid(formErrors: FieldErrors<TradeFormValues>) {
    const count = flattenErrors(formErrors).length;
    toast.error(
      `Can't save yet — ${count} thing${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your attention.`,
    );
    requestAnimationFrame(() => {
      document.getElementById("trade-form-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function jumpToField(name: string) {
    const el =
      (document.getElementById(name) as HTMLElement | null) ??
      (document.getElementsByName(name)[0] as HTMLElement | null) ??
      document.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus?.({ preventScroll: true });
  }

  const { fields, append, remove } = useFieldArray({ control, name: "allocations" });

  // When a strategy is selected, surface its process (assets / entry models /
  // framework / trade-management) as read-only reference context. NOT Arsenal.
  const selectedStrategyId = useWatch({ control, name: "strategyId" });
  const [strategyReference, setStrategyReference] = useState<StrategyReferenceDTO | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);

  // Live strategy-adherence preview — recomputed with the pure scorer as the
  // trader multi-selects, mirroring exactly what the save layer will persist.
  const watchedConfluences = useWatch({ control, name: "selectedConfluences" });
  const watchedExecution = useWatch({ control, name: "selectedExecution" });
  const watchedDirection = useWatch({ control, name: "direction" });
  const liveScores = scoreStrategyAdherence(
    strategyReference
      ? { confluences: strategyReference.confluences, execution: strategyReference.execution }
      : null,
    watchedConfluences ?? [],
    watchedExecution ?? [],
    watchedDirection,
  );
  // Live weighted setup score + mandatory validity, mirroring the save layer —
  // direction-aware so bullish-only weight never enters a short trade's score.
  const liveSetup = scoreSetup(
    (strategyReference?.confluences ?? []).map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory,
      directionApplicability: c.directionApplicability ?? "BOTH",
    })),
    watchedConfluences ?? [],
    { direction: watchedDirection },
  );

  // TradingView Trade Plan, built inline at create time (mode === "create" only —
  // an edit-mode trade already has its own confirmed plan, edited exclusively
  // through the richer TradePlanSection in the trade workspace, with its
  // locking/revision/screenshot machinery; duplicating that here would let the
  // edit form silently clobber a locked plan). Entirely optional: left empty,
  // the trade saves exactly as before and Expected RR stays unset until the
  // plan is confirmed later in the workspace. Reuses the same domain math
  // TradePlanSection uses — no parallel distance/R/validation logic.
  const watchedAsset = useWatch({ control, name: "assetSymbol" });
  const [planTimeframe, setPlanTimeframe] = useState("");
  const [planEntry, setPlanEntry] = useState("");
  const [planStopLoss, setPlanStopLoss] = useState("");
  const [planTargets, setPlanTargets] = useState<PlanTargetRow[]>([emptyPlanTarget(1)]);

  // Before-Trade screenshots (Stage 5) — create-time fast path only; staged
  // locally until the trade actually exists (see pending-before-screenshot.tsx).
  const [pendingScreenshots, setPendingScreenshots] = useState<File[]>([]);

  const planSpec = parseSymbol(watchedAsset || "").spec;
  const planEntryNum = planEntry.trim() === "" ? null : Number(planEntry);
  const planStopNum = planStopLoss.trim() === "" ? null : Number(planStopLoss);
  const planParsedTargets = planTargets
    .filter((t) => t.targetPrice.trim() !== "")
    .map((t) => ({
      targetOrder: t.targetOrder,
      targetPrice: Number(t.targetPrice),
      plannedClosePercent: t.plannedClosePercent.trim() === "" ? null : Number(t.plannedClosePercent),
    }));
  const planHasAnyInput =
    planTimeframe.trim() !== "" || planEntry.trim() !== "" || planStopLoss.trim() !== "" || planParsedTargets.length > 0;

  const planStopDistance =
    planEntryNum != null && planStopNum != null ? computeDistance(planEntryNum, planStopNum, planSpec) : null;
  const planTargetRs =
    planEntryNum != null && planStopNum != null
      ? computeTargetRMultiples(watchedDirection, planEntryNum, planStopNum, planParsedTargets)
      : [];
  const planWeighted = computeWeightedPlannedR(planTargetRs, planParsedTargets);

  const planIssues: PlanValidationIssue[] = planHasAnyInput
    ? validatePlan({
        direction: watchedDirection,
        entry: planEntryNum,
        stopLoss: planStopNum,
        targets: planParsedTargets,
        maxDecimalPrecision: planSpec?.decimalPrecision ?? null,
      })
    : [];
  const planBlocking = hasBlockingIssues(planIssues);

  function updatePlanTarget(key: string, patch: Partial<PlanTargetRow>) {
    setPlanTargets((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function addPlanTarget() {
    const nextOrder = planTargets.length > 0 ? Math.max(...planTargets.map((t) => t.targetOrder)) + 1 : 1;
    setPlanTargets((prev) => [...prev, emptyPlanTarget(nextOrder)]);
  }

  function removePlanTarget(key: string) {
    setPlanTargets((prev) => {
      const filtered = prev.filter((t) => t.key !== key);
      return filtered.map((t, i) => ({
        ...t,
        targetOrder: i + 1,
        label: t.label.match(/^TP\d+$/) ? `TP${i + 1}` : t.label,
      }));
    });
  }

  useEffect(() => {
    let active = true;
    // All state updates happen inside this async callback, never synchronously in
    // the effect body (keeps clear of the cascading-render lint).
    void (async () => {
      if (!selectedStrategyId) {
        setStrategyReference(null);
        setReferenceLoading(false);
        return;
      }
      setReferenceLoading(true);
      const reference = await loadStrategyReference(selectedStrategyId);
      if (!active) return;
      setStrategyReference(reference);
      setReferenceLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [selectedStrategyId]);

  // When the strategy changes, clear every selection that belongs to exactly
  // one strategy, so nothing from the previous strategy's checklist can
  // carry over (Today V2 T3 — this now also matters for an INHERITED
  // default strategy the trader then changes, not just a manual switch).
  // Confluences/execution confirmations are strategy-scoped exactly like
  // entry model/setup type; previously only those two were cleared here,
  // leaving stale confluence/execution names silently attached to the new
  // strategy. Skip the very first run so an edit-mode trade (or a create
  // that started with an inherited default strategy) keeps its existing
  // selections on load rather than wiping them the instant the form mounts.
  const strategyInitialised = useRef(false);
  useEffect(() => {
    if (!strategyInitialised.current) {
      strategyInitialised.current = true;
      return;
    }
    setValue("selectedEntryModel", null);
    setValue("setupTypeId", null);
    setValue("selectedSetupConditions", []);
    setValue("setupOverrideReason", null);
    setValue("setupOverrideNote", null);
    setValue("selectedConfluences", [], { shouldDirty: true, shouldValidate: true });
    setValue("selectedExecution", [], { shouldDirty: true, shouldValidate: true });
  }, [selectedStrategyId, setValue]);

  // When the trader flips direction, drop any selected confluences that no longer
  // apply (e.g. bullish-only picks left over after switching to Short) and tell
  // them what was removed — silent removal would look like lost data. BOTH picks
  // and confluences with no applicability are always kept. Skips the first run so
  // an edit-mode trade keeps its saved selection on load.
  const directionInitialised = useRef(false);
  useEffect(() => {
    if (!directionInitialised.current) {
      directionInitialised.current = true;
      return;
    }
    const confluences = strategyReference?.confluences;
    if (!confluences || confluences.length === 0) return;
    const applicability = new Map(
      confluences.map((c) => [c.name.toLowerCase(), c.directionApplicability ?? "BOTH"]),
    );
    const current = (getValues("selectedConfluences") ?? []) as string[];
    const kept = current.filter((n) => {
      const a = applicability.get(n.toLowerCase());
      // Unknown name (not in this strategy) → leave it be; scoring ignores it.
      if (a == null) return true;
      return a === "BOTH" || (watchedDirection === "LONG" ? a === "BULLISH" : a === "BEARISH");
    });
    if (kept.length === current.length) return;
    const removed = current.length - kept.length;
    setValue("selectedConfluences", kept, { shouldDirty: true, shouldValidate: true });
    toast.info(
      `${removed} ${watchedDirection === "LONG" ? "bearish" : "bullish"}-only ${
        removed === 1 ? "confluence was" : "confluences were"
      } removed because this trade is now ${watchedDirection === "LONG" ? "Long" : "Short"}.`,
    );
  }, [watchedDirection, strategyReference, getValues, setValue]);

  function isAccountSelected(accountId: string) {
    return fields.some((f) => f.tradingAccountId === accountId);
  }

  function toggleAccount(accountId: string) {
    const idx = fields.findIndex((f) => f.tradingAccountId === accountId);
    if (idx >= 0) {
      remove(idx);
    } else {
      append({
        tradingAccountId: accountId,
        riskInputType: "PERCENT",
        riskValue: 1,
        closingPnlGross: 0,
        closingPnlNet: 0,
      });
    }
  }

  async function onSubmit(values: TradeInput) {
    if (mode === "create" && planHasAnyInput && planBlocking) {
      toast.error("Fix the TradingView Trade Plan errors before saving.");
      return;
    }

    setIsSubmitting(true);
    const result =
      mode === "create"
        ? await createTrade(dayRef, values, opportunityId)
        : await updateTrade(dateKey, tradeId!, values);

    if (!result.success) {
      setIsSubmitting(false);
      toast.error(result.error);
      return;
    }

    // The trade now exists, so its plan can be confirmed the same way the
    // trade workspace does (same action, same savePlan sync of Trade.expectedRR
    // etc.) — only when the trader actually filled in entry/stop/a target.
    if (mode === "create" && planEntryNum != null && planStopNum != null && planParsedTargets.length > 0) {
      const planResult = await confirmPlanAction(dateKey, result.tradeId, {
        direction: watchedDirection,
        timeframe: planTimeframe.trim() || null,
        entry: planEntryNum,
        stopLoss: planStopNum,
        targets: planParsedTargets.map((t) => {
          const row = planTargets.find((r) => r.targetOrder === t.targetOrder)!;
          return {
            targetOrder: t.targetOrder,
            label: row.label,
            targetPrice: t.targetPrice,
            plannedClosePercent: t.plannedClosePercent,
            managementInstruction: row.managementInstruction.trim() || null,
          };
        }),
      });
      if (!planResult.success) {
        toast.error(`Trade saved, but the plan couldn't be saved: ${planResult.error}`);
      }
    }

    // Before-Trade screenshots (Stage 5) — same "collect now, persist once
    // the trade exists" deferral as the plan above. A failed upload must
    // never fail the trade save that already succeeded.
    if (mode === "create" && pendingScreenshots.length > 0) {
      const uploadError = await uploadPendingBeforeScreenshots(result.tradeId, pendingScreenshots);
      if (uploadError) {
        toast.error(`Trade saved, but the screenshot couldn't be uploaded: ${uploadError}`);
      }
    }

    setIsSubmitting(false);
    toast.success(mode === "create" ? "Trade added." : "Trade updated.");

    // Embedded (Today "Add trade" dialog): hand control back to the host — it
    // closes the dialog and refreshes in place, so the trader never leaves the
    // Today workflow.
    if (onSuccess) {
      onSuccess(result.tradeId);
      return;
    }

    // After an edit, return to that trade's workspace; after create, to the day.
    router.push(
      mode === "edit" && tradeId ? `/journal/${dateKey}/trades/${tradeId}` : `/journal/${dateKey}`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-8">
      {/* Phase 1 — Trade Idea: what you're planning, before you take it. Mirrors
          the same three-phase structure (Idea / Execution / Review) used in the
          trade workspace, so the form and the case-file read as one workflow. */}
      <div className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">Trade Idea</h1>
        <p className="text-xs text-muted-foreground">What I planned — before the trade.</p>
      </div>

      <section className="glass space-y-4 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Strategy &amp; Market</h2>

        {/* Strategy is the gateway: its markets, sessions, confluences & execution
            load the fields below. A trade is always taken under a strategy (SOT). */}
        <div className="space-y-1.5" data-field="strategyId">
          <Label className="text-xs">Strategy <span className="text-muted-foreground">(optional)</span></Label>
          <Controller
            control={control}
            name="strategyId"
            render={({ field }) => (
              <Select
                items={[
                  { value: NO_STRATEGY, label: "No strategy (freeform)" },
                  ...strategies.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={field.value || NO_STRATEGY}
                onValueChange={(v) => field.onChange(v === NO_STRATEGY ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No strategy (freeform)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STRATEGY}>No strategy (freeform)</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · v{s.version}
                      {s.archived ? " (archived)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.strategyId && <p className="text-xs text-danger">{errors.strategyId.message}</p>}
          <p className="text-xs text-muted-foreground">
            Pick a strategy to load its markets, sessions, confluences &amp; execution below (its
            name &amp; version are snapshotted at save time). Leave it on <em>freeform</em> to log a
            one-off trade with no strategy attached.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Always a free-text symbol field — never gated on a strategy loading.
              When a strategy IS selected, its markets appear as datalist
              suggestions, but the trader can type any symbol (freeform trades,
              or a market the strategy doesn't list yet). */}
          <div className="space-y-1.5" data-field="assetSymbol">
            <Label className="text-xs" htmlFor="assetSymbol">Asset / symbol</Label>
            <Controller
              control={control}
              name="assetSymbol"
              render={({ field }) => {
                const suggestions = strategyReference?.applicableAssets ?? [];
                return (
                  <>
                    <Input
                      id="assetSymbol"
                      list={suggestions.length > 0 ? "asset-symbol-suggestions" : undefined}
                      placeholder="e.g. XAUUSD"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      aria-invalid={errors.assetSymbol ? true : undefined}
                    />
                    {suggestions.length > 0 && (
                      <datalist id="asset-symbol-suggestions">
                        {suggestions.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    )}
                  </>
                );
              }}
            />
            {errors.assetSymbol && <p className="text-xs text-danger">{errors.assetSymbol.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Execution time</Label>
            <Controller
              control={control}
              name="executionMinutes"
              render={({ field }) => (
                <Input
                  type="time"
                  name={field.name}
                  value={minutesToTimeString(field.value as number)}
                  onChange={(e) => field.onChange(timeStringToMinutes(e.target.value))}
                />
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Direction</Label>
            <Controller
              control={control}
              name="direction"
              render={({ field }) => (
                <Select
                  items={{ LONG: "Long", SHORT: "Short" }}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LONG">Long</SelectItem>
                    <SelectItem value="SHORT">Short</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Session</Label>
            <Controller
              control={control}
              name="selectedSession"
              render={({ field }) => {
                const names = withSelected(
                  strategyReference?.sessions.map((s) => s.name),
                  field.value,
                );
                return (
                  <Select
                    items={[
                      { value: NO_SESSION, label: "None" },
                      ...names.map((n) => ({ value: n, label: n })),
                    ]}
                    value={field.value ?? NO_SESSION}
                    onValueChange={(v) => field.onChange(v === NO_SESSION ? null : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SESSION}>None</SelectItem>
                      {names.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Higher-timeframe bias</Label>
            <Controller
              control={control}
              name="higherTimeframeBias"
              render={({ field }) => (
                <Select
                  items={{ BULLISH: "Bullish", BEARISH: "Bearish" }}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BULLISH">Bullish</SelectItem>
                    <SelectItem value="BEARISH">Bearish</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Bias confidence %</Label>
            <Input type="number" min={0} max={100} {...register("biasConfidencePercent")} />
          </div>
        </div>

        <DailyBiasBadge control={control} dateKey={dateKey} />

        {(referenceLoading || strategyReference) && (
          <StrategyReferencePanel reference={strategyReference} loading={referenceLoading} />
        )}
      </section>

      <TradeSetupValidationSection
        control={control}
        setValue={setValue}
        setupTypes={strategyReference?.setupTypes ?? []}
      />

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Entry Model</h2>
        <Controller
          control={control}
          name="selectedEntryModel"
          render={({ field }) => {
            if (!selectedStrategyId) {
              return (
                <p className="text-sm text-muted-foreground">
                  Freeform trade — no strategy selected. Pick a strategy above to tag an entry model.
                </p>
              );
            }
            const names = withSelected(strategyReference?.entryModels, field.value);
            if (names.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  This strategy has no entry models yet — add them in Strategy Lab, inside the
                  strategy&apos;s Entry Models section.
                </p>
              );
            }
            return (
              <Select
                items={[
                  { value: NO_ENTRY_MODEL, label: "None" },
                  ...names.map((n) => ({ value: n, label: n })),
                ]}
                value={field.value ?? NO_ENTRY_MODEL}
                onValueChange={(v) => field.onChange(v === NO_ENTRY_MODEL ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an entry model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ENTRY_MODEL}>None</SelectItem>
                  {names.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }}
        />
      </section>

      <section className="glass space-y-2 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Confluences</h2>
          <span className="text-xs text-muted-foreground/60">
            Showing the confluences that apply to a {watchedDirection === "LONG" ? "long" : "short"}{" "}
            trade
          </span>
        </div>
        <StrategyTagSelect
          control={control}
          name="selectedConfluences"
          options={strategyReference?.confluences ?? []}
          direction={watchedDirection}
          emptyLabel={
            selectedStrategyId
              ? "This strategy has no confluences yet — add them in Strategy Lab > Confluences."
              : "Freeform trade — no strategy selected. Pick a strategy above to score confluences."
          }
        />
      </section>

      {selectedStrategyId && (
        <section className="glass space-y-2 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Setup Quality</h2>
            <span className="text-xs text-muted-foreground/60">
              Weighted probability from your confluences — a discipline score, not a prediction
            </span>
          </div>
          <SetupScoreCard
            score={liveSetup.setupScore}
            rating={liveSetup.setupRating}
            valid={liveSetup.setupValid}
            missingMandatory={liveSetup.missingMandatory}
          />
        </section>
      )}

      {mode === "create" && (
        <section className="glass space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">TradingView Trade Plan</h2>
            <span className="text-xs text-muted-foreground/60">
              Optional — entry, stop-loss &amp; targets. Expected RR is calculated from this.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Timeframe</Label>
              <Input placeholder="15m" value={planTimeframe} onChange={(e) => setPlanTimeframe(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Planned entry</Label>
              <Input type="number" step="any" value={planEntry} onChange={(e) => setPlanEntry(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Planned stop-loss</Label>
              <Input type="number" step="any" value={planStopLoss} onChange={(e) => setPlanStopLoss(e.target.value)} />
            </div>
          </div>

          {planStopDistance && (
            <p className="text-xs text-muted-foreground">
              Stop distance:{" "}
              <span className="font-medium text-foreground">
                {planStopDistance.distance.toFixed(2)} {planStopDistance.unit.toLowerCase()}
                {planStopDistance.distance.toNumber() !== 1 ? "s" : ""}
              </span>
              {!planSpec && " (instrument not recognized — showing raw price distance)"}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Profit targets</span>
              <Button type="button" variant="outline" size="sm" onClick={addPlanTarget}>
                Add target
              </Button>
            </div>
            {planTargets.map((t) => {
              const r = planTargetRs.find((x) => x.targetOrder === t.targetOrder);
              const dist =
                planEntryNum != null && t.targetPrice.trim() !== ""
                  ? computeDistance(planEntryNum, Number(t.targetPrice), planSpec)
                  : null;
              return (
                <div key={t.key} className="space-y-2 rounded-lg border border-border/60 p-2.5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Input
                      className="text-xs"
                      value={t.label}
                      onChange={(e) => updatePlanTarget(t.key, { label: e.target.value })}
                      placeholder="Label"
                    />
                    <Input
                      type="number"
                      step="any"
                      className="text-xs"
                      placeholder="Price"
                      value={t.targetPrice}
                      onChange={(e) => updatePlanTarget(t.key, { targetPrice: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="any"
                      className="text-xs"
                      placeholder="Close %"
                      value={t.plannedClosePercent}
                      onChange={(e) => updatePlanTarget(t.key, { plannedClosePercent: e.target.value })}
                    />
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {r?.rMultiple != null ? `${r.rMultiple.toNumber() >= 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                      {dist && (
                        <span>
                          · {dist.distance.toFixed(1)} {dist.unit.toLowerCase()}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove target"
                      onClick={() => removePlanTarget(t.key)}
                    >
                      <X />
                    </Button>
                  </div>
                  <Input
                    className="text-xs"
                    placeholder="Management instruction (e.g. move stop to break-even after this fills)"
                    value={t.managementInstruction}
                    onChange={(e) => updatePlanTarget(t.key, { managementInstruction: e.target.value })}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              Planned Realized R:{" "}
              <span className="font-medium text-foreground">
                {planWeighted.weightedR != null
                  ? `${planWeighted.weightedR.greaterThanOrEqualTo(0) ? "+" : ""}${planWeighted.weightedR.toFixed(2)}R`
                  : "—"}
              </span>
            </span>
            <span>
              Allocated: <span className="font-medium text-foreground">{planWeighted.totalAllocatedPercent.toFixed(0)}%</span>
            </span>
            {planWeighted.remainingRunnerPercent.greaterThan(0) && (
              <span>
                Runner: <span className="font-medium text-foreground">{planWeighted.remainingRunnerPercent.toFixed(0)}%</span>
              </span>
            )}
          </div>

          {planIssues.length > 0 && (
            <div className="space-y-1">
              {planIssues.map((issue) => (
                <div
                  key={issue.code}
                  className={`rounded-lg px-3 py-1.5 text-xs ${issue.severity === "error" ? "border border-danger/30 bg-danger/10 text-danger" : "border border-warning/30 bg-warning/10 text-warning"}`}
                >
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground/70">
            Leave this blank to plan later — Expected RR then stays unset until you confirm a plan
            in the trade workspace. A TradingView screenshot can be attached there too, after saving.
          </p>
        </section>
      )}

      {mode === "create" && (
        <PendingBeforeScreenshots files={pendingScreenshots} onChange={setPendingScreenshots} />
      )}

      <PreTradeMood control={control} />

      {/* Phase 2 — Trade Execution: what actually happened. */}
      <div className="space-y-1 pt-2">
        <h1 className="text-base font-semibold tracking-tight">Trade Execution</h1>
        <p className="text-xs text-muted-foreground">What I actually did.</p>
      </div>

      {showAccountAllocation && (
        <>
          <section className="glass space-y-3 rounded-2xl p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Performance Account — Risk</h2>
            <p className="text-xs text-muted-foreground">
              {performanceRiskLocked
                ? "This trade already has an actual entry, so its risk is locked and its PnL is now calculated automatically from the realized result — this override can no longer change it."
                : "Optional override of the account's default risk% for this trade only. Leave blank to use the configured default. PnL is calculated automatically from the realized result once the trade closes — never entered manually."}
            </p>
            <div className="max-w-[12rem] space-y-1.5">
              <Label className="text-xs">Risk override (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={performanceRiskLocked}
                placeholder="Account default"
                {...register("performanceRiskPercentOverride")}
              />
            </div>
          </section>

          <section className="glass space-y-3 rounded-2xl p-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Other Participating Accounts &amp; Risk
            </h2>
            <p className="text-xs text-muted-foreground">
              Optional — select any prop-firm/brokerage accounts this trade also affects. Each has its
              own risk% and its own PnL, entered independently of the Performance Account.
            </p>
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                >
                  <Checkbox
                    checked={isAccountSelected(a.id)}
                    onCheckedChange={() => toggleAccount(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
            {errors.allocations && (
              <p className="text-xs text-danger">
                {errors.allocations.message ?? errors.allocations.root?.message}
              </p>
            )}
            <div className="space-y-2">
              {fields.map((field, index) => (
                <TradeAccountRow
                  key={field.id}
                  control={control}
                  index={index}
                  accountName={accounts.find((a) => a.id === field.tradingAccountId)?.name ?? ""}
                  onRemove={() => remove(index)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Execution Confirmation</h2>
        <StrategyTagSelect
          control={control}
          name="selectedExecution"
          options={strategyReference?.execution ?? []}
          emptyLabel={
            selectedStrategyId
              ? "This strategy has no execution confirmations yet — add them in Strategy Lab > Execution."
              : "Freeform trade — no strategy selected. Pick a strategy above to track execution confirmations."
          }
        />
      </section>

      {liveScores.tradeQualityPercent != null && (
        <section className="glass space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Strategy adherence</h2>
            <span className="text-xs text-muted-foreground/60">
              How closely this trade follows the strategy — not a prediction
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <AdherenceMeter label="Confluences" percent={liveScores.confluencePercent} />
            <AdherenceMeter label="Execution" percent={liveScores.executionPercent} />
            <AdherenceMeter label="Trade quality" percent={liveScores.tradeQualityPercent} />
          </div>
        </section>
      )}

      {/* Today V2 Phase 2 §8 — Actual RR is no longer a manual field anywhere
          in the normal live workflow. It's DERIVED, read-only: the canonical
          engine (performance-account.service.ts's settlePerformanceTrade)
          computes and writes Trade.actualRR the moment actual execution data
          fully accounts for the position (see Trade Execution's read-only
          "Actual RR" display). `actualRR` stays in TradeInput/defaultValues
          purely so this form round-trips a trade's existing value unchanged
          on save (never wiping legacy/imported records — import.service.ts
          is the one remaining legitimate direct writer) — it's simply never
          rendered as an editable control here anymore, closing the gap where
          a manually-typed value could persist even when settlement itself
          couldn't calculate one (NOT_CALCULABLE never clears it, by design). */}

      {/* Phase 3 — Trade Review: what I learned. Only shown when editing an
          existing trade — a new trade is logged as an idea, and its review +
          Honest Questionnaire are filled later in the Trade Review tab. */}
      {mode === "edit" && (
      <>
      <div className="space-y-1 pt-2">
        <h1 className="text-base font-semibold tracking-tight">Trade Review</h1>
        <p className="text-xs text-muted-foreground">What I learned.</p>
      </div>

      <section className="glass space-y-4 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Psychology</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Pre-trade mindset</Label>
            <Controller
              control={control}
              name="psychPreTradeMindset"
              render={({ field }) => (
                <Textarea
                  rows={3}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Post-trade reflection</Label>
            <Controller
              control={control}
              name="psychPostTradeReflection"
              render={({ field }) => (
                <Textarea
                  rows={3}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lessons learned</Label>
            <Controller
              control={control}
              name="psychLessonsLearned"
              render={({ field }) => (
                <Textarea
                  rows={3}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What to work on next</Label>
            <Controller
              control={control}
              name="psychWhatToWorkOn"
              render={({ field }) => (
                <Textarea
                  rows={3}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
          </div>
        </div>
      </section>

      <section className="glass space-y-3 rounded-2xl p-4" data-field="psychologyAnswers">
        <h2 className="text-sm font-medium text-muted-foreground">
          Post-Trade Honest Questionnaire
        </h2>
        <PsychologyQuestionnaire control={control} />
        {errors.psychologyAnswers && (
          <p className="text-xs text-danger">Please answer every question above.</p>
        )}
      </section>
      </>
      )}

      {errorList.length > 0 && (
        <div
          id="trade-form-errors"
          className="rounded-2xl border border-danger/30 bg-danger/10 p-4"
          role="alert"
        >
          <p className="text-sm font-medium text-danger">This trade can&apos;t be saved yet</p>
          <ul className="mt-2 space-y-1 text-xs text-danger/90">
            {errorList.slice(0, 6).map((e) => (
              <li key={`${e.name}-${e.message}`}>
                <button
                  type="button"
                  onClick={() => jumpToField(e.name)}
                  className="text-left underline-offset-2 hover:underline"
                >
                  <span className="font-medium">{e.label}:</span> {e.message}
                </button>
              </li>
            ))}
            {errorList.length > 6 && <li className="text-danger/70">+{errorList.length - 6} more</li>}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            nativeButton={false}
            render={<a href={`/journal/${dateKey}`} />}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Trade"}
        </Button>
      </div>
    </form>
  );
}
