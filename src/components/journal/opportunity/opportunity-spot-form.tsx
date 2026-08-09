"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAG_STYLES } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { scoreSetup } from "@/domain/trades/setup-score";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import { loadStrategyReference } from "@/actions/trades.actions";
import { createOpportunity } from "@/actions/opportunity.actions";
import type { StrategyReferenceDTO } from "@/types/strategies";

interface StrategyOption {
  id: string;
  name: string;
  version: number;
}

// A self-contained "spot a setup" form. Mirrors the trade form's strategy → asset →
// confluences flow, with a LIVE setup-validity preview (the same scoreSetup used at
// save time), but stays lightweight (no accounts / PnL — an opportunity is just an
// idea until it resolves).
export function OpportunitySpotForm({
  dateKey,
  strategies,
  onDone,
  onCancel,
}: {
  dateKey: string;
  strategies: StrategyOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [strategyId, setStrategyId] = useState("");
  const [reference, setReference] = useState<StrategyReferenceDTO | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [assetSymbol, setAssetSymbol] = useState("");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [timeframe, setTimeframe] = useState("");
  const [confluences, setConfluences] = useState<string[]>([]);
  const [execution, setExecution] = useState<string[]>([]);
  const [plannedEntry, setPlannedEntry] = useState("");
  const [plannedStopLoss, setPlannedStopLoss] = useState("");
  const [plannedTarget, setPlannedTarget] = useState("");
  const [plannedRR, setPlannedRR] = useState("");
  const [pending, startTransition] = useTransition();

  // Load the selected strategy's reference (assets / confluences / execution).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!strategyId) {
        setReference(null);
        return;
      }
      setRefLoading(true);
      const ref = await loadStrategyReference(strategyId);
      if (!active) return;
      setReference(ref);
      setRefLoading(false);
      // Reset selections that no longer apply to the new strategy.
      setAssetSymbol("");
      setConfluences([]);
      setExecution([]);
    })();
    return () => {
      active = false;
    };
  }, [strategyId]);

  const liveSetup = scoreSetup(
    (reference?.confluences ?? []).map((c) => ({
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory,
    })),
    confluences,
  );

  const toggle = (list: string[], set: (v: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const submit = () => {
    if (!strategyId) return toast.error("Select a strategy.");
    if (!assetSymbol) return toast.error("Select an asset.");
    startTransition(async () => {
      const res = await createOpportunity(dateKey, {
        strategyId,
        assetSymbol,
        direction,
        timeframe: timeframe.trim() || null,
        selectedConfluences: confluences,
        selectedExecution: execution,
        plannedEntry: numOrNull(plannedEntry),
        plannedStopLoss: numOrNull(plannedStopLoss),
        plannedTarget: numOrNull(plannedTarget),
        plannedRR: numOrNull(plannedRR),
      });
      if (res.success) {
        toast.success("Opportunity logged.");
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Strategy</Label>
        <Select
          items={strategies.map((s) => ({ value: s.id, label: s.name }))}
          value={strategyId}
          onValueChange={(v) => setStrategyId(v ?? "")}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a strategy" />
          </SelectTrigger>
          <SelectContent>
            {strategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · v{s.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Validity is scored against this strategy&apos;s confluences — only a valid setup counts as
          a real opportunity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label className="text-xs">Asset</Label>
          <Select
            items={(reference?.applicableAssets ?? []).map((s) => ({ value: s, label: s }))}
            value={assetSymbol}
            onValueChange={(v) => setAssetSymbol(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={strategyId ? "Select asset" : "Select a strategy first"} />
            </SelectTrigger>
            <SelectContent>
              {(reference?.applicableAssets ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Direction</Label>
          <div className="flex gap-2">
            {(["LONG", "SHORT"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={direction === d}
                onClick={() => setDirection(d)}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  direction === d
                    ? d === "LONG"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-danger/40 bg-danger/10 text-danger"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {d === "LONG" ? "Long" : "Short"}
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-2 space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Timeframe (optional)</Label>
          <Input
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            placeholder="e.g. 5m, 1h"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Confluences present</Label>
        <TagToggleRow
          options={reference?.confluences ?? []}
          selected={confluences}
          onToggle={(n) => toggle(confluences, setConfluences, n)}
          empty={strategyId ? "This strategy has no confluences yet." : "Select a strategy first."}
        />
        <SetupScoreCard
          score={liveSetup.setupScore}
          rating={liveSetup.setupRating}
          valid={reference ? liveSetup.setupValid : null}
          missingMandatory={liveSetup.missingMandatory}
          className="pt-1"
        />
      </div>

      {(reference?.execution.length ?? 0) > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Execution confirmations present</Label>
          <TagToggleRow
            options={reference?.execution ?? []}
            selected={execution}
            onToggle={(n) => toggle(execution, setExecution, n)}
            empty=""
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PriceField label="Planned entry" value={plannedEntry} onChange={setPlannedEntry} />
        <PriceField label="Stop loss" value={plannedStopLoss} onChange={setPlannedStopLoss} />
        <PriceField label="Target" value={plannedTarget} onChange={setPlannedTarget} />
        <PriceField label="Planned R:R" value={plannedRR} onChange={setPlannedRR} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || refLoading}>
          {pending ? "Saving…" : "Log opportunity"}
        </Button>
      </div>
    </div>
  );
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="tabular-nums"
      />
    </div>
  );
}

function TagToggleRow({
  options,
  selected,
  onToggle,
  empty,
}: {
  options: { name: string; color: string }[];
  selected: string[];
  onToggle: (name: string) => void;
  empty: string;
}) {
  if (options.length === 0) {
    return empty ? <p className="text-xs text-muted-foreground">{empty}</p> : null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.name);
        const s = TAG_STYLES[o.color as keyof typeof TAG_STYLES] ?? TAG_STYLES.GRAY;
        return (
          <button
            key={o.name}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.name)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              on ? s.chip : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", on ? s.dot : "bg-muted-foreground/40")} />
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
