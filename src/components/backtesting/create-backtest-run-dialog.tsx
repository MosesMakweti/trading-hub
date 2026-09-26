"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { WEEKDAY_OPTIONS } from "@/components/backtesting/format";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { listTradingDayKeys } from "@/domain/backtesting/run-calendar";
import { isValidDateKey } from "@/lib/date";
import { createBacktestRunAction } from "@/actions/backtesting.actions";
import type { BacktestStrategyOptionDTO } from "@/types/backtesting";

const NO_STRATEGY = "__none__";

type Field = "name" | "strategyId" | "assets" | "startDate" | "endDate" | "tradingWeekdays" | "startingBalance" | "riskPercentPerTrade" | "currency" | "description";

function initialState() {
  return {
    name: "",
    strategyId: NO_STRATEGY,
    assets: [] as string[],
    startDate: "",
    endDate: "",
    tradingWeekdays: [1, 2, 3, 4, 5],
    description: "",
    startingBalance: "",
    riskPercentPerTrade: "",
    currency: "USD",
  };
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-danger">{message}</p> : null;
}

export function CreateBacktestRunDialog({
  strategies,
  trigger,
}: {
  strategies: BacktestStrategyOptionDTO[];
  /** Optional custom trigger label (e.g. the empty state's CTA). */
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialState);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const strategy = strategies.find((s) => s.id === form.strategyId) ?? null;
  const strategyMarkets = strategy?.applicableAssets ?? [];

  const tradingDays = useMemo(() => {
    if (!isValidDateKey(form.startDate) || !isValidDateKey(form.endDate) || form.endDate < form.startDate) return null;
    return listTradingDayKeys({ startDateKey: form.startDate, endDateKey: form.endDate, tradingWeekdays: form.tradingWeekdays }).length;
  }, [form.startDate, form.endDate, form.tradingWeekdays]);

  function patch(next: Partial<ReturnType<typeof initialState>>) {
    setForm((f) => ({ ...f, ...next }));
    setFormError(null);
    setErrors((e) => {
      const cleared = { ...e };
      for (const key of Object.keys(next)) delete cleared[key as Field];
      return cleared;
    });
  }

  function selectStrategy(id: string) {
    const next = strategies.find((s) => s.id === id);
    // Strategy Lab owns the markets: default to all of them, and never keep
    // an asset the newly selected strategy doesn't trade.
    const markets = next?.applicableAssets ?? [];
    const kept = form.assets.filter((a) => markets.includes(a));
    const assets = markets.length === 0 ? form.assets : kept.length > 0 ? kept : markets;
    patch({ strategyId: id, assets, name: form.name || (next ? `${next.name} backtest` : "") });
  }

  function toggleWeekday(day: number) {
    const set = new Set(form.tradingWeekdays);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    patch({ tradingWeekdays: [...set].sort() });
  }

  function toggleMarket(asset: string) {
    patch({ assets: form.assets.includes(asset) ? form.assets.filter((a) => a !== asset) : [...form.assets, asset] });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      description: form.description.trim() || null,
      strategyId: form.strategyId === NO_STRATEGY ? null : form.strategyId,
      assets: form.assets,
      startDate: form.startDate,
      endDate: form.endDate,
      tradingWeekdays: form.tradingWeekdays,
      startingBalance: form.startingBalance.trim() ? form.startingBalance : null,
      riskPercentPerTrade: form.riskPercentPerTrade.trim() ? form.riskPercentPerTrade : null,
      currency: form.startingBalance.trim() ? form.currency : null,
    };
    const parsed = createBacktestRunSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    startTransition(async () => {
      const result = await createBacktestRunAction(payload);
      if (!result.success) {
        setFormError(result.error);
        return;
      }
      setOpen(false);
      setForm(initialState());
      toast.success("Backtest run created.");
      router.push(`/backtesting/${result.id}/session`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-1.5" />}>
        <Plus className="size-4" />
        {trigger ?? "New Backtest Run"}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New backtest run</DialogTitle>
          <DialogDescription>
            One run is one experiment — a strategy tested over a historical period.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="bt-strategy" className="text-xs">Strategy</Label>
            <Select
              items={{ [NO_STRATEGY]: "No strategy", ...Object.fromEntries(strategies.map((s) => [s.id, s.name])) }}
              value={form.strategyId}
              onValueChange={(v) => selectStrategy(v ?? NO_STRATEGY)}
            >
              <SelectTrigger id="bt-strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_STRATEGY}>No strategy</SelectItem>
                {strategies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {strategies.length === 0 ? (
                <>
                  Strategies come from{" "}
                  <Link href="/strategy-lab" className="underline underline-offset-2">Strategy Lab</Link>.
                </>
              ) : (
                "The strategy is captured as it is today, so later edits never change this run."
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-name" className="text-xs">Run name</Label>
            <Input id="bt-name" value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. EURUSD Strategy V3 — H1 2024" />
            <FieldError message={errors.name} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Assets</Label>
            {strategyMarkets.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Assets">
                {strategyMarkets.map((asset) => {
                  const on = form.assets.includes(asset);
                  return (
                    <button
                      key={asset}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleMarket(asset)}
                      className={cn(
                        "rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                        on ? "border-foreground/40 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {asset}
                    </button>
                  );
                })}
              </div>
            ) : (
              <AssetTagInput value={form.assets} onChange={(assets) => patch({ assets })} />
            )}
            {strategyMarkets.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Limited to the markets {strategy?.name} trades.</p>
            )}
            <FieldError message={errors.assets} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bt-start" className="text-xs">Start date</Label>
              <Input id="bt-start" type="date" value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
              <FieldError message={errors.startDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-end" className="text-xs">End date</Label>
              <Input id="bt-end" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => patch({ endDate: e.target.value })} />
              <FieldError message={errors.endDate} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Trading weekdays</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Trading weekdays">
              {WEEKDAY_OPTIONS.map((d) => {
                const on = form.tradingWeekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWeekday(d.value)}
                    className={cn(
                      "w-11 rounded-md border py-1 text-xs font-medium transition-colors",
                      on ? "border-foreground/40 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {tradingDays == null ? "Only these days count toward progress." : `${tradingDays} trading day${tradingDays === 1 ? "" : "s"} in this period.`}
            </p>
            <FieldError message={errors.tradingWeekdays} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-notes" className="text-xs">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="bt-notes" rows={2} value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="What are you testing, and what would count as a pass?" />
          </div>

          <fieldset className="space-y-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium">
              Simulation balance <span className="text-muted-foreground">(optional)</span>
            </legend>
            <p className="text-[11px] text-muted-foreground">
              A pretend balance for this run only — it is never a trading, Performance or Prop Firm account. Results are always tracked in R.
            </p>
            <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
              <div className="space-y-1">
                <Label htmlFor="bt-balance" className="text-[11px] text-muted-foreground">Starting balance</Label>
                <Input id="bt-balance" inputMode="decimal" value={form.startingBalance} onChange={(e) => patch({ startingBalance: e.target.value })} placeholder="10000" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bt-currency" className="text-[11px] text-muted-foreground">Currency</Label>
                <Input id="bt-currency" value={form.currency} maxLength={3} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bt-risk" className="text-[11px] text-muted-foreground">Risk / trade %</Label>
                <Input id="bt-risk" inputMode="decimal" value={form.riskPercentPerTrade} onChange={(e) => patch({ riskPercentPerTrade: e.target.value })} placeholder="1" />
              </div>
            </div>
            <FieldError message={errors.startingBalance ?? errors.currency ?? errors.riskPercentPerTrade} />
          </fieldset>

          {formError && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
