"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, CandlestickChart, CheckCircle2, Clock, Link2, Trash2, Unlink, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { RatingBadge } from "@/components/journal/setup-score-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ImageAttachments } from "@/components/media/image-attachments";
import { cn } from "@/lib/utils";
import { MissOutcomeForm } from "@/components/journal/opportunity/miss-outcome-form";
import {
  deleteOpportunity,
  expireOpportunity,
  invalidateOpportunity,
  linkExecutedTrade,
  unlinkExecutedTrade,
} from "@/actions/opportunity.actions";
import {
  MISS_REASON_LABELS,
  MISSED_OUTCOME_LABELS,
  type MissedOutcome,
  type OpportunityListItemDTO,
  type OpportunityStatus,
} from "@/types/opportunity";
import type { SetupRating } from "@/domain/trades/setup-score";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { AddTradeDialog } from "@/components/today/add-trade-dialog";

export interface LinkableTrade {
  id: string;
  tradeNumber: number | null;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
}

const STATUS_META: Record<
  OpportunityStatus,
  { label: string; variant: "success" | "danger" | "warning" | "secondary" | "outline" }
> = {
  PENDING: { label: "Pending", variant: "warning" },
  EXECUTED: { label: "Executed", variant: "success" },
  MISSED: { label: "Missed", variant: "danger" },
  INVALIDATED: { label: "Invalidated", variant: "secondary" },
  EXPIRED: { label: "Expired", variant: "outline" },
};

const OUTCOME_TONE: Record<MissedOutcome, string> = {
  MISSED_WIN: "text-danger", // a missed win is a cost — shown as a loss to the trader
  MISSED_LOSS: "text-success", // avoided a loss — good
  MISSED_BREAKEVEN: "text-muted-foreground",
  MISSED_UNDETERMINED: "text-muted-foreground",
};

const fmtR = (r: number | null): string =>
  r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;

