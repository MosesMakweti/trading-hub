import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "flat";

/**
 * DeltaChip — a compact change-vs-previous pill (arrow + value), tinted by
 * direction. Green for gains, red for losses, muted for flat. Used on KPI cards
 * and inside table rows to give every headline number a "vs previous" anchor.
 */
export function DeltaChip({
  value,
  direction,
  size = "sm",
  className,
}: {
  value: string;
  direction: Direction;
  size?: "sm" | "xs";
  className?: string;
}) {
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md font-medium tabular-nums",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-1 py-px text-[11px]",
        direction === "up" && "bg-success/10 text-success",
        direction === "down" && "bg-danger/10 text-danger",
        direction === "flat" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-2.5"} strokeWidth={2.5} aria-hidden />
      {value}
    </span>
  );
}

/** Derive a delta direction from a signed number (tiny magnitudes read as flat). */
export function directionOf(n: number, epsilon = 0.0001): Direction {
  if (n > epsilon) return "up";
  if (n < -epsilon) return "down";
  return "flat";
}
