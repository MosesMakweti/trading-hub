"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";

/**
 * Chip-style editor for a strategy's applicable market symbols (and, by reuse,
 * any other short upper-cased tag list — e.g. the Daily Outlook's watchlist/
 * sessions inputs). Add with Enter or comma; remove with the chip's ✕ or
 * Backspace on an empty field. Values are upper-cased and de-duplicated.
 * Purely controlled — the parent owns the array and decides when to persist.
 */
export function AssetTagInput({
  value,
  onChange,
  disabled,
  placeholder = "e.g. XAUUSD, NAS100, EURUSD",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
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
      {value.map((symbol) => {
        const s = TAG_STYLES[colorForName(symbol)];
        return (
          <span
            key={symbol}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs",
              s.chip,
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
            {symbol}
            <button
              type="button"
              aria-label={`Remove ${symbol}`}
              onClick={() => remove(symbol)}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addFromDraft}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : "Add…"}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
