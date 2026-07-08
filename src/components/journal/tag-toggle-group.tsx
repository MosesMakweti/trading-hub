"use client";

import { Controller, type Control } from "react-hook-form";

import { cn } from "@/lib/utils";
import type { TradeFormValues } from "@/lib/validation/trades";

export function TagToggleGroup({
  control,
  name,
  items,
  emptyLabel,
}: {
  control: Control<TradeFormValues>;
  name: "checklistItemIds" | "entryModelIds";
  items: { id: string; label: string }[];
  emptyLabel: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected: string[] = field.value ?? [];
        function toggle(id: string) {
          field.onChange(
            selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
          );
        }
        if (items.length === 0) {
          return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
        }
        return (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    checked
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        );
      }}
    />
  );
}
