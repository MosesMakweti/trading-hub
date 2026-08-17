"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
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
import { minutesToTimeString, timeStringToMinutes } from "@/lib/date";
import { tradeSchema, type TradeFormValues, type TradeInput } from "@/lib/validation/trades";
import { createTrade, updateTrade, loadStrategyReference } from "@/actions/trades.actions";
import { confirmPlanAction } from "@/actions/trade-plan.actions";
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { computeDistance } from "@/domain/trade-plan/distance";
import { computeTargetRMultiples, computeWeightedPlannedR } from "@/domain/trade-plan/planned-rr";
import { validatePlan, hasBlockingIssues, type PlanValidationIssue } from "@/domain/trade-plan/plan-validation";
import type { StrategyReferenceDTO } from "@/types/strategies";

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
  hitTP1: false,
  hitTP2: false,
  hitTP3: false,
  hitFullTP: false,
  psychPreTradeMindset: null,
  psychPostTradeReflection: null,
  psychLessonsLearned: null,
  psychWhatToWorkOn: null,
  allocations: [],
  selectedConfluences: [],
  selectedExecution: [],
  selectedEntryModel: null,
  psychologyAnswers: {},
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
}: TradeFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<TradeFormValues, unknown, TradeInput>({
    resolver: zodResolver(tradeSchema),
    defaultValues: defaultValues ?? emptyDefaults,
  });

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
  const liveScores = scoreStrategyAdherence(
    strategyReference
      ? { confluences: strategyReference.confluences, execution: strategyReference.execution }
      : null,
    watchedConfluences ?? [],
    watchedExecution ?? [],
  );
  // Live weighted setup score + mandatory validity, mirroring the save layer.
  const liveSetup = scoreSetup(
    (strategyReference?.confluences ?? []).map((c) => ({
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory,
    })),
    watchedConfluences ?? [],
  );

  // TradingView Trade Plan, built inline at create time (mode === "create" only —
  // an edit-mode trade already has its own confirmed plan, edited exclusively
  // through the richer TradePlanSection in the trade workspace, with its
  // locking/revision/screenshot machinery; duplicating that here would let the
  // edit form silently clobber a locked plan). Entirely optional: left empty,
  // the trade saves exactly as before and Expected RR stays unset until the
  // plan is confirmed later in the workspace. Reuses the same domain math
  // TradePlanSection uses — no parallel distance/R/validation logic.
  const watchedDirection = useWatch({ control, name: "direction" });
  const watchedAsset = useWatch({ control, name: "assetSymbol" });
  const [planTimeframe, setPlanTimeframe] = useState("");
  const [planEntry, setPlanEntry] = useState("");
  const [planStopLoss, setPlanStopLoss] = useState("");
  const [planTargets, setPlanTargets] = useState<PlanTargetRow[]>([emptyPlanTarget(1)]);

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

  // When the strategy changes, clear the entry model — a model belongs to exactly
  // one strategy, so the previous selection can't carry over. Skip the very first
  // run so an edit-mode trade keeps its saved entry model on load.
  const strategyInitialised = useRef(false);
  useEffect(() => {
    if (!strategyInitialised.current) {
      strategyInitialised.current = true;
      return;
    }
    setValue("selectedEntryModel", null);
  }, [selectedStrategyId, setValue]);

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
        ? await createTrade(dateKey, values, opportunityId)
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

    setIsSubmitting(false);
    toast.success(mode === "create" ? "Trade added." : "Trade updated.");
    // After an edit, return to that trade's workspace; after create, to the day.
    router.push(
      mode === "edit" && tradeId ? `/journal/${dateKey}/trades/${tradeId}` : `/journal/${dateKey}`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
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
        <div className="space-y-1.5">
          <Label className="text-xs">Strategy</Label>
          <Controller
            control={control}
            name="strategyId"
            render={({ field }) => (
              <Select
                items={strategies.map((s) => ({ value: s.id, label: s.name }))}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a strategy" />
                </SelectTrigger>
                <SelectContent>
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
            Its markets, sessions, confluences &amp; execution load below — and its name &amp;
            version are snapshotted at save time so the record stays accurate later.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Asset</Label>
            <Controller
              control={control}
              name="assetSymbol"
              render={({ field }) => {
                const opts = withSelected(strategyReference?.applicableAssets, field.value);
                return (
                  <Select
                    items={opts.map((s) => ({ value: s, label: s }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={selectedStrategyId ? "Select asset" : "Select a strategy first"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

        {(referenceLoading || strategyReference) && (
          <StrategyReferencePanel reference={strategyReference} loading={referenceLoading} />
        )}
      </section>

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Entry Model</h2>
        <Controller
          control={control}
          name="selectedEntryModel"
          render={({ field }) => {
            if (!selectedStrategyId) {
              return (
                <p className="text-sm text-muted-foreground">
                  Select a strategy to load its entry models.
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
        <h2 className="text-sm font-medium text-muted-foreground">Confluences</h2>
        <StrategyTagSelect
          control={control}
          name="selectedConfluences"
          options={strategyReference?.confluences ?? []}
          emptyLabel={
            selectedStrategyId
              ? "This strategy has no confluences yet — add them in Strategy Lab > Confluences."
              : "Select a strategy to load its confluences."
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
              Weighted planned R:{" "}
              <span className="font-medium text-foreground">
                {planWeighted.weightedR != null ? `${planWeighted.weightedR.toFixed(2)}R` : "—"}
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

      {/* Phase 2 — Trade Execution: what actually happened. */}
      <div className="space-y-1 pt-2">
        <h1 className="text-base font-semibold tracking-tight">Trade Execution</h1>
        <p className="text-xs text-muted-foreground">What I actually did.</p>
      </div>

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

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Execution Confirmation</h2>
        <StrategyTagSelect
          control={control}
          name="selectedExecution"
          options={strategyReference?.execution ?? []}
          emptyLabel={
            selectedStrategyId
              ? "This strategy has no execution confirmations yet — add them in Strategy Lab > Execution."
              : "Select a strategy to load its execution confirmations."
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

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Trade Result</h2>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["hitTP1", "TP1 Hit"],
              ["hitTP2", "TP2 Hit"],
              ["hitTP3", "TP3 Hit"],
              ["hitFullTP", "Full TP Hit"],
            ] as const
          ).map(([name, label]) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  {label}
                </label>
              )}
            />
          ))}
        </div>
        <div className="max-w-xs space-y-1.5">
          <Label className="text-xs">Actual RR (leave blank if still open)</Label>
          <Controller
            control={control}
            name="actualRR"
            render={({ field }) => (
              <Input
                type="number"
                step="0.01"
                name={field.name}
                value={(field.value as number | null) ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.valueAsNumber)}
              />
            )}
          />
        </div>
      </section>

      {/* Phase 3 — Trade Review: what I learned. */}
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

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Post-Trade Honest Questionnaire
        </h2>
        <PsychologyQuestionnaire control={control} />
        {errors.psychologyAnswers && (
          <p className="text-xs text-danger">Please answer every question above.</p>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          nativeButton={false}
          render={<a href={`/journal/${dateKey}`} />}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Trade"}
        </Button>
      </div>
    </form>
  );
}
