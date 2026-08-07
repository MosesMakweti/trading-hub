"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SquareArrowOutUpRight, Target, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { minutesToTimeString } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { TradeQualityBadge } from "@/components/journal/adherence-score";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { archiveTrade } from "@/actions/trades.actions";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import type { TradeListItemDTO } from "@/types/trades";

function percent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function TradeCard({ dateKey, trade }: { dateKey: string; trade: TradeListItemDTO }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await archiveTrade(dateKey, trade.id);
      if (!result.success) {
        toast.error(result.error ?? "Failed to remove trade.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const tpHits = [
    trade.hitTP1 && "TP1",
    trade.hitTP2 && "TP2",
    trade.hitTP3 && "TP3",
    trade.hitFullTP && "Full TP",
  ].filter(Boolean) as string[];

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{trade.assetSymbol}</span>
            <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
              {trade.direction === "LONG" ? "Long" : "Short"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {minutesToTimeString(trade.executionMinutes)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {trade.higherTimeframeBias === "BULLISH" ? "Bullish" : "Bearish"} bias ·{" "}
            {trade.biasConfidencePercent}% confidence
          </p>
          {trade.strategyName &&
            (trade.strategyId ? (
              <Link
                href={`/strategy-lab/${trade.strategyId}`}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                <Target className="size-3" />
                {trade.strategyName}
              </Link>
            ) : (
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Target className="size-3" />
                {trade.strategyName}
              </span>
            ))}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Expected / Actual RR</div>
          <div className="font-medium">
            {trade.expectedRR.toFixed(2)}R /{" "}
            <span
              className={cn(
                trade.actualRR == null
                  ? "text-muted-foreground"
                  : trade.actualRR >= 0
                    ? "text-success"
                    : "text-danger",
              )}
            >
              {trade.actualRR == null ? "Open" : percent(trade.actualRR)}
            </span>
          </div>
          {trade.psychology && (
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <Badge variant={GRADE_VARIANT[trade.psychology.grade]}>
                {trade.psychology.grade}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {trade.psychology.percent.toFixed(1)}% discipline
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {trade.accounts.map((a) => (
          <div key={a.name} className="rounded-lg border border-border bg-background/40 p-2 text-xs">
            <div className="font-medium">{a.name}</div>
            <div className="text-muted-foreground">
              Risk: {a.riskValue}
              {a.riskInputType === "PERCENT" ? "%" : "$"} · Net PnL:{" "}
              <span className={a.closingPnlNet >= 0 ? "text-success" : "text-danger"}>
                {a.closingPnlNet.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {(trade.entryModelNames.length > 0 ||
        trade.confluenceLabels.length > 0 ||
        trade.executionLabels.length > 0 ||
        tpHits.length > 0 ||
        trade.tradeQualityPercent != null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tpHits.map((label) => (
            <Badge key={label} variant="success">
              {label}
            </Badge>
          ))}
          {trade.entryModelNames.map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
          {trade.confluenceLabels.map((tag) => (
            <Tag key={`c-${tag.name}`} color={tag.color}>
              {tag.name}
            </Tag>
          ))}
          {trade.executionLabels.map((tag) => (
            <Tag key={`e-${tag.name}`} color={tag.color}>
              {tag.name}
            </Tag>
          ))}
          <TradeQualityBadge percent={trade.tradeQualityPercent} />
        </div>
      )}

      <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="Open trade workspace"
          nativeButton={false}
          render={<Link href={`/journal/${dateKey}/trades/${trade.id}`} />}
        >
          <SquareArrowOutUpRight className="size-3.5" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete trade"
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove this trade?"
        description="This trade will be removed from the journal. This can't be undone from here."
        confirmLabel="Remove"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