export function OpportunityCard({
  dateKey,
  opportunity: o,
  linkableTrades,
  editable,
  strategies = [],
  onTake,
}: {
  dateKey: string;
  opportunity: OpportunityListItemDTO;
  linkableTrades: LinkableTrade[];
  editable: boolean;
  /** For the in-Session "Log trade" dialog (Backtesting). */
  strategies?: { id: string; name: string; version: number }[];
  /** Today V3 (live): take the setup through the Quick Trade Idea instead of
   *  the Journal's full trade form. */
  onTake?: (opportunity: OpportunityListItemDTO) => void;
}) {
  const [panel, setPanel] = useState<"none" | "miss" | "link">("none");
  const [linkTradeId, setLinkTradeId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const { isBacktest } = useWorkspace();

  const status = STATUS_META[o.status];
  const isPending = o.status === "PENDING";

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.success) toast.success(ok);
      else toast.error(res.error ?? "Something went wrong.");
    });

  const doLink = () => {
    if (!linkTradeId) return toast.error("Pick a trade.");
    run(() => linkExecutedTrade(dateKey, o.id, linkTradeId), "Linked executed trade.");
    setPanel("none");
  };

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{o.assetSymbol}</span>
            <span
              className={cn(
                "text-xs font-medium",
                o.direction === "LONG" ? "text-success" : "text-danger",
              )}
            >
              {o.direction === "LONG" ? "Long" : "Short"}
            </span>
            {o.timeframe && (
              <span className="text-xs text-muted-foreground">· {o.timeframe}</span>
            )}
          </div>
          {o.strategyName && (
            <p className="text-xs text-muted-foreground">
              {o.strategyId ? (
                <Link href={`/strategy-lab/${o.strategyId}`} className="hover:text-foreground hover:underline">
                  {o.strategyName}
                </Link>
              ) : (
                o.strategyName
              )}
            </p>
          )}
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {/* Validity + score */}
      <div className="flex flex-wrap items-center gap-2">
        {o.setupValid === false ? (
          <Badge variant="danger" className="gap-1">
            <XCircle className="size-3" />
            Invalid setup
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="size-3 text-success" />
            Valid setup
          </Badge>
        )}
        {o.setupScore != null && (
          <span className="text-xs tabular-nums text-muted-foreground">{o.setupScore}%</span>
        )}
        {o.setupRating && <RatingBadge rating={o.setupRating as SetupRating} />}
        {o.setupValid === false && o.missingMandatory.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Missing: {o.missingMandatory.join(", ")}
          </span>
        )}
      </div>

      {/* Confluence chips */}
      {o.confluenceLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {o.confluenceLabels.map((c) => (
            <Tag key={c.name} color={c.color}>
              {c.name}
            </Tag>
          ))}
        </div>
      )}

      {/* Planned idea */}
      {(o.plannedEntry != null || o.plannedStopLoss != null || o.plannedTarget != null || o.plannedRR != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          {o.plannedEntry != null && <span>Entry {o.plannedEntry}</span>}
          {o.plannedStopLoss != null && <span>Stop {o.plannedStopLoss}</span>}
          {o.plannedTarget != null && <span>Target {o.plannedTarget}</span>}
          {o.plannedRR != null && <span>R:R {o.plannedRR}</span>}
        </div>
      )}

      {/* Resolved detail */}
      {o.status === "MISSED" && o.missReason && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{MISS_REASON_LABELS[o.missReason]}</span>
            {o.missedOutcome && (
              <span className={cn("text-xs font-medium", OUTCOME_TONE[o.missedOutcome])}>
                {MISSED_OUTCOME_LABELS[o.missedOutcome]}
                {o.missedRealizedR != null && ` · ${fmtR(o.missedRealizedR)}`}
              </span>
            )}
          </div>
          {o.missNote && <p className="mt-1 text-xs text-muted-foreground">{o.missNote}</p>}
          {o.originTrade && (
            <p className="mt-1 text-xs text-muted-foreground">
              Originated from cancelled idea Trade #{o.originTrade.tradeNumber ?? "—"} (still a cancelled trade).
            </p>
          )}
        </div>
      )}

      {/* Chart screenshots of the missed setup */}
      {o.status === "MISSED" && (
        <ImageAttachments ownerType="OPPORTUNITY" ownerId={o.id} label="Images" max={6} disabled={!editable} />
      )}

      {o.status === "EXECUTED" && o.executedTrade && (
        <div className="flex items-center justify-between rounded-xl border border-success/25 bg-success/5 p-3 text-sm">
          <span className="text-muted-foreground">
            Executed as{" "}
            {isBacktest ? (
              // Simulated trades live in the Session, not the live Journal.
              <span className="font-medium text-foreground">Trade #{o.executedTrade.tradeNumber ?? "—"}</span>
            ) : (
              <Link
                href={`/journal/${dateKey}/trades/${o.executedTrade.id}`}
                className="font-medium text-foreground hover:underline"
              >
                Trade #{o.executedTrade.tradeNumber ?? "—"}
              </Link>
            )}{" "}
            · <span className="tabular-nums">{fmtR(o.executedTrade.actualRR)}</span>
          </span>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              disabled={pending}
              onClick={() => run(() => unlinkExecutedTrade(dateKey, o.id), "Unlinked.")}
            >
              <Unlink className="size-3.5" />
              Unlink
            </Button>
          )}
        </div>
      )}

      {/* PENDING actions */}
      {isPending && editable && panel === "none" && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {linkableTrades.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPanel("link")}>
              <Link2 className="size-3.5" />
              Link executed
            </Button>
          )}
          {/* Backtesting: the SAME add-trade dialog the Session uses, carrying the
              opportunity — the server creates the trade in this run and date
              and links it only within the same run. Live keeps its Journal page. */}
          {isBacktest && (
            <AddTradeDialog
              dateKey={dateKey}
              accounts={[]}
              strategies={strategies}
              opportunityId={o.id}
              initialAssetSymbol={o.assetSymbol}
              initialStrategyId={o.strategyId}
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <CandlestickChart className="size-3.5" />
                  Log trade
                </Button>
              }
            />
          )}
          {!isBacktest && onTake && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onTake(o)}>
              <CandlestickChart className="size-3.5" />
              Take
            </Button>
          )}
          {!isBacktest && !onTake && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              nativeButton={false}
              render={<Link href={`/journal/${dateKey}/trades/new?opportunityId=${o.id}`} />}
            >
              <CandlestickChart className="size-3.5" />
              Log trade
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPanel("miss")}>
            <XCircle className="size-3.5" />
            Missed
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            disabled={pending}
            onClick={() => run(() => invalidateOpportunity(dateKey, o.id), "Marked invalidated.")}
          >
            <Ban className="size-3.5" />
            Invalidated
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            disabled={pending}
            onClick={() => run(() => expireOpportunity(dateKey, o.id), "Marked expired.")}
          >
            <Clock className="size-3.5" />
            Expired
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete opportunity"
            className="ml-auto text-muted-foreground hover:text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}

      {isPending && editable && panel === "link" && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              items={linkableTrades.map((t) => ({
                value: t.id,
                label: `#${t.tradeNumber ?? "—"} ${t.assetSymbol}`,
              }))}
              value={linkTradeId}
              onValueChange={(v) => setLinkTradeId(v ?? "")}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Pick the executed trade" />
              </SelectTrigger>
              <SelectContent>
                {linkableTrades.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    #{t.tradeNumber ?? "—"} · {t.assetSymbol} {t.direction === "LONG" ? "Long" : "Short"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" onClick={doLink} disabled={pending}>
                Link
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPanel("none")} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {isPending && editable && panel === "miss" && (
        <MissOutcomeForm
          dateKey={dateKey}
          opportunityId={o.id}
          onDone={() => setPanel("none")}
          onCancel={() => setPanel("none")}
        />
      )}

      {/* Non-pending resolved rows still allow delete */}
      {!isPending && editable && (
        <div className="flex justify-end border-t border-border pt-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete opportunity"
            className="text-muted-foreground hover:text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this opportunity?"
        description="This removes the opportunity record. Any linked executed trade is kept and simply unlinked."
        confirmLabel="Delete"
        variant="destructive"
        isPending={pending}
        onConfirm={() =>
          run(async () => {
            const res = await deleteOpportunity(dateKey, o.id);
            if (res.success) setConfirmDelete(false);
            return res;
          }, "Opportunity deleted.")
        }
      />
    </div>
  );
}
