import Link from "next/link";
import { CheckCircle2, Circle, Image as ImageIcon, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import { minutesToTimeString, utcDateToKey } from "@/lib/date";
import { parseSymbol, formatTargetPrice } from "@/domain/trade-plan/instrument-catalog";
import type { TradeWithWorkspaceRelations } from "@/server/services/trades.service";

function signedR(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function RecentTradesTable({ trades }: { trades: TradeWithWorkspaceRelations[] }) {
  if (trades.length === 0) {
    return (
      <EmptyState icon={ListChecks} title="No trades yet" description="Log your first trade from the Journal to see it here." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Trade</th>
            <th className="py-2 pr-3 font-normal">Plan</th>
            <th className="py-2 pr-3 text-right font-normal">Result</th>
            <th className="py-2 pr-3 text-right font-normal">Adherence</th>
            <th className="py-2 pr-3 text-center font-normal">Shot</th>
            <th className="py-2 pr-3 font-normal">Allocation</th>
            <th className="py-2 text-center font-normal">Review</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const dateKey = utcDateToKey(t.tradeDate);
            const precision = parseSymbol(t.assetSymbol).spec?.decimalPrecision ?? null;
            const actualRR = t.actualRR ? t.actualRR.toNumber() : null;
            const performance = t.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");

            return (
              <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                <td className="py-2.5 pr-3">
                  <Link href={`/journal/${dateKey}/trades/${t.id}`} className="flex items-center gap-2">
                    <span className="font-medium">{t.assetSymbol}</span>
                    <Badge variant={t.direction === "LONG" ? "success" : "danger"}>
                      {t.direction === "LONG" ? "Long" : "Short"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {dateKey} · {minutesToTimeString(t.executionMinutes)}
                    </span>
                  </Link>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {t.plannedTargets.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      t.plannedTargets.map((pt) => (
                        <Badge key={pt.targetOrder} variant="outline">
                          {pt.label} {formatTargetPrice(pt.targetPrice.toNumber(), precision)}
                        </Badge>
                      ))
                    )}
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {actualRR == null ? (
                    <span className="text-muted-foreground">Open</span>
                  ) : (
                    <span className={actualRR >= 0 ? "text-success" : "text-danger"}>{signedR(actualRR)}</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {t.tradeQualityPercent == null ? "—" : `${t.tradeQualityPercent}%`}
                </td>
                <td className="py-2.5 pr-3 text-center">
                  {t.planScreenshot ? (
                    <ImageIcon className="mx-auto size-3.5 text-success" aria-label="Has a plan screenshot" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {t.allocations.map((a) => (
                      <span key={a.tradingAccountId} className="text-muted-foreground">
                        {a.tradingAccount.name}
                      </span>
                    ))}
                    {performance && (
                      <span className={cn("font-medium tabular-nums", performance.closingPnlNet.toNumber() >= 0 ? "text-success" : "text-danger")}>
                        {performance.closingPnlNet.toNumber() >= 0 ? "+" : ""}
                        {performance.closingPnlNet.toNumber().toFixed(2)}
                      </span>
                    )}
                    {t.psychology && <Badge variant={GRADE_VARIANT[t.psychology.grade]}>{t.psychology.grade}</Badge>}
                  </div>
                </td>
                <td className="py-2.5 text-center">
                  {t.reviewedAt ? (
                    <CheckCircle2 className="mx-auto size-3.5 text-success" aria-label="Reviewed" />
                  ) : (
                    <Circle className="mx-auto size-3.5 text-muted-foreground" aria-label="Not reviewed" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
