"use client";

import { Controller, type Control } from "react-hook-form";
import type { TagColor } from "@prisma/client";

import { TAG_STYLES } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { TradeFormValues } from "@/lib/validation/trades";

// A strategy-sourced, multi-select group of colored tags. Options come from the
// selected strategy (its confluences / execution confirmations); the field stores
// the chosen NAMES (not ids), which the save layer scores against the strategy's
// frozen expected set. Toggling a tag lights it up in its color.
export function StrategyTagSelect({
  control,
  name,
  options,
  emptyLabel,
}: {
  control: Control<TradeFormValues>;
  name: "selectedConfluences" | "selectedExecution";
  options: { name: string; color: TagColor }[];
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected = (field.value ?? []) as string[];
        const toggle = (n: string) =>
          field.onChange(
            selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n],
          );

        return (
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const on = selected.includes(o.name);
              const s = TAG_STYLES[o.color];
              return (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => toggle(o.name)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on
                      ? s.chip
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", on ? s.dot : "bg-muted-foreground/40")} />
                  {o.name}
                </button>
              );
            })}
          </div>
        );
      }}
    />
  );
}
