"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Check, CircleAlert, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedAutosave, type SaveState } from "@/hooks/use-debounced-autosave";

type SaveResult = { success: true } | { success: false; error: string };

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" aria-live="polite">
      {state === "saving" && <Loader2 className="size-3 animate-spin" />}
      {state === "saved" && <Check className="size-3 text-success" />}
      {state === "error" && <CircleAlert className="size-3 text-danger" />}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved"}
    </span>
  );
}

/**
 * A labelled, autosaving free-text field (debounced; flushes on unmount).
 * Empty text is saved as null so "never answered" and "cleared" read the same.
 */
export function AutosaveText({
  label,
  hint,
  initial,
  placeholder,
  disabled,
  onSave,
  rows = 2,
  className,
  showEmpty = false,
}: {
  label: string;
  hint?: string;
  initial: string | null;
  placeholder?: string;
  disabled?: boolean;
  onSave: (value: string | null) => Promise<SaveResult>;
  rows?: number;
  className?: string;
  /** Read-only + empty: show the label with "—" instead of hiding the field. */
  showEmpty?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial ?? "");
  const state = useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: (v) => onSave(v.trim() === "" ? null : v.trim()),
    onError: (message) => toast.error(message),
  });

  if (disabled && !initial && !showEmpty) return null;

  return (
    <div className={cn("space-y-1", className)}>
      {(label || state !== "idle") && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label htmlFor={id} className="text-xs font-medium text-foreground/90">
              {label}
            </label>
          ) : (
            <span />
          )}
          <SaveIndicator state={state} />
        </div>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {disabled ? (
        <p id={id} className={cn("whitespace-pre-wrap text-sm", initial ? "text-foreground/90" : "text-muted-foreground")}>
          {initial || "—"}
        </p>
      ) : (
        <Textarea id={id} aria-label={label || placeholder} rows={rows} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} className="min-h-0 text-sm" maxLength={4000} />
      )}
    </div>
  );
}

/** Toggle chips for a closed vocabulary (multi- or single-select). */
export function ChipGroup<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  tone = "neutral",
  single = false,
}: {
  label?: string;
  options: { key: K; label: string }[];
  value: K[];
  onChange: (next: K[]) => void;
  disabled?: boolean;
  tone?: "neutral" | "danger" | "warning" | "success";
  single?: boolean;
}) {
  const active = {
    neutral: "border-primary/50 bg-primary/10 text-foreground",
    danger: "border-danger/50 bg-danger/10 text-danger",
    warning: "border-warning/50 bg-warning/10 text-warning-foreground dark:text-warning",
    success: "border-success/50 bg-success/10 text-success",
  }[tone];
  const shown = disabled ? options.filter((o) => value.includes(o.key)) : options;
  if (disabled && shown.length === 0) return null;
  return (
    <div className="space-y-1" role="group" aria-label={label}>
      {label && <p className="text-xs font-medium text-foreground/90">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => {
          const on = value.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(single ? (on ? [] : [o.key]) : on ? value.filter((v) => v !== o.key) : [...value, o.key])}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-default",
                on ? active : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 1–5 rating; clicking the current value clears it. */
export function RatingInput({
  label,
  value,
  onChange,
  disabled,
  evidence,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  evidence?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {evidence && <p className="text-[11px] text-muted-foreground">{evidence}</p>}
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "size-7 rounded-md border text-xs font-medium tabular-nums transition-colors disabled:cursor-default",
              value != null && n <= value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-foreground/40",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
