"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ImageOff, Maximize, Minimize, PanelTopOpen, Radio, SearchX, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  buildGalleryComparisons,
  filterComparisons,
  galleryFilterOptions,
  NO_STRATEGY,
  type GalleryComparison,
  type GalleryFilters,
  type GalleryImage,
  type GalleryOutcome,
} from "@/domain/trade-audit/gallery";
import { EXECUTION_ISSUE_LABEL, INVALID_REASON_LABEL, MISS_REASON_LABEL, VERDICT_LABEL } from "@/domain/trade-audit/labels";
import type { AuditDayDTO, MissReasonValue } from "@/types/trade-audit";
import { dayLabel, fmtPnl, fmtPrice, fmtR, toneOf } from "@/components/edge/audit/audit-context";
import { ProvenanceBadge } from "@/components/edge/audit/audit-evidence-gallery";
import { DirectionBadge } from "@/components/edge/audit/audit-trade-cells";
import { ZoomableImage } from "@/components/edge/audit/zoomable-image";

const OUTCOME_LABEL: Record<GalleryOutcome, string> = {
  WIN: "Win",
  LOSS: "Loss",
  BREAKEVEN: "Breakeven",
  PENDING: "Open / unsettled",
  CANCELLED: "Never triggered",
  NOT_TAKEN: "No trade taken",
};

const OUTCOME_CLASS: Record<GalleryOutcome, string> = {
  WIN: "bg-success/15 text-success",
  LOSS: "bg-danger/15 text-danger",
  BREAKEVEN: "bg-muted text-muted-foreground",
  PENDING: "bg-warning/15 text-warning-foreground dark:text-warning",
  CANCELLED: "bg-muted text-muted-foreground",
  NOT_TAKEN: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const TONE_CLASS = { good: "bg-success/15 text-success", bad: "bg-danger/15 text-danger", neutral: "bg-muted text-muted-foreground" } as const;

export interface GalleryState {
  comparisonId: string | null;
  filters: GalleryFilters;
}

function isTyping(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement);
}

/**
 * Gallery View — the second view of the Weekly Trade Audit. Built entirely
 * from the same `days` the Audit View renders (domain/trade-audit/gallery),
 * so a change saved in either view shows in both after the shared refresh.
 * Position + filters are owned by the parent (and mirrored to the URL), so
 * switching views or going full screen never loses the current comparison.
 */
