import Link from "next/link";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ListChecks } from "lucide-react";

const GRADE_VARIANT: Record<string, "success" | "warning" | "danger"> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "warning",
  F: "danger",
};

export interface RecentTradeSummary {
  id: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  performancePnl: number;
  psychologyGrade: string | null;
}

function currency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function RecentTradesList({ trades }: { trades: RecentTradeSummary[] }) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No trades yet"
        description="Log your first trade from the Journal to see it here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {trades.map((t) => (
        <Link
          key={t.id}
          href={`/journal/${t.dateKey}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">{t.assetSymbol}</span>
            <Badge variant={t.direction === "LONG" ? "success" : "danger"}>
              {t.direction === "LONG" ? "Long" : "Short"}
            </Badge>
            <span className="text-xs text-muted-foreground">{t.dateKey}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("font-medium", t.performancePnl >= 0 ? "text-success" : "text-danger")}>
              {t.performancePnl >= 0 ? "+" : ""}
              {currency(t.performancePnl)}
            </span>
            {t.psychologyGrade && (
              <Badge variant={GRADE_VARIANT[t.psychologyGrade]}>{t.psychologyGrade}</Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
