import { Badge } from "@/components/ui/badge";
import type { StrategyStatusValue } from "@/lib/validation/strategies";

type BadgeVariant = "secondary" | "warning" | "success" | "outline";

export const STRATEGY_STATUS_META: Record<
  StrategyStatusValue,
  { label: string; variant: BadgeVariant }
> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  TESTING: { label: "Testing", variant: "warning" },
  LIVE: { label: "Live", variant: "success" },
  ARCHIVED: { label: "Archived", variant: "outline" },
};

export const STRATEGY_STATUS_ORDER: StrategyStatusValue[] = [
  "DRAFT",
  "TESTING",
  "LIVE",
  "ARCHIVED",
];

export function StrategyStatusBadge({ status }: { status: StrategyStatusValue }) {
  const meta = STRATEGY_STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
