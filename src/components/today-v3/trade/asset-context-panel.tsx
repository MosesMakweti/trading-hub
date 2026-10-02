"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { loadMediaAction } from "@/actions/media.actions";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";

const BIAS_TONE: Record<string, string> = {
  LONG: "text-success",
  SHORT: "text-danger",
  BULLISH: "text-success",
  BEARISH: "text-danger",
  NEUTRAL: "text-muted-foreground",
};

function text(doc: unknown, max = 220) {
  const t = tiptapToPlainText(doc, max).trim();
  return t === "" ? null : t;
}

/**
 * Today V3 — REFERENCE, don't retype. Today's analysis for this trade's
 * asset (and the day's intent/stay-out rules), read live from the same
 * DailyAssetAnalysis/TradingDay rows the Plan phase edits. Nothing here is
 * copied into trade fields; the only frozen copy is the existing
 * dailyBiasSnapshot (taken by the canonical trade services).
 */
export function AssetContextPanel({
  analysis,
  plan,
  defaultOpen = false,
  className,
}: {
  analysis: DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [charts, setCharts] = useState<{ id: string; url: string; label: string }[] | null>(null);

  useEffect(() => {
    if (!open || !analysis || charts != null) return;
    let active = true;
    void loadMediaAction("DAILY_ASSET_ANALYSIS", analysis.id).then((r) => {
      if (!active) return;
      setCharts(
        r.items
          .filter((i) => i.category === "CHART")
          .map((i) => ({ id: i.id, url: i.url, label: i.timeframe ? `${i.timeframe}` : i.fileName })),
      );
    });
    return () => {
      active = false;
    };
  }, [open, analysis, charts]);

  const lookingFor = text(plan.lookingFor);
  const stayOut = text(plan.stayOutConditions);
  const e = analysis?.evidenceSummary;

  const rows: [string, string | null][] = analysis
    ? [
        ["Structure", text(analysis.marketStructure)],
        ["Key areas", text(analysis.keyLevels)],
        ["Fundamentals", text(analysis.fundamentalNotes)],
        ["Notes", text(analysis.notes)],
      ]
    : [];

  return (
    <section className={cn("rounded-xl border border-border bg-background/40", className)} aria-label="Today's context for this asset">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs"
      >
        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="font-medium">Today&apos;s plan for {analysis?.assetSymbol ?? "this asset"}</span>
        {analysis ? (
          <>
            <span className="text-muted-foreground">
              Final <span className={cn("font-semibold", BIAS_TONE[analysis.finalBias ?? "NEUTRAL"])}>{analysis.finalBias ?? "—"}</span>
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              HTF {analysis.htfBias ?? "—"} · Session {analysis.sessionBias ?? "—"} · Fund. {analysis.fundamentalBias ?? "—"}
            </span>
            {e && (e.bullishCount > 0 || e.bearishCount > 0) && (
              <span className="font-mono text-muted-foreground tabular-nums">
                Evidence ▲{e.bullishCount} ▼{e.bearishCount}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">No analysis for this asset today</span>
        )}
        {stayOut && (
          <span className="ml-auto flex items-center gap-1 text-warning">
            <ShieldAlert className="size-3.5" />
            Stay-out rules set
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-border px-3 py-2.5 text-xs">
          {lookingFor && (
            <p>
              <span className="text-muted-foreground">Looking for today: </span>
              {lookingFor}
            </p>
          )}
          {stayOut && (
            <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5">
              <span className="font-medium text-warning">Stay out if: </span>
              {stayOut}
            </p>
          )}
          {rows.filter(([, v]) => v).length > 0 && (
            <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[88px_minmax(0,1fr)]">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
            </dl>
          )}
          {analysis && analysis.evidenceItems.some((i) => i.checked) && (
            <div className="flex flex-wrap gap-1.5">
              {analysis.evidenceItems
                .filter((i) => i.checked)
                .map((i) => (
                  <span
                    key={i.id}
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      i.direction === "BULLISH" ? "border-success/30 text-success" : "border-danger/30 text-danger",
                    )}
                  >
                    {i.label}
                  </span>
                ))}
            </div>
          )}
          {charts && charts.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {charts.map((c) => (
                <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="shrink-0" title={c.label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={`${analysis?.assetSymbol} chart ${c.label}`} className="h-20 rounded border border-border object-cover" />
                </a>
              ))}
            </div>
          )}
          {!analysis && !lookingFor && !stayOut && (
            <p className="text-muted-foreground">Nothing planned for this asset today — add it in Plan to keep your thesis next to your trades.</p>
          )}
        </div>
      )}
    </section>
  );
}
