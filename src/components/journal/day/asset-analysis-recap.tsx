import { LineChart } from "lucide-react";

import { cn } from "@/lib/utils";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { NoteBlock } from "@/components/journal/workspace/workspace-ui";
import { ImageAttachments } from "@/components/media/image-attachments";
import { EmptyState } from "@/components/shared/empty-state";
import type { DailyAssetAnalysisDTO } from "@/types/today";

const EVIDENCE_TONE: Record<"BULLISH" | "BEARISH", string> = {
  BULLISH: "border-blue-500/18 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  BEARISH: "border-orange-500/18 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

const BIAS_TONE: Record<string, string> = {
  BULLISH: "text-success",
  BEARISH: "text-danger",
  NEUTRAL: "text-muted-foreground",
};
const FINAL_BIAS_BADGE: Record<string, string> = {
  LONG: "bg-success/15 text-success",
  SHORT: "bg-destructive/15 text-destructive",
  NEUTRAL: "bg-secondary text-secondary-foreground",
};

function BiasLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", value ? BIAS_TONE[value] : "text-muted-foreground/40 italic")}>
        {value ? value.charAt(0) + value.slice(1).toLowerCase() : "—"}
      </span>
    </div>
  );
}

/**
 * Journal rebuild (Stage 9 §5) — every DailyAssetAnalysis for the day, as
 * read-only historical evidence. Shows exactly what was stored; never
 * recomputes or reconciles the independent htf/session/fundamental/final
 * biases (they were never meant to agree).
 */
export function AssetAnalysisRecap({ analyses }: { analyses: DailyAssetAnalysisDTO[] }) {
  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <LineChart className="size-4 text-muted-foreground" />
        Asset Analysis
      </h3>

      {analyses.length === 0 ? (
        <EmptyState icon={LineChart} title="No assets analyzed" description="No asset analysis was recorded for this day." />
      ) : (
        <div className="space-y-3">
          {analyses.map((analysis) => {
            const symbolStyle = TAG_STYLES[colorForName(analysis.assetSymbol)];
            return (
              <div key={analysis.id} className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs", symbolStyle.chip)}>
                    <span className={cn("size-1.5 shrink-0 rounded-full", symbolStyle.dot)} />
                    {analysis.assetSymbol}
                  </span>
                  {analysis.finalBias && (
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", FINAL_BIAS_BADGE[analysis.finalBias])}>
                      {analysis.finalBias}
                    </span>
                  )}
                </div>

                <NoteBlock label="Key areas of interest" text={tiptapToPlainText(analysis.keyLevels, 400)} />
                <NoteBlock label="Market structure" text={tiptapToPlainText(analysis.marketStructure, 400)} />

                <div className="grid grid-cols-3 gap-3">
                  <BiasLine label="HTF bias" value={analysis.htfBias} />
                  <BiasLine label="Session bias" value={analysis.sessionBias} />
                  <BiasLine label="Fundamental bias" value={analysis.fundamentalBias} />
                </div>
                <NoteBlock label="Asset-specific fundamentals" text={tiptapToPlainText(analysis.fundamentalNotes, 400)} />

                {(analysis.evidenceSummary.bullishCount > 0 || analysis.evidenceSummary.bearishCount > 0) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Directional evidence</span>
                      <span className="font-medium">
                        {analysis.evidenceSummary.bullishCount} Bullish · {analysis.evidenceSummary.bearishCount} Bearish
                        {analysis.evidenceSummary.suggestedBias && ` — suggested ${analysis.evidenceSummary.suggestedBias}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.evidenceItems.map((item) => (
                        <span
                          key={item.id}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[11px]",
                            EVIDENCE_TONE[item.direction],
                            !item.checked && "opacity-40 line-through",
                          )}
                        >
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <NoteBlock label="Notes" text={tiptapToPlainText(analysis.notes, 400)} />

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Chart screenshots</div>
                  <ImageAttachments ownerType="DAILY_ASSET_ANALYSIS" ownerId={analysis.id} category="CHART" disabled />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
