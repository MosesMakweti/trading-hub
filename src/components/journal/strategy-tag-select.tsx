"use client";

import { Controller, type Control } from "react-hook-form";
import type { TagColor } from "@prisma/client";

import { TAG_STYLES } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { isConfluenceEligible } from "@/domain/trades/confluence-score";
import type { ConfluenceDirectionValue } from "@/lib/validation/strategy-sot";
import type { TradeFormValues } from "@/lib/validation/trades";

export interface StrategyTagOption {
  name: string;
  color: TagColor;
  /** Confluence direction applicability. Absent → BOTH (not direction-filtered). */
  directionApplicability?: ConfluenceDirectionValue;
}

// A strategy-sourced, multi-select group of colored tags. Options come from the
// selected strategy (its confluences / execution confirmations); the field stores
// the chosen NAMES (not ids), which the save layer scores against the strategy's
// frozen expected set. Toggling a tag lights it up in its color.
//
// `direction` (confluences only): when a LONG / SHORT value is passed, options are
// filtered to the eligible set BEFORE the trader sees them — a long trade only
// ever shows Bullish + Both. `null` means "no direction chosen yet" and the group
// is replaced with a prompt. Omit the prop entirely for execution confirmations.
export function StrategyTagSelect({
  control,
  name,
  options,
  emptyLabel,
  direction,
}: {
  control: Control<TradeFormValues>;
  name: "selectedConfluences" | "selectedExecution";
  options: StrategyTagOption[];
  emptyLabel: string;
  direction?: "LONG" | "SHORT" | null;
}) {
  const directionAware = direction !== undefined;

  if (directionAware && direction === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Select a trade direction to view the applicable confluences.
      </p>
    );
  }

  const visibleOptions = directionAware
    ? options.filter((o) => isConfluenceEligible(o.directionApplicability, direction ?? null))
    : options;

  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  if (visibleOptions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No confluences apply to a {direction === "LONG" ? "long" : "short"} trade in this
        strategy.
      </p>
    );
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
            {visibleOptions.map((o) => {
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
