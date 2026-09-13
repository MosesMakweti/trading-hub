"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { formatDateKeyLong } from "@/lib/date";
import { getReplayDailyMarketPlan } from "@/actions/replay.actions";
import type { DailyAssetAnalysisDTO } from "@/types/today";

const BIAS_STYLES: Record<string, string> = {
  BULLISH: "text-success",
  BEARISH: "text-danger",
  NEUTRAL: "text-muted-foreground",
  LONG: "text-success",
  SHORT: "text-danger",
};

async function noopSave() {
  return { success: true };
}

function hasContent(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const content = (json as { content?: unknown[] }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  // A single empty paragraph is Tiptap's "nothing typed yet" shape.
  return !(content.length === 1 && !("content" in (content[0] as object)));
}

/**
 * Stage 18 §6 — read-only historical Daily Market Plan reference, keyed by
 * the Replay Clock's OWN current date (never "today" — the caller always
 * passes the historical `dateKey` the clock is currently on). Reuses the
 * exact same `DailyAssetAnalysis` data "Today" reads (`getReplayDailyMarketPlan`
 * → `listDailyAssetAnalyses`); nothing here can write back to it — every
 * field is rendered through a non-editable `RichTextEditor` or plain text.
 */
export function ReplayDailyMarketPlanPanel({ dateKey, assetSymbol }: { dateKey: string; assetSymbol: string }) {
  // Keyed by dateKey (never reset to null on key change) so this never
  // needs a synchronous "clear while loading" setState in the effect below
  // — a day not yet in the map just renders as "Loading…" until it arrives.
  const [analysesByDate, setAnalysesByDate] = useState<Record<string, DailyAssetAnalysisDTO[]>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || analysesByDate[dateKey]) return; // only fetch once expanded, and only once per day
    let cancelled = false;
    void getReplayDailyMarketPlan(dateKey).then((rows) => {
      if (!cancelled) setAnalysesByDate((prev) => ({ ...prev, [dateKey]: rows }));
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey, expanded, analysesByDate]);

  const analyses = analysesByDate[dateKey] ?? null;
  const analysis = analyses?.find((a) => a.assetSymbol === assetSymbol) ?? null;

  return (
    <div className="glass space-y-2 rounded-2xl p-3">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
          <CalendarDays className="size-3.5" />
          Daily Market Plan — {formatDateKeyLong(dateKey)}
        </span>
        {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <>
          {analyses == null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : !analysis ? (
            <p className="text-xs text-muted-foreground/70 italic">No {assetSymbol} plan was recorded for this day.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <BiasField label="HTF Bias" value={analysis.htfBias} />
                <BiasField label="Session Bias" value={analysis.sessionBias} />
                <BiasField label="Fundamental Bias" value={analysis.fundamentalBias} />
              </div>
              {analysis.finalBias && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Final Bias: </span>
                  <span className={cn("font-semibold", BIAS_STYLES[analysis.finalBias])}>{analysis.finalBias}</span>
                </div>
              )}

              {analysis.evidenceItems.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Directional Evidence</span>
                  <ul className="space-y-0.5">
                    {analysis.evidenceItems.map((item) => (
                      <li key={item.id} className="flex items-center gap-1.5 text-xs">
                        <span className={cn("size-1.5 rounded-full", item.checked ? "bg-primary" : "bg-muted-foreground/30")} />
                        <span className={cn(item.checked ? "" : "text-muted-foreground/60 line-through")}>{item.label}</span>
                        <span className={cn("text-[10px]", BIAS_STYLES[item.direction])}>{item.direction}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {hasContent(analysis.keyLevels) && (
                <ReadOnlyRichTextField label="Areas of Interest / Key Levels" content={analysis.keyLevels} />
              )}
              {hasContent(analysis.marketStructure) && <ReadOnlyRichTextField label="Market Structure" content={analysis.marketStructure} />}
              {hasContent(analysis.fundamentalNotes) && <ReadOnlyRichTextField label="Fundamentals / News" content={analysis.fundamentalNotes} />}
              {hasContent(analysis.notes) && <ReadOnlyRichTextField label="Notes" content={analysis.notes} />}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/60 italic">
            Your original analysis — reference only, read-only here. Replay exists partly to discover it may have been wrong.
          </p>
        </>
      )}
    </div>
  );
}

function BiasField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground/70">{label}</div>
      <div className={cn("font-medium", value ? BIAS_STYLES[value] : "text-muted-foreground/50")}>{value ?? "—"}</div>
    </div>
  );
}

function ReadOnlyRichTextField({ label, content }: { label: string; content: unknown }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <div className="rounded-md border border-border/50 bg-background/40 p-2">
        <RichTextEditor initialContent={content} onSave={noopSave} editable={false} className="text-xs" />
      </div>
    </div>
  );
}
