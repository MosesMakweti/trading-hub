"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildSetupValidationSnapshot } from "@/domain/trades/setup-validation";
import { loadEffectiveScenario } from "@/actions/strategy-setup-types.actions";
import { getDailyAssetAnalysisBias } from "@/actions/daily-asset-analysis.actions";
import { ContextualCommitmentReminder } from "@/components/journal/contextual-commitment-reminder";
import type { EffectiveSetupScenario } from "@/server/services/strategy-setup-types.service";
import type { TradeFormValues } from "@/lib/validation/trades";
import { useDayRef } from "@/components/workspace/workspace-context";

const NO_SETUP_TYPE = "__none__";

const OVERRIDE_REASONS: { value: string; label: string }[] = [
  { value: "ANTICIPATING_CONFIRMATION", label: "Anticipating confirmation" },
  { value: "DISCRETIONARY_OVERRIDE", label: "Discretionary override" },
  { value: "FOMO", label: "Fear of missing the move" },
  { value: "MOMENTUM_FAST_MARKET", label: "Momentum / fast market" },
  { value: "NEWS_DRIVEN", label: "News-driven setup" },
  { value: "OTHER", label: "Other" },
];

/**
 * Trade Idea Validation Shield (Stage 4) — the fast real-time confirmation
 * shield between spotting a setup and taking it. Renders nothing when the
 * selected strategy has no Setup Types (or none is selected) — the legacy
 * flat-confluence flow below this section is completely unaffected either way.
 */
