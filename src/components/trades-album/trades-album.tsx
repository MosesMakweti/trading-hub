"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Images } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { AlbumFilterBar } from "@/components/trades-album/album-filter-bar";
import { AlbumStage, type AlbumSlide } from "@/components/trades-album/album-stage";
import { EMPTY_TRADE_FILTERS, filterTrades, type TradeFilters } from "@/domain/trades/filter";
import { sortAlbumTrades, type AlbumSort } from "@/domain/trades/album-sort";
import type { AlbumTradeDTO } from "@/types/trades-album";

const AUTOPLAY_INTERVAL_MS = 4500;

export function TradesAlbum({
  trades,
  propFirmAccountOptions = [],
  propFirmOptions = [],
}: {
  trades: AlbumTradeDTO[];
  propFirmAccountOptions?: { id: string; label: string }[];
  propFirmOptions?: { id: string; label: string }[];
}) {
  const [filters, setFilters] = useState<TradeFilters>(EMPTY_TRADE_FILTERS);
  const [sort, setSort] = useState<AlbumSort>("RECENT");
  const [slideIdx, setSlideIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const assets = useMemo(() => [...new Set(trades.map((t) => t.assetSymbol))].sort(), [trades]);
  const strategies = useMemo(
    () => [...new Set(trades.map((t) => t.strategyName).filter((s): s is string => Boolean(s)))].sort(),
    [trades],
  );
  const sessions = useMemo(
    () => [...new Set(trades.map((t) => t.sessionName).filter((s): s is string => Boolean(s)))].sort(),
    [trades],
  );

  const filtered = useMemo(() => filterTrades(trades, filters), [trades, filters]);
  const sorted = useMemo(() => sortAlbumTrades(filtered, sort), [filtered, sort]);

  const slides = useMemo<AlbumSlide[]>(() => {
    const out: AlbumSlide[] = [];
    sorted.forEach((trade, tradeIndex) => {
      if (trade.images.length === 0) {
        out.push({ trade, tradeIndex, image: null, imageIndex: 0, imageCount: 0 });
      } else {
        trade.images.forEach((image, imageIndex) => {
          out.push({ trade, tradeIndex, image, imageIndex, imageCount: trade.images.length });
        });
      }
    });
    return out;
  }, [sorted]);

  // Any change to what's shown resets to the first slide and stops autoplay.
  const resetView = useCallback(() => {
    setSlideIdx(0);
    setIsPlaying(false);
  }, []);

  function handleFilterChange(patch: Partial<TradeFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    resetView();
  }
  function handleSortChange(next: AlbumSort) {
    setSort(next);
    resetView();
  }
  function handleClear() {
    setFilters(EMPTY_TRADE_FILTERS);
    resetView();
  }

  const goPrev = useCallback(() => {
    setSlideIdx((i) => (slides.length === 0 ? 0 : (i - 1 + slides.length) % slides.length));
  }, [slides.length]);
  const goNext = useCallback(() => {
    setSlideIdx((i) => (slides.length === 0 ? 0 : (i + 1) % slides.length));
  }, [slides.length]);

  // Autoplay — advances on an interval while playing; stops cleanly on unmount
  // or whenever the slide set changes underneath it.
  useEffect(() => {
    if (!isPlaying || slides.length < 2) return;
    const id = setInterval(goNext, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, slides.length, goNext]);

  // Keyboard navigation — ignored while typing in a filter control.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goPrev, goNext]);

  const clampedIdx = Math.min(slideIdx, Math.max(slides.length - 1, 0));
  const currentSlide = slides[clampedIdx] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trades Album</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length === trades.length
            ? `Every trade, screenshot-first — ${trades.length} trade${trades.length === 1 ? "" : "s"}.`
            : `${filtered.length} of ${trades.length} trades.`}
        </p>
      </div>

      {trades.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No trades yet"
          description="Log trades from the journal or the Today workspace and they'll show up here for review."
        />
      ) : (
        <>
          <AlbumFilterBar
            filters={filters}
            onChange={handleFilterChange}
            onClear={handleClear}
            sort={sort}
            onSortChange={handleSortChange}
            assets={assets}
            strategies={strategies}
            sessions={sessions}
            propFirmAccountOptions={propFirmAccountOptions}
            propFirmOptions={propFirmOptions}
          />

          {currentSlide ? (
            <AlbumStage
              slide={currentSlide}
              totalSlides={slides.length}
              totalTrades={sorted.length}
              isPlaying={isPlaying}
              onPrev={goPrev}
              onNext={goNext}
              onTogglePlay={() => setIsPlaying((p) => !p)}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No trades match these filters.
            </p>
          )}
        </>
      )}
    </div>
  );
}
