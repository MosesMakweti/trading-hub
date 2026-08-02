"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Chip-style editor for a strategy's applicable market symbols.
 * Add with Enter or comma; remove with the chip's ✕ or Backspace on an empty field.
 * Symbols are upper-cased and de-duplicated. Purely controlled — the parent owns
 * the array and decides when to persist (the Settings form autosaves it).
 */
export function AssetTagInput({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addFromDraft() {
    const symbol = draft.trim().toUpperCase();
    setDraft("");
    if (!symbol) return;
    if (value.includes(symbol)) return;
    onChange([...value, symbol]);
  }

  function remove(symbol: string) {
    onChange(value.filter((s) => s !== symbol));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addFromDraft();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background/50 px-2 py-1.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {value.map((symbol) => (
        <span
          key={symbol}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-xs"
        >
          {symbol}
          <button
            type="button"
            aria-label={`Remove ${symbol}`}
            onClick={() => remove(symbol)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addFromDraft}
        disabled={disabled}
        placeholder={value.length === 0 ? "e.g. XAUUSD, NAS100, EURUSD" : "Add symbol…"}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