export function AuditGallery({
  days,
  state,
  onStateChange,
  onOpenInAudit,
}: {
  days: AuditDayDTO[];
  state: GalleryState;
  onStateChange: (next: GalleryState) => void;
  onOpenInAudit: (dateKey: string) => void;
}) {
  const all = useMemo(() => buildGalleryComparisons(days), [days]);
  const options = useMemo(() => galleryFilterOptions(all), [all]);
  const list = useMemo(() => filterComparisons(all, state.filters), [all, state.filters]);
  const foundIndex = list.findIndex((c) => c.id === state.comparisonId);
  const index = foundIndex >= 0 ? foundIndex : 0;
  const current: GalleryComparison | undefined = list[index];

  const [fullscreen, setFullscreen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [inspect, setInspect] = useState<{ side: "actual" | "expected"; index: number } | null>(null);
  const [imageIndex, setImageIndex] = useState<{ id: string; actual: number; expected: number }>({ id: "", actual: 0, expected: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  // Per-comparison image positions reset when the comparison changes.
  const imgPos = current && imageIndex.id === current.id ? imageIndex : { id: current?.id ?? "", actual: 0, expected: 0 };
  const setImgPos = (side: "actual" | "expected", n: number) => setImageIndex({ ...imgPos, id: current?.id ?? "", [side]: n });

  const goTo = useCallback((i: number) => {
    const target = list[Math.max(0, Math.min(list.length - 1, i))];
    if (target) onStateChange({ ...state, comparisonId: target.id });
  }, [list, onStateChange, state]);

  const dayKeys = options.days;
  const goDay = useCallback(
    (delta: number) => {
      if (!current) return;
      const keys = [...new Set(list.map((c) => c.dateKey))];
      const at = keys.indexOf(current.dateKey);
      const nextKey = keys[Math.max(0, Math.min(keys.length - 1, at + delta))];
      const target = list.find((c) => c.dateKey === nextKey);
      if (target) onStateChange({ ...state, comparisonId: target.id });
    },
    [current, list, onStateChange, state],
  );

  const setFilter = (patch: Partial<GalleryFilters>) => onStateChange({ comparisonId: state.comparisonId, filters: { ...state.filters, ...patch } });

  // Full screen: a CSS overlay always; the browser Fullscreen API when allowed.
  async function toggleFullscreen() {
    const next = !fullscreen;
    setFullscreen(next);
    try {
      if (next && rootRef.current && !document.fullscreenElement) await rootRef.current.requestFullscreen?.();
      if (!next && document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // Not permitted (iframe/browser policy) — the overlay alone still works.
    }
  }
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keyboard: ←/→ comparison, Shift+←/→ or [ / ] day, F full screen, Esc exits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (inspect || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" && e.shiftKey) goDay(1);
      else if (e.key === "ArrowLeft" && e.shiftKey) goDay(-1);
      else if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
      else if (e.key === "]") goDay(1);
      else if (e.key === "[") goDay(-1);
      else if (e.key === "f" || e.key === "F") void toggleFullscreen();
      else if (e.key === "Escape" && fullscreen) void toggleFullscreen();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggleFullscreen is stable enough for this listener's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goDay, goTo, index, inspect, fullscreen]);

  const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs";
  const filtersActive = Boolean(state.filters.asset || state.filters.strategy || state.filters.outcome || state.filters.day);

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-2 bg-background", fullscreen ? "fixed inset-0 z-50 p-2 sm:p-3" : "rounded-2xl")}
      aria-label="Visual comparison gallery"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous trading day (Shift+←)" onClick={() => goDay(-1)} disabled={!current}>
            <ChevronsLeft />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous comparison (←)" onClick={() => goTo(index - 1)} disabled={index <= 0}>
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center text-sm font-medium tabular-nums" aria-live="polite">
            {list.length === 0 ? "0 / 0" : `${index + 1} / ${list.length}`}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Next comparison (→)" onClick={() => goTo(index + 1)} disabled={index >= list.length - 1}>
            <ChevronRight />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Next trading day (Shift+→)" onClick={() => goDay(1)} disabled={!current}>
            <ChevronsRight />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Trading day">
          {dayKeys.map((k) => {
            const l = dayLabel(k);
            const active = current?.dateKey === k;
            const count = list.filter((c) => c.dateKey === k).length;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                disabled={count === 0}
                onClick={() => {
                  const target = list.find((c) => c.dateKey === k);
                  if (target) onStateChange({ ...state, comparisonId: target.id });
                }}
                className={cn("rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-40", active ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {l.short} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select aria-label="Filter by instrument" className={selectClass} value={state.filters.asset ?? ""} onChange={(e) => setFilter({ asset: e.target.value || null })}>
            <option value="">All instruments</option>
            {options.assets.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select aria-label="Filter by strategy" className={selectClass} value={state.filters.strategy ?? ""} onChange={(e) => setFilter({ strategy: e.target.value || null })}>
            <option value="">All strategies</option>
            {options.strategies.map((s) => (
              <option key={s} value={s}>
                {s === NO_STRATEGY ? "No strategy" : s}
              </option>
            ))}
          </select>
          <select aria-label="Filter by outcome" className={selectClass} value={state.filters.outcome ?? ""} onChange={(e) => setFilter({ outcome: (e.target.value || null) as GalleryOutcome | null })}>
            <option value="">All outcomes</option>
            {options.outcomes.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
          <select aria-label="Filter by trading day" className={selectClass} value={state.filters.day ?? ""} onChange={(e) => setFilter({ day: e.target.value || null })}>
            <option value="">All days</option>
            {options.days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d).weekday} {dayLabel(d).date}
              </option>
            ))}
          </select>
          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setFilter({ asset: null, strategy: null, outcome: null, day: null })}>
              <X className="size-3.5" /> Clear
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen (Esc)" : "Full screen (F)"}>
            {fullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
            <span className="hidden sm:inline">{fullscreen ? "Exit full screen" : "Full screen"}</span>
          </Button>
        </div>
      </div>

      {!current ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          <SearchX className="size-6" />
          {all.length === 0 ? "No trades or missed setups this week to compare." : "No comparisons match these filters."}
          {filtersActive && (
            <Button type="button" variant="outline" size="sm" onClick={() => setFilter({ asset: null, strategy: null, outcome: null, day: null })}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Stage: two equal columns, images dominate */}
          {/* Full screen: grow into the fixed overlay. Inline: an explicit height
              (flex-1 would collapse to content height in a column flex box). */}
          <div className={cn("grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-2", fullscreen ? "flex-1" : "lg:h-[calc(100dvh-22rem)] lg:min-h-[30rem]")}>
            <ComparisonPane
              side="actual"
              comparison={current}
              position={imgPos.actual}
              onPosition={(n) => setImgPos("actual", n)}
              onInspect={(n) => setInspect({ side: "actual", index: n })}
            />
            <ComparisonPane
              side="expected"
              comparison={current}
              position={imgPos.expected}
              onPosition={(n) => setImgPos("expected", n)}
              onInspect={(n) => setInspect({ side: "expected", index: n })}
            />
          </div>

          {/* Expandable details — deliberately short */}
          <div className="rounded-xl bg-muted/30">
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
              <span className="font-medium">
                {dayLabel(current.dateKey).weekday} {dayLabel(current.dateKey).date}
              </span>
              <span className="text-muted-foreground">
                {current.kind === "TRADE" ? "Trade taken" : current.kind === "MISSED_LIVE" ? "Missed setup · recorded during session" : "Missed setup · recorded in review"}
              </span>
              <button type="button" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
                Details <ChevronDown className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")} />
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => onOpenInAudit(current.dateKey)}>
                <PanelTopOpen className="size-3.5" /> Open in Audit View
              </button>
            </div>
            {detailsOpen && <ComparisonDetails comparison={current} />}
          </div>
        </>
      )}

      <Dialog open={inspect != null} onOpenChange={(open) => !open && setInspect(null)}>
        {inspect && current && (
          <ImageInspector
            images={inspect.side === "actual" ? (current.actual?.images ?? []) : current.expectedImages}
            title={`${inspect.side === "actual" ? "Actual" : "Expected"} · ${current.assetSymbol}`}
            index={inspect.index}
            onIndex={(n) => {
              setInspect({ ...inspect, index: n });
              setImgPos(inspect.side, n);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function Fact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", value === "—" && "text-muted-foreground/60", className)}>{value}</span>
    </span>
  );
}

function ComparisonPane({
  side,
  comparison: c,
  position,
  onPosition,
  onInspect,
}: {
  side: "actual" | "expected";
  comparison: GalleryComparison;
  position: number;
  onPosition: (n: number) => void;
  onInspect: (n: number) => void;
}) {
  const images = side === "actual" ? (c.actual?.images ?? []) : c.expectedImages;
  const i = Math.min(position, Math.max(0, images.length - 1));
  const image: GalleryImage | undefined = images[i];
  const accent = side === "actual" ? "text-sky-700 dark:text-sky-300" : "text-amber-700 dark:text-amber-300";
  const bar = side === "actual" ? "bg-sky-500/70" : "bg-amber-500/70";

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-muted/20" aria-label={side === "actual" ? "Actual" : "Expected"}>
      <div className={cn("h-0.5 w-full", bar)} />
      {/* Compact facts */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className={cn("text-[11px] font-semibold tracking-wider uppercase", accent)}>{side === "actual" ? "Actual" : "Expected"}</span>
        {side === "actual" ? <ActualFacts c={c} /> : <ExpectedFacts c={c} />}
      </div>

      {/* Image area */}
      <div className="relative min-h-[16rem] flex-1 sm:min-h-[22rem] lg:min-h-0">
        {image ? (
          <ZoomableImage key={image.attachmentId} src={image.url} alt={image.caption ?? image.fileName} markers={image.annotation} onExpand={() => onInspect(i)} />
        ) : (
          <EmptyImage side={side} c={c} />
        )}
        {images.length > 1 && (
          <>
            <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 left-2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 hover:text-white" aria-label="Previous screenshot" onClick={() => onPosition((i - 1 + images.length) % images.length)}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 hover:text-white" aria-label="Next screenshot" onClick={() => onPosition((i + 1) % images.length)}>
              <ChevronRight />
            </Button>
          </>
        )}
      </div>

      {/* Image caption strip */}
      <div className="flex min-h-8 flex-wrap items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
        {image ? (
          <>
            <span className="font-medium text-foreground/80">{image.sourceLabel}</span>
            <ProvenanceBadge provenance={image.provenance} annotated={(image.annotation?.length ?? 0) > 0} />
            {images.length > 1 && (
              <span className="ml-auto flex items-center gap-1" aria-label={`Screenshot ${i + 1} of ${images.length}`}>
                {images.map((img, n) => (
                  <button key={img.attachmentId} type="button" aria-label={`Show screenshot ${n + 1}`} onClick={() => onPosition(n)} className={cn("size-2 rounded-full", n === i ? "bg-foreground" : "bg-muted-foreground/40")} />
                ))}
              </span>
            )}
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </section>
  );
}

function ActualFacts({ c }: { c: GalleryComparison }) {
  if (!c.actual) {
    return <span className="text-sm text-muted-foreground">No trade taken</span>;
  }
  const t = c.actual.trade;
  const verdict = c.actual.verdict;
  return (
    <>
      <span className="font-semibold">{t.assetSymbol}</span>
      <DirectionBadge direction={t.direction} />
      {t.strategyName && <span className="text-xs text-muted-foreground">{t.strategyName}</span>}
      <Fact label="In" value={fmtPrice(t.actualEntry)} />
      <Fact label="Out" value={fmtPrice(t.actualExit)} />
      <span className={cn("font-mono text-xs font-semibold tabular-nums", toneOf(t.realizedR))}>{fmtR(t.realizedR)}</span>
      {t.pnl != null && <span className={cn("font-mono text-xs tabular-nums", toneOf(t.pnl))}>{fmtPnl(t.pnl)}</span>}
      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", OUTCOME_CLASS[c.outcome])}>{OUTCOME_LABEL[c.outcome]}</span>
      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", verdict === "VALID" ? TONE_CLASS.good : verdict === "INVALID" ? TONE_CLASS.bad : TONE_CLASS.neutral)}>
        {verdict ? VERDICT_LABEL[verdict].split(" — ")[0] : "Not judged"}
      </span>
    </>
  );
}

function ExpectedFacts({ c }: { c: GalleryComparison }) {
  const e = c.expected;
  return (
    <>
      {e.assetSymbol && <span className="font-semibold">{e.assetSymbol}</span>}
      {e.direction && <DirectionBadge direction={e.direction} />}
      {e.strategyName && <span className="text-xs text-muted-foreground">{e.strategyName}</span>}
      {e.source !== "NONE" && (
        <>
          <Fact label="Entry" value={fmtPrice(e.entry)} />
          <Fact label="SL" value={fmtPrice(e.stopLoss)} />
          <Fact label="TP" value={fmtPrice(e.target)} />
        </>
      )}
      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", TONE_CLASS[e.qualification.tone])}>{e.qualification.label}</span>
      {e.source === "TRADE_PLAN" && <span className="text-[11px] text-muted-foreground">prices from the trade&apos;s own plan</span>}
      {e.source === "LIVE_SETUP" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Radio className="size-3" /> recorded during session
        </span>
      )}
    </>
  );
}

function EmptyImage({ side, c }: { side: "actual" | "expected"; c: GalleryComparison }) {
  let title: string;
  let hint: string;
  if (side === "actual") {
    if (!c.actual) {
      title = "No trade taken";
      hint = "This setup was missed — there is no actual trade to show.";
    } else {
      title = "No screenshot on this trade";
      hint = "Add an after-trade screenshot to the trade record to compare it here.";
    }
  } else if (c.expected.source === "NONE") {
    title = c.actual?.verdict === "INVALID" ? "No valid setup recorded instead" : "No expected setup recorded";
    hint =
      c.actual?.verdict === "INVALID"
        ? "In Audit View, record the setup you should have taken and pair it with this trade."
        : c.actual?.verdict
          ? "Upload a review screenshot of the expected setup in Audit View."
          : "Judge this trade in Audit View first.";
  } else {
    title = "No screenshot of the expected setup";
    hint = c.kind === "TRADE" ? "Upload a review screenshot for this trade in Audit View." : "Add chart evidence to this missed setup in Audit View.";
  }
  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-1.5 bg-neutral-950/5 p-6 text-center dark:bg-neutral-950/60">
      <ImageOff className="size-7 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ComparisonDetails({ comparison: c }: { comparison: GalleryComparison }) {
  const a = c.actual;
  const e = c.expected;
  const rows: [string, string | null][] = [
    ["Strategy criteria", e.criteria.length > 0 ? e.criteria.join(" · ") : null],
    ["Why the setup was valid", e.validityReason],
    ["Why it was missed", [e.missReason ? MISS_REASON_LABEL[e.missReason as MissReasonValue] ?? e.missReason : null, e.missNote].filter(Boolean).join(" — ") || null],
    ["Why it shouldn't have been taken", c.notes.invalidReasons.length > 0 ? c.notes.invalidReasons.map((r) => INVALID_REASON_LABEL[r as keyof typeof INVALID_REASON_LABEL] ?? r).join(" · ") : null],
    ["Recorded at the time", c.notes.systemFlags.length > 0 ? c.notes.systemFlags.join(" · ") : null],
    ["Execution", a?.assessment?.executionIssues.length ? a.assessment.executionIssues.map((x) => EXECUTION_ISSUE_LABEL[x]).join(" · ") : null],
    ["Mistake", c.notes.mistake],
    ["Improvement", c.notes.improvement],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <dl className="grid gap-x-6 gap-y-1.5 px-3 pb-3 text-xs sm:grid-cols-2">
      {shown.length === 0 && <p className="text-muted-foreground">Nothing else recorded for this comparison yet.</p>}
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Single-image full-screen inspector; Esc closes back to the same comparison. */
function ImageInspector({ images, title, index, onIndex }: { images: GalleryImage[]; title: string; index: number; onIndex: (n: number) => void }) {
  const image = images[index];
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (images.length < 2) return;
      if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, index, onIndex]);
  if (!image) return null;
  return (
    <DialogContent className="flex h-[96dvh] w-[98vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 pr-12">
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <span className="text-xs text-muted-foreground">{image.sourceLabel}</span>
        <ProvenanceBadge provenance={image.provenance} annotated={(image.annotation?.length ?? 0) > 0} />
        {images.length > 1 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {index + 1} / {images.length}
          </span>
        )}
        <DialogDescription className="sr-only">Zoom with the wheel or buttons, drag to pan, arrows to move between screenshots.</DialogDescription>
      </div>
      <div className="relative min-h-0 flex-1">
        <ZoomableImage key={image.attachmentId} src={image.url} alt={image.caption ?? image.fileName} markers={image.annotation} />
        {images.length > 1 && (
          <>
            <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 left-3 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 hover:text-white" aria-label="Previous screenshot" onClick={() => onIndex((index - 1 + images.length) % images.length)}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-3 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 hover:text-white" aria-label="Next screenshot" onClick={() => onIndex((index + 1) % images.length)}>
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </DialogContent>
  );
}
