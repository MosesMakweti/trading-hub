import { CircleCheck, ListChecks } from "lucide-react";

import { tiptapToPlainText } from "@/lib/tiptap-text";
import { NoteBlock, WorkspaceField } from "@/components/journal/workspace/workspace-ui";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import type { TodaysPlanDTO } from "@/types/today";

const BIAS_LABEL: Record<string, string> = { BULLISH: "Bullish", BEARISH: "Bearish", NEUTRAL: "Neutral" };

/**
 * Journal rebuild (Stage 9 §4; Stage 11 Daily Market Plan consolidation) —
 * the day-level part of the Daily Market Plan as read-only historical
 * context: Today's Assets, General Session Context, News & Fundamentals, and
 * Risk Boundaries. Same TodaysPlanDTO the live Today workspace edits; this
 * just renders it, nothing is recalculated or reinterpreted.
 *
 * `assetSymbols` is the day's Today's Assets — Stage 11 made DailyAssetAnalysis
 * itself the source of truth for that list, so it's passed in from the day's
 * asset analyses (see AssetAnalysisRecap below it), not from `plan.watchlist`.
 * A legacy day that used the old separate watchlist but recorded no asset
 * analyses still shows that watchlist, clearly labeled, rather than losing it.
 */
export function DailyMarketPlanRecap({
  plan,
  assetSymbols,
}: {
  plan: TodaysPlanDTO;
  assetSymbols: string[];
}) {
  const hasSessions = plan.activeSessions.length > 0;
  const lookingFor = tiptapToPlainText(plan.lookingFor, 500);
  const importantConditions = tiptapToPlainText(plan.importantConditions, 500);
  const stayOutConditions = tiptapToPlainText(plan.stayOutConditions, 500);
  const newsNotes = tiptapToPlainText(plan.newsNotes, 500);
  const fundamentalOutlook = tiptapToPlainText(plan.dailyFundamentalOutlook, 500);
  const legacyKeyLevels = tiptapToPlainText(plan.keyLevels, 500);

  // A legacy day that never got asset analyses still had its watchlist.
  const showLegacyWatchlist = assetSymbols.length === 0 && plan.watchlist.length > 0;

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <ListChecks className="size-4 text-muted-foreground" />
        Daily Market Plan
      </h3>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          {showLegacyWatchlist ? "Watchlist (legacy)" : "Today's assets"}
        </div>
        {assetSymbols.length > 0 || showLegacyWatchlist ? (
          <div className="flex flex-wrap gap-1.5">
            {(assetSymbols.length > 0 ? assetSymbols : plan.watchlist).map((s) => {
              const style = TAG_STYLES[colorForName(s)];
              return (
                <span key={s} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs ${style.chip}`}>
                  {s}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">None recorded.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <WorkspaceField
          label="Risk budget"
          value={plan.riskBudgetPercent != null ? `${plan.riskBudgetPercent}%` : undefined}
        />
        <WorkspaceField
          label="Max trades"
          value={plan.maxTradesPerDay != null ? String(plan.maxTradesPerDay) : undefined}
        />
        <WorkspaceField
          label="News reviewed"
          value={
            plan.newsAcknowledged ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CircleCheck className="size-3.5" /> Yes
              </span>
            ) : (
              "No"
            )
          }
        />
        <WorkspaceField
          label="Sessions"
          value={hasSessions ? plan.activeSessions.join(", ") : undefined}
        />
      </div>

      <NoteBlock label="What I was looking for" text={lookingFor} />
      <NoteBlock label="Important conditions" text={importantConditions} />
      <NoteBlock label="Stay-out conditions" text={stayOutConditions} />
      <NoteBlock label="News notes" text={newsNotes} />
      <NoteBlock label="General macro/fundamental outlook" text={fundamentalOutlook} />

      {/* Legacy-only — the pre-Stage-11 day-level bias/areas-of-interest.
          Never shown for a new-format day (these are simply never written to
          anymore); shown as-is, clearly historical, for old days that have them. */}
      {(plan.bias != null || legacyKeyLevels) && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <p className="text-[11px] font-medium text-muted-foreground/70 uppercase">
            Legacy day-level plan (pre-dates per-asset analysis)
          </p>
          {plan.bias != null && (
            <WorkspaceField
              label="Bias"
              value={`${BIAS_LABEL[plan.bias]}${plan.conviction ? ` · ${plan.conviction}/5` : ""}`}
            />
          )}
          {legacyKeyLevels && <NoteBlock label="Key levels & areas of interest" text={legacyKeyLevels} />}
        </div>
      )}
    </div>
  );
}
