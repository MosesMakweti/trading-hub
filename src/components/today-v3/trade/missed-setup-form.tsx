"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TAG_STYLES } from "@/components/ui/tag";
import { isConfluenceEligible } from "@/domain/trades/confluence-score";
import { loadStrategyReference } from "@/actions/trades.actions";
import { recordMissedSetup } from "@/actions/opportunity.actions";
import { MissOutcomeForm } from "@/components/journal/opportunity/miss-outcome-form";
import { useDayRef } from "@/components/workspace/workspace-context";
import type { StrategyReferenceDTO } from "@/types/strategies";
import type { DailyAssetAnalysisDTO } from "@/types/today";

/**
 * Today V3 (Phase 4) — "+ Setup missed": a valid (or potentially valid) setup
 * the trader saw but did not take, recorded in one compact step. Inherits
 * what Today already knows (the asset's active strategy and final bias);
 * asks only what the trader alone knows (why it was missed, what it would
 * have done). Stored as a canonical TradeOpportunity (status MISSED) scored
 * by the same setup-score path as every opportunity — never a Trade, so it
 * never counts as executed or uses Performance risk.
 */
export function MissedSetupForm({
  dateKey,
  strategies,
  analyses,
  onDone,
}: {
  dateKey: string;
  strategies: { id: string; name: string; version: number }[];
  analyses: Pick<DailyAssetAnalysisDTO, "assetSymbol" | "activeStrategyId" | "finalBias">[];
  onDone: () => void;
}) {
  const dayRef = useDayRef(dateKey);
  const first = analyses.find((a) => a.activeStrategyId && strategies.some((s) => s.id === a.activeStrategyId)) ?? null;
  const [strategyId, setStrategyId] = useState(first?.activeStrategyId ?? "");
  const [reference, setReference] = useState<StrategyReferenceDTO | null>(null);
  const [assetSymbol, setAssetSymbol] = useState(first?.assetSymbol ?? "");
  const [direction, setDirection] = useState<"LONG" | "SHORT">(first?.finalBias === "SHORT" ? "SHORT" : "LONG");
  const [confluences, setConfluences] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!strategyId) {
        setReference(null);
        return;
      }
      const ref = await loadStrategyReference(strategyId);
      if (active) setReference(ref);
    })();
    return () => {
      active = false;
    };
  }, [strategyId]);

  const assetOptions = Array.from(
    new Set([...analyses.filter((a) => !strategyId || a.activeStrategyId === strategyId).map((a) => a.assetSymbol), ...(reference?.applicableAssets ?? [])]),
  );
  const eligible = (reference?.confluences ?? []).filter((c) => isConfluenceEligible(c.directionApplicability ?? "BOTH", direction));

  function pickAsset(symbol: string) {
    setAssetSymbol(symbol);
    const a = analyses.find((x) => x.assetSymbol === symbol);
    if (a?.finalBias === "LONG" || a?.finalBias === "SHORT") setDirection(a.finalBias);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Setup missed</h3>
        <p className="text-xs text-muted-foreground">
          A setup you saw but didn&apos;t take. It&apos;s kept apart from your trades — it never counts as executed or uses risk.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Strategy</Label>
          <Select
            items={strategies.map((s) => ({ value: s.id, label: s.name }))}
            value={strategyId}
            onValueChange={(v) => {
              setStrategyId(v ?? "");
              setConfluences([]);
            }}
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
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Asset</Label>
          <Select items={assetOptions.map((a) => ({ value: a, label: a }))} value={assetSymbol} onValueChange={(v) => pickAsset(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={strategyId ? "Select asset" : "Select a strategy first"} />
            </SelectTrigger>
            <SelectContent>
              {assetOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
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
                onClick={() => {
                  setDirection(d);
                  setConfluences([]);
                }}
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
      </div>

      {eligible.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Setup — confluences present (optional, scores validity)</Label>
          <div className="flex flex-wrap gap-1.5">
            {eligible.map((c) => {
              const on = confluences.includes(c.name);
              return (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setConfluences((cur) => (on ? cur.filter((n) => n !== c.name) : [...cur, c.name]))}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    on ? TAG_STYLES[c.color].chip : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {c.name}
                  {c.mandatory ? " *" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <MissOutcomeForm
        dateKey={dateKey}
        onDone={onDone}
        onCancel={onDone}
        submitLabel="Record missed setup"
        successMessage="Missed setup recorded."
        notePlaceholder="Anything worth remembering (optional)"
        onSubmit={async (miss) => {
          if (!strategyId) {
            toast.error("Select a strategy.");
            return { success: false, error: "Select a strategy." };
          }
          if (!assetSymbol) {
            toast.error("Select an asset.");
            return { success: false, error: "Select an asset." };
          }
          const r = await recordMissedSetup(dayRef, {
            setup: { strategyId, assetSymbol, direction, selectedConfluences: confluences },
            miss,
          });
          return r.success ? { success: true } : r;
        }}
      />
    </div>
  );
}
