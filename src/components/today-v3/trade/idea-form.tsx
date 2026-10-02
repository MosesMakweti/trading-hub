"use client";

import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StrategyTagSelect } from "@/components/journal/strategy-tag-select";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import { TradeSetupValidationSection } from "@/components/journal/trade-setup-validation";
import { PreTradeMood } from "@/components/journal/pre-trade-mood";
import { useStrategyScopedSelections } from "@/components/journal/use-strategy-scoped-selections";
import { LimitOverrideField } from "@/components/today-v3/trade/limit-override-field";
import { AssetContextPanel } from "@/components/today-v3/trade/asset-context-panel";
import { loadStrategyReference } from "@/actions/trades.actions";
import { createQuickIdeaAction, updateIdeaAction } from "@/actions/today-v3.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import { scoreSetup } from "@/domain/trades/setup-score";
import { evaluateNewTradeOverride, type DayUsage } from "@/domain/today/limit-state";
import type { TradeFormValues } from "@/lib/validation/trades";
import type { StrategyReferenceDTO } from "@/types/strategies";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";

const NO_STRATEGY = "__freeform__";
const NO_SESSION = "__none__";
const NO_ENTRY_MODEL = "__none__";

export interface IdeaFormDefaults {
  assetSymbol: string;
  strategyId: string | null;
  direction: "LONG" | "SHORT" | null;
  /** Show "From today's Final Bias" next to a prefilled direction. */
  directionFromFinalBias: boolean;
  session: string | null;
  selectedEntryModel?: string | null;
  selectedConfluences?: string[];
  setupTypeId?: string | null;
  selectedSetupConditions?: string[];
  setupOverrideReason?: TradeFormValues["setupOverrideReason"];
  setupOverrideNote?: string | null;
  reasonForTrade?: string | null;
  preTradeMoodTags?: TradeFormValues["preTradeMoodTags"];
  preTradeMoodIntensity?: number | null;
  preTradeMoodNote?: string | null;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Today V3 — the Idea form (Quick Trade Idea create + before-entry edit).
 * Asks only what the trader currently knows: asset, strategy, direction,
 * session, setup type + conditions (the existing validation shield, with
 * its override reason), entry model, confluences, why, and optional
 * pre-trade state. No execution time, HTF bias, confidence, plan levels,
 * execution confirmations or accounts — those belong to later stages or
 * are server compatibility values.
 */
export function IdeaForm({
  mode,
  dateKey,
  tradeId,
  strategies,
  defaults,
  assetLocked,
  assetOptions,
  analysisFor,
  plan,
  usage,
  limits,
  projectedRiskPercent,
  opportunityId,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  dateKey: string;
  tradeId?: string;
  strategies: { id: string; name: string; version: number }[];
  defaults: IdeaFormDefaults;
  assetLocked: boolean;
  assetOptions: string[];
  analysisFor: (symbol: string) => DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  usage?: DayUsage;
  limits?: { riskLimitPercent: number | null; maxTrades: number | null };
  projectedRiskPercent?: number | null;
  opportunityId?: string;
  onDone: (tradeId: string, next: "plan" | "idea") => void;
  onCancel: () => void;
}) {
  const dayRef = useDayRef(dateKey);
  const [direction, setDirectionState] = useState<"LONG" | "SHORT" | null>(defaults.direction);
  const [reason, setReason] = useState(defaults.reasonForTrade ?? "");
  const [overrideReason, setOverrideReason] = useState("");
  const [serverOverride, setServerOverride] = useState<string[] | null>(null);
  const [moodOpen, setMoodOpen] = useState((defaults.preTradeMoodTags?.length ?? 0) > 0);
  const [pending, start] = useTransition();

  const { control, setValue, getValues, register } = useForm<TradeFormValues>({
    defaultValues: {
      strategyId: defaults.strategyId ?? "",
      assetSymbol: defaults.assetSymbol,
      direction: defaults.direction ?? "LONG",
      selectedSession: defaults.session,
      selectedEntryModel: defaults.selectedEntryModel ?? null,
      selectedConfluences: defaults.selectedConfluences ?? [],
      selectedExecution: [],
      setupTypeId: defaults.setupTypeId ?? null,
      selectedSetupConditions: defaults.selectedSetupConditions ?? [],
      setupOverrideReason: defaults.setupOverrideReason ?? null,
      setupOverrideNote: defaults.setupOverrideNote ?? null,
      preTradeMoodTags: defaults.preTradeMoodTags ?? [],
      preTradeMoodIntensity: defaults.preTradeMoodIntensity ?? null,
      preTradeMoodNote: defaults.preTradeMoodNote ?? null,
      // Required by the shared form type only — never shown or submitted by V3.
      executionMinutes: 0,
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 50,
    },
  });

  const strategyId = useWatch({ control, name: "strategyId" });
  const assetSymbol = useWatch({ control, name: "assetSymbol" }) ?? "";
  const formDirection = useWatch({ control, name: "direction" });
  const confluences = useWatch({ control, name: "selectedConfluences" }) ?? [];

  const [reference, setReference] = useState<StrategyReferenceDTO | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const ref = strategyId ? await loadStrategyReference(strategyId) : null;
      if (active) setReference(ref);
    })();
    return () => {
      active = false;
    };
  }, [strategyId]);

  useStrategyScopedSelections({ strategyId, direction: formDirection, strategyReference: reference, setValue, getValues });

  function chooseDirection(d: "LONG" | "SHORT") {
    setDirectionState(d);
    setValue("direction", d, { shouldDirty: true });
  }

  const setup = scoreSetup(
    (reference?.confluences ?? []).map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory,
      directionApplicability: c.directionApplicability ?? "BOTH",
    })),
    confluences as string[],
    { direction: direction ?? "LONG" },
  );

  const override =
    mode === "create" && usage && limits
      ? evaluateNewTradeOverride(usage, limits, projectedRiskPercent ?? null)
      : null;
  const overrideMessages = serverOverride ?? (override?.required ? override.messages : []);

  const sessions = Array.from(
    new Set([...(reference?.sessions.map((s) => s.name) ?? []), ...(defaults.session ? [defaults.session] : [])]),
  );
  const entryModels = reference?.entryModels ?? [];
  const assetSuggestions = Array.from(new Set([...assetOptions, ...(reference?.applicableAssets ?? [])]));
  const analysis = assetSymbol ? analysisFor(assetSymbol.toUpperCase()) : null;

  const canSubmit =
    !!direction && assetSymbol.trim() !== "" && (overrideMessages.length === 0 || overrideReason.trim() !== "");

  function submit(next: "plan" | "idea") {
    if (!direction) {
      toast.error("Choose a direction — Traditorium never assumes one.");
      return;
    }
    const v = getValues();
    const payload = {
      strategyId: v.strategyId || null,
      direction,
      selectedSession: v.selectedSession ?? null,
      setupTypeId: v.setupTypeId ?? null,
      selectedSetupConditions: v.selectedSetupConditions ?? [],
      setupOverrideReason: v.setupOverrideReason ?? null,
      setupOverrideNote: v.setupOverrideNote ?? null,
      selectedEntryModel: v.selectedEntryModel ?? null,
      selectedConfluences: v.selectedConfluences ?? [],
      reasonForTrade: reason,
      preTradeMoodTags: v.preTradeMoodTags ?? [],
      preTradeMoodIntensity: v.preTradeMoodIntensity ?? null,
      preTradeMoodNote: v.preTradeMoodNote ?? null,
    };
    start(async () => {
      if (mode === "edit" && tradeId) {
        const r = await updateIdeaAction(dateKey, tradeId, payload);
        if (!r.success) {
          toast.error(r.error);
          return;
        }
        toast.success("Idea updated.");
        onDone(tradeId, "idea");
        return;
      }
      const r = await createQuickIdeaAction(dayRef, {
        ...payload,
        assetSymbol: v.assetSymbol,
        nowMinutes: nowMinutes(),
        limitOverrideReason: overrideReason || null,
        ...(opportunityId ? { opportunityId } : {}),
      });
      if (!r.success) {
        if (r.override) setServerOverride(r.override.messages);
        toast.error(r.error);
        return;
      }
      toast.success("Idea created.");
      onDone(r.tradeId, next);
    });
  }

  return (
    <div className="space-y-4">
      <AssetContextPanel analysis={analysis} plan={plan} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset">
          {assetLocked ? (
            <div className="flex h-9 items-center font-mono text-sm font-semibold">{assetSymbol}</div>
          ) : (
            <>
              <Input
                {...register("assetSymbol", { setValueAs: (x: string) => (x ?? "").toUpperCase() })}
                list="v3-idea-assets"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="e.g. XAUUSD"
                className="font-mono uppercase"
              />
              <datalist id="v3-idea-assets">
                {assetSuggestions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field label="Strategy" hint={defaults.strategyId && strategyId === defaults.strategyId ? "From this asset's plan" : undefined}>
          <Controller
            control={control}
            name="strategyId"
            render={({ field }) => (
              <Select
                items={[{ value: NO_STRATEGY, label: "No strategy (freeform)" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
                value={field.value || NO_STRATEGY}
                onValueChange={(v) => field.onChange(v === NO_STRATEGY ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STRATEGY}>No strategy (freeform)</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · v{s.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field
          label="Direction"
          hint={
            direction && defaults.directionFromFinalBias && direction === defaults.direction
              ? "From today's Final Bias"
              : direction
                ? undefined
                : "Required — choose explicitly"
          }
        >
          <div className="flex gap-1.5" role="radiogroup" aria-label="Direction">
            {(["LONG", "SHORT"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                role="radio"
                aria-checked={direction === d}
                variant={direction === d ? (d === "LONG" ? "default" : "destructive") : "outline"}
                onClick={() => chooseDirection(d)}
                className="flex-1"
              >
                {d === "LONG" ? "Long" : "Short"}
              </Button>
            ))}
          </div>
        </Field>

        <Field label="Session" hint={defaults.session ? "Prefilled from today's sessions" : undefined}>
          <Controller
            control={control}
            name="selectedSession"
            render={({ field }) => (
              <Select
                items={[{ value: NO_SESSION, label: "None" }, ...sessions.map((n) => ({ value: n, label: n }))]}
                value={field.value ?? NO_SESSION}
                onValueChange={(v) => field.onChange(v === NO_SESSION ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SESSION}>None</SelectItem>
                  {sessions.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      {direction ? (
        <>
          <TradeSetupValidationSection control={control} setValue={setValue} setupTypes={reference?.setupTypes ?? []} />

          {strategyId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Entry model">
                <Controller
                  control={control}
                  name="selectedEntryModel"
                  render={({ field }) =>
                    entryModels.length === 0 ? (
                      <p className="flex h-9 items-center text-xs text-muted-foreground">No entry models in this strategy.</p>
                    ) : (
                      <Select
                        items={[{ value: NO_ENTRY_MODEL, label: "None" }, ...entryModels.map((n) => ({ value: n, label: n }))]}
                        value={field.value ?? NO_ENTRY_MODEL}
                        onValueChange={(v) => field.onChange(v === NO_ENTRY_MODEL ? null : v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ENTRY_MODEL}>None</SelectItem>
                          {entryModels.map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  }
                />
              </Field>
              <Field label="Setup quality">
                <SetupScoreCard
                  score={setup.setupScore}
                  rating={setup.setupRating}
                  valid={setup.setupValid}
                  missingMandatory={setup.missingMandatory}
                />
              </Field>
            </div>
          )}

          <Field label="Confluences">
            <StrategyTagSelect
              control={control}
              name="selectedConfluences"
              options={reference?.confluences ?? []}
              direction={direction}
              emptyLabel={
                strategyId
                  ? "This strategy has no confluences — add them in Strategy Lab."
                  : "Freeform idea — pick a strategy to score confluences."
              }
            />
          </Field>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Choose a direction to see the setup checklist and the confluences that apply to it.
        </p>
      )}

      <Field label="Why this trade?">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you see, in one or two lines." />
      </Field>

      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setMoodOpen((v) => !v)}
          aria-expanded={moodOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        >
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", moodOpen && "rotate-90")} />
          <span className="font-medium">Pre-trade state</span>
          <span className="text-muted-foreground">optional · how you feel right now</span>
        </button>
        {moodOpen && (
          <div className="border-t border-border p-2">
            <PreTradeMood control={control} />
          </div>
        )}
      </div>

      {mode === "create" && (
        <LimitOverrideField id="v3-idea-override" messages={overrideMessages} value={overrideReason} onChange={setOverrideReason} />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {mode === "create" ? (
          <>
            <Button type="button" variant="outline" onClick={() => submit("idea")} disabled={pending || !canSubmit}>
              Create idea
            </Button>
            <Button type="button" onClick={() => submit("plan")} disabled={pending || !canSubmit} className="gap-1.5">
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Create &amp; plan →
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => submit("idea")} disabled={pending || !direction} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save idea
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