export function TradeSetupValidationSection({
  control,
  setValue,
  setupTypes,
}: {
  control: Control<TradeFormValues>;
  setValue: UseFormSetValue<TradeFormValues>;
  setupTypes: { id: string; name: string }[];
}) {
  const strategyId = useWatch({ control, name: "strategyId" });
  const direction = useWatch({ control, name: "direction" });
  const setupTypeId = useWatch({ control, name: "setupTypeId" });
  const selectedConditions = (useWatch({ control, name: "selectedSetupConditions" }) ?? []) as string[];
  const overrideReason = useWatch({ control, name: "setupOverrideReason" }) as string | null | undefined;

  const [scenario, setScenario] = useState<EffectiveSetupScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!setupTypeId) {
        setScenario(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await loadEffectiveScenario(setupTypeId, direction);
      if (!active) return;
      setScenario(result);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [setupTypeId, direction]);

  // The checklist is scoped to one Setup Type + direction — reset checked
  // state and any pending override whenever either changes so incompatible
  // selections never carry over (spec §8). Skip the very first run so an
  // edit-mode trade keeps its saved selection on load.
  const initialised = useRef(false);
  const resetKey = `${setupTypeId ?? ""}:${direction}`;
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      prevResetKey.current = resetKey;
      return;
    }
    if (prevResetKey.current === resetKey) return;
    prevResetKey.current = resetKey;
    setShowOverride(false);
    setValue("selectedSetupConditions", [], { shouldDirty: true });
    setValue("setupOverrideReason", null, { shouldDirty: true });
    setValue("setupOverrideNote", null, { shouldDirty: true });
  }, [resetKey, setValue]);

  if (!strategyId || setupTypes.length === 0) return null;

  const conditions = scenario?.conditions ?? [];
  const mandatory = conditions.filter((c) => c.mandatory);
  const optional = conditions.filter((c) => !c.mandatory);

  const preview = scenario
    ? buildSetupValidationSnapshot({
        strategyName: null,
        strategyVersion: null,
        setupType: scenario.setupType,
        scenario: { id: scenario.scenario.id, direction: scenario.scenario.direction },
        conditions: scenario.conditions,
        selectedChecklistItemIds: selectedConditions,
        overrideReason: (overrideReason as never) ?? null,
        overrideNote: null,
      })
    : null;

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Setup Validation</h2>
        <span className="text-xs text-muted-foreground/60">
          Is this genuinely one of your setups, or are you forcing a trade?
        </span>
      </div>

      <Controller
        control={control}
        name="setupTypeId"
        render={({ field }) => (
          <Select
            items={[
              { value: NO_SETUP_TYPE, label: "No setup type (use the flat confluence list below)" },
              ...setupTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
            value={field.value ?? NO_SETUP_TYPE}
            onValueChange={(v) => field.onChange(v === NO_SETUP_TYPE ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SETUP_TYPE}>No setup type</SelectItem>
              {setupTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      {setupTypeId && loading && (
        <p className="text-xs text-muted-foreground">Loading the {direction === "LONG" ? "Bullish" : "Bearish"} checklist…</p>
      )}

      {setupTypeId && !loading && scenario && conditions.length === 0 && (
        <p className="text-xs text-muted-foreground/70 italic">
          {scenario.setupType.name} has no {direction === "LONG" ? "Bullish" : "Bearish"} conditions defined yet —
          add them in Strategy Lab.
        </p>
      )}

      {setupTypeId && !loading && scenario && conditions.length > 0 && (
        <Controller
          control={control}
          name="selectedSetupConditions"
          render={({ field }) => {
            const checked = new Set((field.value ?? []) as string[]);
            const toggle = (id: string) => {
              const next = new Set(checked);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              field.onChange(Array.from(next));
            };
            return (
              <div className="space-y-3">
                {mandatory.length > 0 && (
                  <ConditionGroup label="Mandatory" checked={checked} onToggle={toggle} items={mandatory} />
                )}
                {optional.length > 0 && (
                  <ConditionGroup label="Optional" checked={checked} onToggle={toggle} items={optional} />
                )}
              </div>
            );
          }}
        />
      )}

      {setupTypeId && !loading && scenario && preview && (
        <ValidationBanner
          state={preview.validationState}
          score={preview.snapshot.score}
          mandatoryTotal={mandatory.length}
          mandatoryMet={mandatory.length - preview.snapshot.missingMandatoryConditionNames.length}
          overrideReasonLabel={
            preview.overrideReason
              ? OVERRIDE_REASONS.find((r) => r.value === preview.overrideReason)?.label ?? preview.overrideReason
              : null
          }
        />
      )}

      {setupTypeId && !loading && scenario && preview?.validationState === "NOT_VALIDATED" && (
        <div className="space-y-2">
          {/* Stage 19.1 §3-7 — shown right where the shield turns non-green,
           *  the exact moment a discretionary override becomes a live
           *  option. Purely informational: never blocks "Take Anyway". */}
          <ContextualCommitmentReminder ruleKeys={["OVERRIDE_DISCIPLINE"]} />
          {!showOverride ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowOverride(true)}>
              Take Anyway
            </Button>
          ) : (
            <OverridePanel control={control} onCancel={() => setShowOverride(false)} />
          )}
        </div>
      )}
    </section>
  );
}

function ConditionGroup({
  label,
  items,
  checked,
  onToggle,
}: {
  label: string;
  items: EffectiveSetupScenario["conditions"];
  checked: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <div className="space-y-1">
        {items.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-sm"
          >
            <Checkbox checked={checked.has(c.checklistItemId)} onCheckedChange={() => onToggle(c.checklistItemId)} />
            <span>{c.name}</span>
            {c.weight != null && <span className="ml-auto text-[10px] text-muted-foreground">w{c.weight}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

function ValidationBanner({
  state,
  score,
  mandatoryTotal,
  mandatoryMet,
  overrideReasonLabel,
}: {
  state: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN";
  score: number | null;
  mandatoryTotal: number;
  mandatoryMet: number;
  overrideReasonLabel: string | null;
}) {
  const meta = {
    NOT_VALIDATED: {
      icon: ShieldQuestion,
      className: "border-warning/30 bg-warning/10 text-warning",
      title: "NOT VALIDATED",
      detail: `${mandatoryMet} / ${mandatoryTotal} mandatory condition${mandatoryTotal === 1 ? "" : "s"}`,
    },
    VALIDATED: {
      icon: ShieldCheck,
      className: "border-success/30 bg-success/10 text-success",
      title: "VALIDATED",
      detail:
        mandatoryTotal > 0
          ? `All mandatory conditions confirmed${score != null ? ` · Setup score: ${score}%` : ""}`
          : score != null
            ? `Setup score: ${score}%`
            : "No mandatory conditions required",
    },
    OVERRIDDEN: {
      icon: ShieldAlert,
      className: "border-danger/30 bg-danger/10 text-danger",
      title: "OVERRIDDEN",
      detail: `${mandatoryTotal - mandatoryMet} mandatory condition${mandatoryTotal - mandatoryMet === 1 ? "" : "s"} missing${
        overrideReasonLabel ? ` · Reason: ${overrideReasonLabel}` : ""
      }`,
    },
  }[state];

  const Icon = meta.icon;

  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2", meta.className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-xs font-semibold tracking-wide">{meta.title}</p>
        <p className="text-xs opacity-90">{meta.detail}</p>
      </div>
    </div>
  );
}

function OverridePanel({
  control,
  onCancel,
}: {
  control: Control<TradeFormValues>;
  onCancel: () => void;
}) {
  const reason = useWatch({ control, name: "setupOverrideReason" });
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="size-3.5" />
        Setup not validated — why are you taking it anyway?
      </div>
      <Controller
        control={control}
        name="setupOverrideReason"
        render={({ field }) => (
          <Select
            items={OVERRIDE_REASONS}
            value={field.value ?? ""}
            onValueChange={(v) => field.onChange(v || null)}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              {OVERRIDE_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {reason === "OTHER" && (
        <Controller
          control={control}
          name="setupOverrideNote"
          render={({ field }) => (
            <Textarea
              rows={2}
              placeholder="Describe why…"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
            />
          )}
        />
      )}
      {reason !== "OTHER" && (
        <Controller
          control={control}
          name="setupOverrideNote"
          render={({ field }) => (
            <Textarea
              rows={2}
              placeholder="Optional notes…"
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
            />
          )}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          onCancel();
        }}
      >
        Cancel override
      </Button>
    </div>
  );
}

/**
 * Stage 4 §10 — quietly surfaces the day's own DailyAssetAnalysis.finalBias
 * for the trade's asset, and a small non-blocking conflict note if it
 * disagrees with the trade's direction. Independent of Setup Type selection.
 */
export function DailyBiasBadge({
  control,
  dateKey,
}: {
  control: Control<TradeFormValues>;
  dateKey: string;
}) {
  const dayRef = useDayRef(dateKey);
  const assetSymbol = useWatch({ control, name: "assetSymbol" });
  const direction = useWatch({ control, name: "direction" });
  const [finalBias, setFinalBias] = useState<"LONG" | "SHORT" | "NEUTRAL" | null>(null);

  useEffect(() => {
    let active = true;
    const symbol = (assetSymbol ?? "").trim();
    const timer = setTimeout(() => {
      void (async () => {
        const result = symbol ? await getDailyAssetAnalysisBias(dayRef, symbol) : { finalBias: null };
        if (active) setFinalBias(result.finalBias);
      })();
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dayRef, assetSymbol]);

  if (!finalBias || finalBias === "NEUTRAL") return null;

  const aligned = finalBias === direction;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        aligned ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning",
      )}
    >
      {aligned ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
      Daily Bias: {finalBias}
      {!aligned && <span className="opacity-80">· Bias Conflict</span>}
    </div>
  );
}
