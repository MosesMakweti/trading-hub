"use client";

import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";

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
import { TagToggleGroup } from "@/components/journal/tag-toggle-group";
import { PsychologyQuestionnaire } from "@/components/journal/psychology-questionnaire";
import { minutesToTimeString, timeStringToMinutes } from "@/lib/date";
import { tradeSchema, type TradeFormValues, type TradeInput } from "@/lib/validation/trades";
import { createTrade, updateTrade } from "@/actions/trades.actions";

const NO_SESSION = "__none__";
const NO_STRATEGY = "__none__";

const emptyDefaults: TradeFormValues = {
  assetId: "",
  executionMinutes: 570,
  direction: "LONG",
  higherTimeframeBias: "BULLISH",
  biasConfidencePercent: 50,
  sessionId: null,
  strategyId: null,
  expectedRR: 2,
  actualRR: null,
  performanceClosingPnlGross: 0,
  performanceClosingPnlNet: 0,
  hitTP1: false,
  hitTP2: false,
  hitTP3: false,
  hitFullTP: false,
  psychPreTradeMindset: null,
  psychPostTradeReflection: null,
  psychLessonsLearned: null,
  psychWhatToWorkOn: null,
  allocations: [],
  checklistItemIds: [],
  entryModelIds: [],
  psychologyAnswers: {},
};

interface TradeFormProps {
  dateKey: string;
  mode: "create" | "edit";
  tradeId?: string;
  accounts: { id: string; name: string; kind: string }[];
  assets: { id: string; symbol: string; label: string | null }[];
  sessions: { id: string; name: string }[];
  entryModels: { id: string; name: string }[];
  confluenceItems: { id: string; label: string }[];
  executionItems: { id: string; label: string }[];
  strategies: { id: string; name: string; version: number }[];
  defaultValues?: TradeFormValues;
}

export function TradeForm({
  dateKey,
  mode,
  tradeId,
  accounts,
  assets,
  sessions,
  entryModels,
  confluenceItems,
  executionItems,
  strategies,
  defaultValues,
}: TradeFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<TradeFormValues, unknown, TradeInput>({
    resolver: zodResolver(tradeSchema),
    defaultValues: defaultValues ?? emptyDefaults,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "allocations" });

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
      });
    }
  }

  async function onSubmit(values: TradeInput) {
    setIsSubmitting(true);
    const result =
      mode === "create"
        ? await createTrade(dateKey, values)
        : await updateTrade(dateKey, tradeId!, values);
    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(mode === "create" ? "Trade added." : "Trade updated.");
    // After an edit, return to that trade's workspace; after create, to the day.
    router.push(
      mode === "edit" && tradeId ? `/journal/${dateKey}/trades/${tradeId}` : `/journal/${dateKey}`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <section className="glass space-y-4 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Trade Basics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label className="text-xs">Asset</Label>
            <Controller
              control={control}
              name="assetId"
              render={({ field }) => (
                <Select
                  items={assets.map((a) => ({ value: a.id, label: a.symbol }))}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select asset" />
                  </SelectTrigger>
                  <SelectContent>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.assetId && <p className="text-xs text-danger">{errors.assetId.message}</p>}
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
              name="sessionId"
              render={({ field }) => (
                <Select
                  items={[
                    { value: NO_SESSION, label: "None" },
                    ...sessions.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  value={field.value ?? NO_SESSION}
                  onValueChange={(v) => field.onChange(v === NO_SESSION ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SESSION}>None</SelectItem>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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

        <div className="space-y-1.5">
          <Label className="text-xs">Strategy</Label>
          <Controller
            control={control}
            name="strategyId"
            render={({ field }) => (
              <Select
                items={[
                  { value: NO_STRATEGY, label: "None" },
                  ...strategies.map((s) => ({ value: s.id, label: `${s.name} · v${s.version}` })),
                ]}
                value={field.value ?? NO_STRATEGY}
                onValueChange={(v) => field.onChange(v === NO_STRATEGY ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STRATEGY}>None</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · v{s.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-xs text-muted-foreground">
            Links this trade to a Strategy Lab strategy and snapshots its name &amp; version at
            save time, so the record stays accurate even if the strategy changes later.
          </p>
        </div>
      </section>

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Performance Account — Closing PnL</h2>
        <p className="text-xs text-muted-foreground">
          The one PnL you enter for this trade. Every participating account below mirrors it
          automatically, scaled by its own risk%.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Gross PnL ($)</Label>
            <Input type="number" step="0.01" {...register("performanceClosingPnlGross")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Net PnL ($)</Label>
            <Input type="number" step="0.01" {...register("performanceClosingPnlNet")} />
          </div>
        </div>
      </section>

      <section className="glass grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Expected RR</Label>
          <Input type="number" step="0.01" {...register("expectedRR")} />
        </div>
        <div className="space-y-1.5">
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

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Other Participating Accounts &amp; Risk
        </h2>
        <p className="text-xs text-muted-foreground">
          Optional — select any prop-firm/brokerage accounts this trade also affects. Their PnL is
          calculated automatically, never entered manually.
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
        <h2 className="text-sm font-medium text-muted-foreground">Entry Model</h2>
        <TagToggleGroup
          control={control}
          name="entryModelIds"
          items={entryModels.map((m) => ({ id: m.id, label: m.name }))}
          emptyLabel="No entry models configured yet — add them in Settings > Trading Plan."
        />
      </section>

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Confluences</h2>
        <TagToggleGroup
          control={control}
          name="checklistItemIds"
          items={confluenceItems}
          emptyLabel="No confluences configured yet — add them in Settings > Trading Plan."
        />
      </section>

      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Execution Confirmation</h2>
        <TagToggleGroup
          control={control}
          name="checklistItemIds"
          items={executionItems}
          emptyLabel="No execution-confirmation items configured yet — add them in Settings > Trading Plan."
        />
      </section>

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
      </section>

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Images</h2>
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center opacity-60">
          <ImageIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Image uploads coming soon</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Analysis, before-trade, and after-trade screenshots will be uploadable here once
            image hosting is connected.
          </p>
        </div>
      </section>

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
