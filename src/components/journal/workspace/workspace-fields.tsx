"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedAutosave, type SaveState } from "@/hooks/use-debounced-autosave";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { updateTradeSection } from "@/actions/trades.actions";
import type { TradeWorkspaceSectionInput } from "@/lib/validation/trades";

type NoteField = Extract<
  keyof TradeWorkspaceSectionInput,
  | "marketContext"
  | "areasOfInterest"
  | "reasonForTrade"
  | "executionNotes"
  | "whatWentWell"
  | "whatWentWrong"
  | "whatSurprisedMe"
>;

type PriceField = Extract<
  keyof TradeWorkspaceSectionInput,
  "plannedEntry" | "plannedStopLoss" | "plannedTarget" | "actualEntry" | "actualExit" | "actualStopLoss"
>;

// A tiny "saving / saved" indicator shared by every editable field.
function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="inline-flex w-4 shrink-0 items-center justify-center">
      {state === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {state === "saved" && <Check className="size-3.5 text-success" />}
    </span>
  );
}

function useFieldSave(
  dateKey: string,
  tradeId: string,
  field: keyof TradeWorkspaceSectionInput,
  value: string,
) {
  const router = useRouter();
  return useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const result = await updateTradeSection(dateKey, tradeId, {
        [field]: v.trim(),
      } as TradeWorkspaceSectionInput);
      // Refresh so the server-provided trade data reflects the save — the Today
      // view re-seeds a trade's fields from props when you switch back to it, and
      // this keeps that seed current. The focused field isn't remounted (its key
      // is stable), so typing is never interrupted.
      if (result.success) router.refresh();
      return result;
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });
}

/** Single-line numeric price field (planned/actual entry, stop, target). */
export function WorkspacePriceField({
  dateKey,
  tradeId,
  field,
  label,
  initialValue,
  className,
}: {
  dateKey: string;
  tradeId: string;
  field: PriceField;
  label: string;
  initialValue: number | null;
  className?: string;
}) {
  const editable = useWorkspaceEditable();
  const [value, setValue] = useState(initialValue == null ? "" : String(initialValue));
  const state = useFieldSave(dateKey, tradeId, field, value);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        {editable && <SaveIndicator state={state} />}
      </div>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="—"
        aria-label={label}
        disabled={!editable}
        className="h-9 tabular-nums"
      />
    </div>
  );
}

/** Multi-line narrative field (market context, reason, review prompts…). */
export function WorkspaceNoteField({
  dateKey,
  tradeId,
  field,
  label,
  initialValue,
  placeholder,
  rows = 3,
  className,
}: {
  dateKey: string;
  tradeId: string;
  field: NoteField;
  label: string;
  initialValue: string | null;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const editable = useWorkspaceEditable();
  const [value, setValue] = useState(initialValue ?? "");
  const state = useFieldSave(dateKey, tradeId, field, value);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        {editable && <SaveIndicator state={state} />}
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={editable ? (placeholder ?? "Not captured yet.") : "Not captured."}
        aria-label={label}
        rows={rows}
        disabled={!editable}
        className="resize-y"
      />
    </div>
  );
}

/** Tri-state Yes / No / — control for "Would I take this trade again?". */
export function WorkspaceDecisionField({
  dateKey,
  tradeId,
  label,
  initialValue,
  className,
}: {
  dateKey: string;
  tradeId: string;
  label: string;
  initialValue: boolean | null;
  className?: string;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [value, setValue] = useState<boolean | null>(initialValue);
  const [saving, setSaving] = useState<SaveState>("idle");

  async function choose(next: boolean | null) {
    if (next === value) return;
    setValue(next);
    setSaving("saving");
    const result = await updateTradeSection(dateKey, tradeId, { wouldTakeAgain: next });
    if (result.success) {
      setSaving("saved");
      router.refresh();
    } else {
      setSaving("error");
      toast.error(result.error);
    }
  }

  const options: { label: string; value: boolean | null; selected: "default" | "destructive" | "secondary" }[] = [
    { label: "Yes", value: true, selected: "default" },
    { label: "No", value: false, selected: "destructive" },
    { label: "—", value: null, selected: "secondary" },
  ];

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        {editable && <SaveIndicator state={saving} />}
      </div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <Button
            key={o.label}
            type="button"
            size="sm"
            variant={o.value === value ? o.selected : "outline"}
            onClick={() => choose(o.value)}
            aria-pressed={o.value === value}
            disabled={!editable}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

type TradeIntentValue = NonNullable<TradeWorkspaceSectionInput["tradeIntent"]>;
const UNSET = "UNSET";
const INTENT_OPTIONS: { value: TradeIntentValue; label: string }[] = [
  { value: "PLANNED", label: "Planned (disciplined)" },
  { value: "FOMO", label: "FOMO" },
  { value: "REVENGE", label: "Revenge" },
  { value: "BOREDOM", label: "Boredom" },
  { value: "IMPULSE", label: "Impulsive" },
  { value: "MANUAL_OVERRIDE", label: "Manual override vs plan" },
];

/**
 * Behavioral intent tag for the Counterfactual (Discrepancy Gap) engine. PLANNED is
 * disciplined; FOMO / Revenge / Boredom / Impulse mark a trade the process would not
 * have taken (so its loss becomes avoidable, its win "unearned"); Manual override is
 * a flagged behavioral breach. "—" leaves it unspecified (the engine then infers).
 */
export function WorkspaceIntentField({
  dateKey,
  tradeId,
  label,
  initialValue,
  className,
}: {
  dateKey: string;
  tradeId: string;
  label: string;
  initialValue: TradeIntentValue | null;
  className?: string;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [value, setValue] = useState<TradeIntentValue | null>(initialValue);
  const [saving, setSaving] = useState<SaveState>("idle");

  async function choose(raw: string | null) {
    const next = raw == null || raw === UNSET ? null : (raw as TradeIntentValue);
    if (next === value) return;
    setValue(next);
    setSaving("saving");
    const result = await updateTradeSection(dateKey, tradeId, { tradeIntent: next });
    if (result.success) {
      setSaving("saved");
      router.refresh();
    } else {
      setSaving("error");
      toast.error(result.error);
    }
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        {editable && <SaveIndicator state={saving} />}
      </div>
      <Select items={INTENT_OPTIONS} value={value ?? UNSET} onValueChange={choose} disabled={!editable}>
        <SelectTrigger className="h-9 w-full text-sm" aria-label={label}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>—</SelectItem>
          {INTENT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
