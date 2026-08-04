"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  "plannedEntry" | "plannedStopLoss" | "plannedTarget" | "actualEntry" | "actualExit"
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
  return useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: async (v) =>
      updateTradeSection(dateKey, tradeId, { [field]: v.trim() } as TradeWorkspaceSectionInput),
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
  const [value, setValue] = useState<boolean | null>(initialValue);
  const [saving, setSaving] = useState<SaveState>("idle");

  async function choose(next: boolean | null) {
    if (next === value) return;
    setValue(next);
    setSaving("saving");
    const result = await updateTradeSection(dateKey, tradeId, { wouldTakeAgain: next });
    if (result.success) {
      setSaving("saved");
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
