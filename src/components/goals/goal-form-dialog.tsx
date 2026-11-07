"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createGoalAction, updateGoalAction } from "@/actions/goals.actions";
import { GOAL_REQUIREMENTS, requirementCatalogueEntry, requirementSetProblem, type GoalRequirementType } from "@/domain/goals";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import { GOAL_DURATION_PRESETS, GOAL_MAX_DAYS, GOAL_MAX_START_AHEAD_DAYS } from "@/lib/validation/goals";
import { cn } from "@/lib/utils";
import type { GoalCategoryDTO } from "@/types/goals";

export const GOAL_CATEGORIES: { value: GoalCategoryDTO; label: string }[] = [
  { value: "ROUTINE", label: "Routine" },
  { value: "EXECUTION", label: "Execution" },
  { value: "RISK", label: "Risk" },
  { value: "JOURNAL", label: "Journal" },
  { value: "MINDSET", label: "Mindset" },
  { value: "OTHER", label: "Other" },
];

interface RequirementRow {
  key: string;
  type: GoalRequirementType;
  label: string | null;
  mandatory: boolean;
}

export interface GoalFormInitial {
  id: string;
  name: string;
  description: string | null;
  category: GoalCategoryDTO;
  targetDays: number;
  startDate: string;
  started: boolean;
  currentStreak: number;
  requirements: { type: GoalRequirementType; label: string | null; mandatory: boolean }[];
}

const DEFAULT_REQUIREMENTS: RequirementRow[] = [
  { key: "PRE_SESSION_ROUTINE", type: "PRE_SESSION_ROUTINE", label: null, mandatory: true },
  { key: "REVIEW_CLOSED_TRADES", type: "REVIEW_CLOSED_TRADES", label: null, mandatory: true },
];

/**
 * Create or edit the single goal. The form explains its own rules as it
 * goes: a goal counts consecutive TRADING days (your schedule's rest days
 * neither count nor break it), and at least one required item must apply
 * on every trading day.
 */
