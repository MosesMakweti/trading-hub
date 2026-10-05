"use client";

import Link from "next/link";
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Pause,
  Play,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateKeyShort } from "@/lib/date";
import { tradeTimeDisplay } from "@/domain/trades/display-facts";
import { formatRR, formatPerformancePnl } from "@/components/journal/workspace/workspace-ui";
import type { AlbumImageDTO, AlbumTradeDTO } from "@/types/trades-album";

export interface AlbumSlide {
  trade: AlbumTradeDTO;
  /** 0-based position of this trade within the current filtered+sorted list. */
  tradeIndex: number;
  image: AlbumImageDTO | null;
  /** 0-based position of this image within the trade's own screenshots. */
  imageIndex: number;
  /** How many screenshots this trade has (0 for the no-screenshot placeholder). */
  imageCount: number;
}

function tradeResult(actualRR: number | null): { label: string; tone: "success" | "danger" | "muted" } {
  if (actualRR == null) return { label: "Open", tone: "muted" };
  if (actualRR > 0) return { label: "Win", tone: "success" };
  if (actualRR < 0) return { label: "Loss", tone: "danger" };
  return { label: "Breakeven", tone: "muted" };
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function AlbumStage({
  slide,
  totalSlides,
  totalTrades,
  isPlaying,
  onPrev,
  onNext,
  onTogglePlay,
}: {
  slide: AlbumSlide;
  totalSlides: number;
  totalTrades: number;
  isPlaying: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
}) {
  const { trade, image } = slide;
  const workspaceHref = `/journal/${trade.dateKey}/trades/${trade.id}`;
  const result = tradeResult(trade.actualRR);
  const rrTone =
    trade.actualRR == null ? "text-muted-foreground" : trade.actualRR >= 0 ? "text-success" : "text-danger";
  const pnlTone =
    trade.performancePnlNet == null ? "text-muted-foreground" : trade.performancePnlNet >= 0 ? "text-success" : "text-danger";

  return (
    <div className="glass overflow-hidden rounded-2xl">
      {/* Stage — the screenshot, centered and as large as the frame allows. */}
      <div className="relative flex aspect-video items-center justify-center bg-background/60 sm:h-[60vh] sm:aspect-auto">
        {slide.imageCount > 0 && (
          <span className="absolute top-3 left-3 z-10 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-border">
            {image?.phaseLabel}
            {slide.imageCount > 1 && (
              <span className="ml-1 text-muted-foreground tabular-nums">
                {slide.imageIndex + 1}/{slide.imageCount}
              </span>
            )}
          </span>
        )}

        {image ? (
          <Link href={workspaceHref} className="group flex size-full items-center justify-center" aria-label="Open full trade review">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={`${trade.assetSymbol} ${trade.direction === "LONG" ? "long" : "short"} — ${image.phaseLabel} screenshot`}
              className="max-h-full max-w-full object-contain transition-opacity group-hover:opacity-90"
            />
          </Link>
        ) : (
          <Link
            href={workspaceHref}
            className="flex flex-col items-center gap-2 text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            <ImageOff className="size-8" />
            <span className="text-sm">No screenshot attached to this trade</span>
          </Link>
        )}

        {totalSlides > 1 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous"
              onClick={onPrev}
              className="absolute top-1/2 left-3 z-10 size-10 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next"
              onClick={onNext}
              className="absolute top-1/2 right-3 z-10 size-10 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>

      {/* Minimal trade context — below the image, never over it. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border px-4 py-3">
        <Stat label="Asset">{trade.assetSymbol}</Stat>
        <Stat label="Direction">
          <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
            {trade.direction === "LONG" ? "Long" : "Short"}
          </Badge>
        </Stat>
        <Stat label="P&L">
          <span className={cn("tabular-nums", pnlTone)}>{formatPerformancePnl(trade.performancePnlNet)}</span>
        </Stat>
        <Stat label="R-Multiple">
          <span className={cn("tabular-nums", rrTone)}>
            {trade.actualRR == null ? "—" : formatRR(trade.actualRR)}
          </span>
        </Stat>
        <Stat label="Result">
          <Badge variant={result.tone === "muted" ? "secondary" : result.tone}>{result.label}</Badge>
        </Stat>
        <Stat label="Strategy">{trade.strategyName ?? "—"}</Stat>
        <Stat label="Adherence">
          {trade.adherencePercent != null ? `${Math.round(trade.adherencePercent)}%` : "—"}
        </Stat>
        <Stat label="Date / time">
          {formatDateKeyShort(trade.dateKey)} ·{" "}
          {(() => {
            const t = tradeTimeDisplay({
              executionMinutes: trade.executionMinutes,
              hasActualEntry: trade.actualEntry != null,
              hasLegacyResult: trade.actualEntry == null && trade.actualRR != null,
            });
            return t.executed ? t.time : `${t.label} ${t.time}`;
          })()}
        </Stat>
      </div>

      {/* Controls — progress, autoplay, and the way into the full review. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Previous trade" onClick={onPrev}>
            <ChevronLeft />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Trade {slide.tradeIndex + 1} / {totalTrades}
          </span>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Next trade" onClick={onNext}>
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={isPlaying ? "Pause slideshow" : "Play slideshow"}
            onClick={onTogglePlay}
            className="ml-1"
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
        </div>

        <Button type="button" variant="default" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={workspaceHref} />}>
          <BookOpenCheck className="size-4" />
          Study This Trade
        </Button>
      </div>
    </div>
  );
}
