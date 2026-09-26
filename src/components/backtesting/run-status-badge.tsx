import { Badge } from "@/components/ui/badge";
import type { BacktestRunStatusValue } from "@/types/backtesting";

export const RUN_STATUS_META: Record<BacktestRunStatusValue, { label: string; variant: "secondary" | "success" | "outline" }> = {
  ACTIVE: { label: "In progress", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "success" },
  ARCHIVED: { label: "Archived", variant: "outline" },
};

export function RunStatusBadge({ status }: { status: BacktestRunStatusValue }) {
  const meta = RUN_STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
