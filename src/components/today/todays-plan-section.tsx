"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { SaveDot, SectionCard } from "@/components/today/today-ui";
import { useDebouncedAutosave, type SaveState } from "@/hooks/use-debounced-autosave";
import { updateTodaysPlan } from "@/actions/today.actions";
import type { DayBias } from "@/lib/validation/today";
import type { TodaysPlanDTO } from "@/types/today";

const BIASES: { value: DayBias; label: string; selected: "default" | "destructive" | "secondary" }[] = [
  { value: "BULLISH", label: "Bullish", selected: "default" },
  { value: "BEARISH", label: "Bearish", selected: "destructive" },
  { value: "NEUTRAL", label: "Neutral", selected: "secondary" },
];

export function TodaysPlanSection({ dateKey, plan }: { dateKey: string; plan: TodaysPlanDTO }) {
  const router = useRouter();

  const [bias, setBias] = useState<DayBias | null>(plan.bias);
  const [conviction, setConviction] = useState<number | null>(plan.conviction);
  const [focus, setFocus] = useState<Set<string>>(new Set(plan.watchlistFocus));
  const [biasSave, setBiasSave] = useState<SaveState>("idle");
  const [focusSave, setFocusSave] = useState<SaveState>("idle");
  const [risk, setRisk] = useState(plan.riskBudgetPercent == null ? "" : String(plan.riskBudgetPercent));
  const [isComplete, setIsComplete] = useState(plan.planComplete);
  const [completing, startComplete] = useTransition();

  const riskSave = useDebouncedAutosave({
    value: risk,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const t = v.trim();
      const num = t === "" ? null : Number(t);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "Risk budget must be 0–100%." };
      }
      return updateTodaysPlan(dateKey, { riskBudgetPercent: num });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  async function chooseBias(value: DayBias) {
    const next = bias === value ? null : value;
    setBias(next);
    setBiasSave("saving");
    const r = await updateTodaysPlan(dateKey, { bias: next });
    if (r.success) setBiasSave("saved");
    else {
      setBiasSave("error");
      toast.error(r.error);
    }
  }

  async function chooseConviction(n: number) {
    const next = conviction === n ? null : n;
    setConviction(next);
    setBiasSave("saving");
    const r = await updateTodaysPlan(dateKey, { conviction: next });
    if (r.success) setBiasSave("saved");
    else {
      setBiasSave("error");
      toast.error(r.error);
    }
  }

  async function toggleFocus(id: string) {
    const next = new Set(focus);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFocus(next);
    setFocusSave("saving");
    const r = await updateTodaysPlan(dateKey, { watchlistFocus: [...next] });
    if (r.success) setFocusSave("saved");
    else {
      setFocusSave("error");
      toast.error(r.error);
    }
  }

  function toggleComplete() {
    const next = !isComplete;
    startComplete(async () => {
      const r = await updateTodaysPlan(dateKey, { planComplete: next });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setIsComplete(next);
      toast.success(next ? "Plan set." : "Plan reopened.");
      router.refresh(); // advance the workflow stepper
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set your intentions for the day — bias, what you&apos;re watching, key levels, and how much
        you&apos;re willing to risk.
      </p>

      {/* Bias & conviction */}
      <SectionCard title="Higher-timeframe bias" action={<SaveDot state={biasSave} />}>
        <div className="flex flex-wrap gap-1.5">
          {BIASES.map((b) => (
            <Button
              key={b.value}
              type="button"
              size="sm"
              variant={bias === b.value ? b.selected : "outline"}
              aria-pressed={bias === b.value}
              onClick={() => chooseBias(b.value)}
            >
              {b.label}
            </Button>
          ))}
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Conviction (1 = low, 5 = high)</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={conviction === n ? "default" : "outline"}
                aria-pressed={conviction === n}
                onClick={() => chooseConviction(n)}
                className="w-10 tabular-nums"
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Watchlist focus */}
      <SectionCard
        title="Watchlist focus"
        action={
          plan.assets.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <SaveDot state={focusSave} />
              {focus.size} selected
            </span>
          ) : null
        }
      >
        {plan.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assets on your watchlist yet.{" "}
            <Link href="/settings/plan" className="text-primary hover:underline">
              Add them in your trading plan
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {plan.assets.map((a) => {
              const on = focus.has(a.id);
              return (
                <Button
                  key={a.id}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  onClick={() => toggleFocus(a.id)}
                  title={a.label ?? undefined}
                >
                  {a.symbol}
                </Button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Key levels */}
      <SectionCard title="Key levels & areas of interest">
        <RichTextEditor
          initialContent={plan.keyLevels}
          placeholder="Support/resistance, session highs/lows, liquidity, order blocks…"
          onSave={(content) => updateTodaysPlan(dateKey, { keyLevels: content })}
        />
      </SectionCard>

      {/* Risk budget */}
      <SectionCard title="Risk budget" action={<SaveDot state={riskSave} />}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              placeholder="e.g. 2"
              aria-label="Risk budget percent"
              className="h-9 w-28 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">% of account today</span>
          </div>
          {plan.planRiskLimit != null && (
            <span className={cn("text-xs text-muted-foreground")}>
              Plan daily limit:{" "}
              <span className="text-foreground tabular-nums">{plan.planRiskLimit}%</span>
            </span>
          )}
        </div>
      </SectionCard>

      {/* Finalize */}
      <div className="flex items-center justify-end gap-3">
        {isComplete && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" />
            Plan set
          </span>
        )}
        <Button
          type="button"
          variant={isComplete ? "outline" : "default"}
          onClick={toggleComplete}
          disabled={completing}
          className="gap-1.5"
        >
          {completing && <Loader2 className="size-3.5 animate-spin" />}
          {isComplete ? "Reopen plan" : "Mark plan complete"}
        </Button>
      </div>
    </div>
  );
}