export function GoalFormDialog({
  open,
  onOpenChange,
  todayKey,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayKey: string;
  initial?: GoalFormInitial;
}) {
  const router = useRouter();
  const ids = useId();
  const editing = initial != null;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<GoalCategoryDTO>(initial?.category ?? "ROUTINE");
  const [target, setTarget] = useState<number>(initial?.targetDays ?? 30);
  const [customTarget, setCustomTarget] = useState(!GOAL_DURATION_PRESETS.includes((initial?.targetDays ?? 30) as 30));
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayKey);
  const [reqs, setReqs] = useState<RequirementRow[]>(
    initial ? initial.requirements.map((r, i) => ({ ...r, key: r.type === "CUSTOM_CHECKIN" ? `custom-${i}` : r.type })) : DEFAULT_REQUIREMENTS,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const problem = useMemo(() => requirementSetProblem(reqs, (t) => requirementCatalogueEntry(t).everyTradingDay), [reqs]);
  const minTarget = editing ? initial.currentStreak + 1 : 1;
  const targetProblem =
    !Number.isInteger(target) || target < minTarget || target > GOAL_MAX_DAYS
      ? editing && target <= initial.currentStreak
        ? `Your current streak is ${initial.currentStreak}, so the target must be more than that.`
        : `Choose between ${minTarget} and ${GOAL_MAX_DAYS} days.`
      : null;
  const canSave = name.trim().length > 0 && !problem && !targetProblem && !saving;

  function toggleType(type: GoalRequirementType, on: boolean) {
    setReqs((rs) => (on ? [...rs, { key: type, type, label: null, mandatory: true }] : rs.filter((r) => r.key !== type)));
  }

  function submit() {
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      category,
      targetDays: target,
      requirements: reqs.map((r) => ({ type: r.type, label: r.type === "CUSTOM_CHECKIN" ? (r.label ?? "").trim() : null, mandatory: r.mandatory })),
    };
    start(async () => {
      const r = editing ? await updateGoalAction(initial.id, payload) : await createGoalAction({ ...payload, startDate });
      if (!r.success) {
        setError(r.error);
        return;
      }
      toast.success(editing ? "Goal updated" : "Goal created", {
        description: editing ? "Changes to daily requirements apply from tomorrow." : undefined,
      });
      onOpenChange(false);
      router.refresh();
    });
  }

  const builtIn = GOAL_REQUIREMENTS.filter((r) => r.type !== "CUSTOM_CHECKIN");
  const customs = reqs.filter((r) => r.type === "CUSTOM_CHECKIN");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit goal" : "Set your goal"}</DialogTitle>
          <DialogDescription>
            One goal at a time: a number of trading days in a row on which you meet every required item. Days you don&apos;t trade
            (per your schedule) neither count nor break it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-name`}>Name</Label>
            <Input id={`${ids}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Prepare and review every session" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-desc`}>
              Why it matters <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id={`${ids}-desc`} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Category</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
              {GOAL_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={category === c.value}
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    category === c.value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Length</legend>
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Length in trading days">
              {GOAL_DURATION_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={!customTarget && target === d}
                  disabled={d < minTarget}
                  onClick={() => {
                    setCustomTarget(false);
                    setTarget(d);
                  }}
                  className={cn(
                    "min-w-11 rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40",
                    !customTarget && target === d ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={customTarget}
                onClick={() => setCustomTarget(true)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  customTarget ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Custom
              </button>
              {customTarget && (
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label="Custom length in trading days"
                  className="h-7 w-20"
                  min={minTarget}
                  max={GOAL_MAX_DAYS}
                  value={Number.isFinite(target) ? target : ""}
                  onChange={(e) => setTarget(Number.parseInt(e.target.value, 10))}
                />
              )}
              <span className="text-xs text-muted-foreground">trading days in a row</span>
            </div>
            {targetProblem && <p className="text-xs text-destructive">{targetProblem}</p>}
          </fieldset>

          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-start`}>Start</Label>
              <Input
                id={`${ids}-start`}
                type="date"
                className="w-44"
                value={startDate}
                min={todayKey}
                max={addDaysToDateKey(todayKey, GOAL_MAX_START_AHEAD_DAYS)}
                onChange={(e) => setStartDate(e.target.value || todayKey)}
              />
              <p className="text-xs text-muted-foreground">Today or later — a goal is never back-dated.</p>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Every trading day, I will…</legend>
            <p className="text-xs text-muted-foreground">
              These are checked from what you already record in Traditorium — nothing to tick by hand, except custom check-ins.
              {editing && initial.started ? " Changes apply from tomorrow; past days keep the rules they were judged by." : ""}
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {builtIn.map((entry) => {
                const row = reqs.find((r) => r.key === entry.type);
                const cid = `${ids}-${entry.type}`;
                return (
                  <li key={entry.type} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox id={cid} checked={row != null} onCheckedChange={(v) => toggleType(entry.type, v === true)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={cid} className="text-sm font-medium">
                        {entry.title}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {entry.description}
                        {!entry.everyTradingDay ? " Nothing is owed on a day without trades." : ""}
                      </p>
                    </div>
                    {row && <MandatorySwitch value={row.mandatory} onChange={(m) => setReqs((rs) => rs.map((r) => (r.key === row.key ? { ...r, mandatory: m } : r)))} />}
                  </li>
                );
              })}
              {customs.map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                  <Input
                    aria-label="Custom check-in"
                    className="h-8 flex-1"
                    maxLength={80}
                    placeholder="e.g. Exercise before the open"
                    value={row.label ?? ""}
                    onChange={(e) => setReqs((rs) => rs.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r)))}
                  />
                  <MandatorySwitch value={row.mandatory} onChange={(m) => setReqs((rs) => rs.map((r) => (r.key === row.key ? { ...r, mandatory: m } : r)))} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove check-in" onClick={() => setReqs((rs) => rs.filter((r) => r.key !== row.key))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reqs.length >= 8}
              onClick={() => setReqs((rs) => [...rs, { key: `custom-${Date.now()}`, type: "CUSTOM_CHECKIN", label: "", mandatory: true }])}
            >
              <Plus /> Add a custom check-in
            </Button>
            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Start goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MandatorySwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {value ? "Required" : "Optional"}
      </label>
      <Switch id={id} size="sm" checked={value} onCheckedChange={(v) => onChange(v)} />
    </span>
  );
}
