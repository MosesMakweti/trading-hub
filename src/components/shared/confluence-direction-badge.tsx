import { ArrowDownRight, ArrowUpRight, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ConfluenceDirectionValue } from "@/lib/validation/strategy-sot";

// One consistent visual language for confluence direction applicability across
// the Strategy Lab, the trade form, and analytics: bullish = green, bearish =
// red, both = neutral. See the direction-aware confluence spec §10.

export const CONFLUENCE_DIRECTION_META: Record<
  ConfluenceDirectionValue,
  { label: string; short: string; longLabel: string; icon: typeof ArrowUpRight; className: string; dot: string }
> = {
  BULLISH: {
    label: "Bullish",
    short: "Bull",
    longLabel: "Bullish only (long trades)",
    icon: ArrowUpRight,
    className: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  BEARISH: {
    label: "Bearish",
    short: "Bear",
    longLabel: "Bearish only (short trades)",
    icon: ArrowDownRight,
    className: "border-danger/30 bg-danger/10 text-danger",
    dot: "bg-danger",
  },
  BOTH: {
    label: "Both",
    short: "Both",
    longLabel: "Both directions",
    icon: ArrowUpDown,
    className: "border-border bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export function ConfluenceDirectionBadge({
  direction,
  className,
  withIcon = true,
}: {
  direction: ConfluenceDirectionValue;
  className?: string;
  withIcon?: boolean;
}) {
  const meta = CONFLUENCE_DIRECTION_META[direction];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        meta.className,
        className,
      )}
    >
      {withIcon && <Icon className="size-2.5" />}
      {meta.label}
    </span>
  );
}
