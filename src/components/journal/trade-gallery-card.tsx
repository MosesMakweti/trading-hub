import Link from "next/link";

import { cn } from "@/lib/utils";
import { formatDateKeyShort } from "@/lib/date";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import { Badge } from "@/components/ui/badge";
import {
  TradeStatusBadge,
  formatRR,
  formatSignedCurrency,
} from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

/**
 * One trade in the gallery: an analysis-image thumbnail when present, otherwise a
 * compact stat card (asset · direction · R · PnL · psychology · status). The whole
 * card links to the trade's workspace. Reuses the workspace DTO + shared badges.
 */
export function TradeGalleryCard({ trade }: { trade: TradeWorkspaceDTO }) {
  const image = trade.previewImageUrl ?? null;
  const rrTone =
    trade.actualRR == null ? "text-muted-foreground" : trade.actualRR >= 0 ? "text-success" : "text-danger";

  return (
    <Link
      href={`/journal/${trade.dateKey}/trades/${trade.id}`}
      className="glass group flex flex-col overflow-hidden rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-elevated"
    >
      {image && (
        <div className="relative aspect-video w-full overflow-hidden bg-background/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={`${trade.assetSymbol} analysis`}
            className="size-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">#{trade.tradeNumber}</span>
          <TradeStatusBadge status={trade.status} />
        </div>

        <div className="flex items-center gap-2">
          <span className="font-semibold">{trade.assetSymbol}</span>
          <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
            {trade.direction === "LONG" ? "Long" : "Short"}
          </Badge>
        </div>

        <div className="text-xs text-muted-foreground">{formatDateKeyShort(trade.dateKey)}</div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2">
          <div className="text-sm">
            <span className={cn("font-medium tabular-nums", rrTone)}>
              {trade.actualRR == null ? "Open" : formatRR(trade.actualRR)}
            </span>
            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
              {formatSignedCurrency(trade.performancePnlNet)}
            </span>
          </div>
          {trade.psychology && (
            <Badge variant={GRADE_VARIANT[trade.psychology.grade]}>{trade.psychology.grade}</Badge>
          )}
        </div>
      </div>
    </Link>
  );
}
