"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { SaveDot, SectionCard } from "@/components/today/today-ui";
import { TodayAssetsSection } from "@/components/today/today-assets-section";
import { useDebouncedAutosave, type SaveState } from "@/hooks/use-debounced-autosave";
import { updateTodaysPlan } from "@/actions/today.actions";
import type { TodaysPlanDTO, DailyAssetAnalysisDTO } from "@/types/today";
import type { SessionWindow } from "@/domain/schedule/session-countdown";

/**
 * Daily Market Plan (Stage 11) — the single, integrated planning workflow
 * that replaces the old separate "Today's Plan" + "Asset Analysis" tabs.
 * Ownership per field (see this stage's completion report for the full
 * audit): Today's Assets and everything asset-specific (bias, areas of
 * interest, fundamentals, directional evidence) live on DailyAssetAnalysis
 * below; General Session Context / News & Fundamentals / Risk Boundaries are
 * genuinely day-level and stay on TradingDay. There is no day-level HTF bias
 * or areas-of-interest control here anymore — those were the exact
 * duplication this stage removes.
 */
export function DailyMarketPlanSection({
  dateKey,
  plan,
  analyses,
  onComplete,
  strategies,
  tradeFormAccounts,
  activeSessions,
  sessionWindows,
}: {
  dateKey: string;
  plan: TodaysPlanDTO;
  analyses: DailyAssetAnalysisDTO[];
  /** Called once the plan is marked complete — the parent moves the workspace
   *  on to Trade Idea. */
  onComplete?: () => void;
  // Today V2 (T3) — threaded through to each asset card so "Start Trade
  // Idea" can launch with that asset's day-plan context pre-filled.
  strategies: { id: string; name: string; version: number }[];
  tradeFormAccounts: { id: string; name: string; kind: string }[];
  activeSessions: string[];
  sessionWindows: SessionWindow[];
}) {
  const router = useRouter();

  const [risk, setRisk] = useState(plan.riskBudgetPercent == null ? "" : String(plan.riskBudgetPercent));
  const [maxTrades, setMaxTrades] = useState(
    plan.maxTradesPerDay == null ? "" : String(plan.maxTradesPerDay),
  );
  const [sessions, setSessions] = useState<string[]>(plan.activeSessions);
  const [sessionsSave, setSessionsSave] = useState<SaveState>("idle");
  const [newsAcknowledged, setNewsAcknowledged] = useState(plan.newsAcknowledged);
  const [newsSave, setNewsSave] = useState<SaveState>("idle");
  const [isComplete, setIsComplete] = useState(plan.planComplete);
  const [completing, startComplete] = useTransition();

  const riskSave = useDebouncedAutosave({
    value: risk,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const t = v.trim();
      const num = t === "" ? null : Number(t);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "Risk budget must be 0–100%." };
      }
      return updateTodaysPlan(dateKey, { riskBudgetPercent: num });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  const maxTradesSave = useDebouncedAutosave({
    value: maxTrades,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const t = v.trim();
      const num = t === "" ? null : Number(t);
      if (num !== null && (Number.isNaN(num) || num < 0 || !Number.isInteger(num))) {
        return { success: false, error: "Max trades must be a whole number." };
      }
      return updateTodaysPlan(dateKey, { maxTradesPerDay: num });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  async function changeSessions(next: string[]) {
    setSessions(next);
    setSessionsSave("saving");
    const r = await updateTodaysPlan(dateKey, { activeSessions: next });
    if (r.success) setSessionsSave("saved");
    else {
      setSessionsSave("error");
      toast.error(r.error);
    }
  }

  async function toggleNewsAcknowledged(checked: boolean) {
    setNewsAcknowledged(checked);
    setNewsSave("saving");
    const r = await updateTodaysPlan(dateKey, { newsAcknowledged: checked });
    if (r.success) setNewsSave("saved");
    else {
      setNewsSave("error");
      toast.error(r.error);
    }
  }

  function toggleComplete() {
    const next = !isComplete;
    startComplete(async () => {
      const r = await updateTodaysPlan(dateKey, { planComplete: next });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setIsComplete(next);
      toast.success(next ? "Plan set." : "Plan reopened.");
      router.refresh(); // advance the workflow stepper
      if (next) onComplete?.(); // …and carry the trader on to Trade Idea
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Build today&apos;s market thesis — which assets, what matters in them, your directional
        read, and your boundaries for the session.
      </p>

      {/* Today's Assets → Asset Analysis, one integrated step */}
      <SectionCard title="Today's assets">
        <TodayAssetsSection
          dateKey={dateKey}
          analyses={analyses}
          strategies={strategies}
          tradeFormAccounts={tradeFormAccounts}
          activeSessions={activeSessions}
          sessionWindows={sessionWindows}
        />
      </SectionCard>

      {/* General Session Context — day-level, asset-independent */}
      <SectionCard title="General session context">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">What am I looking for today?</p>
            <RichTextEditor
              initialContent={plan.lookingFor}
              placeholder="e.g. Liquidity sweep of the Asia low into NY open, then a reversal…"
              onSave={(content) => updateTodaysPlan(dateKey, { lookingFor: content })}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Sessions</p>
              <SaveDot state={sessionsSave} />
            </div>
            <AssetTagInput
              value={sessions}
              onChange={changeSessions}
              placeholder="e.g. LONDON, NEW YORK, ASIA"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Important conditions</p>
            <RichTextEditor
              initialContent={plan.importantConditions}
              placeholder="Conditions worth noting going in — volatility, correlated markets, illiquid holiday session…"
              onSave={(content) => updateTodaysPlan(dateKey, { importantConditions: content })}
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Stay-out conditions</p>
            <RichTextEditor
              initialContent={plan.stayOutConditions}
              placeholder="Conditions that mean staying flat today — no clear structure, red-folder news window, choppy range…"
              onSave={(content) => updateTodaysPlan(dateKey, { stayOutConditions: content })}
            />
          </div>
        </div>
      </SectionCard>

      {/* News & Fundamentals — day-level, general macro/news context (asset-specific fundamentals live on each asset's own card above) */}
      <SectionCard title="News & fundamentals">
        <div className="space-y-3">
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={newsAcknowledged}
              onCheckedChange={(c) => toggleNewsAcknowledged(c === true)}
            />
            I&apos;ve reviewed today&apos;s relevant news/economic events
            <SaveDot state={newsSave} />
          </label>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">News notes</p>
            <RichTextEditor
              initialContent={plan.newsNotes}
              placeholder="Events to watch — time, currency/market, expected impact…"
              onSave={(content) => updateTodaysPlan(dateKey, { newsNotes: content })}
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">General macro/fundamental outlook</p>
            <RichTextEditor
              initialContent={plan.dailyFundamentalOutlook}
              placeholder="Overall macro backdrop for the day — this is general, not per-asset (see each asset's own fundamentals above)…"
              onSave={(content) => updateTodaysPlan(dateKey, { dailyFundamentalOutlook: content })}
            />
          </div>
        </div>
      </SectionCard>

      {/* Risk Boundaries — day-level; applies to the whole session, not a single asset */}
      <SectionCard title="Risk boundaries">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Daily risk budget</p>
              <SaveDot state={riskSave} />
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                placeholder="e.g. 2"
                aria-label="Risk budget percent"
                className="h-9 w-28 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">% of account</span>
            </div>
            {plan.planRiskLimit != null && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Plan daily limit:{" "}
                <span className="text-foreground tabular-nums">{plan.planRiskLimit}%</span>
              </span>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Max trades today</p>
              <SaveDot state={maxTradesSave} />
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step="1"
                value={maxTrades}
                onChange={(e) => setMaxTrades(e.target.value)}
                placeholder="e.g. 3"
                aria-label="Max trades today"
                className="h-9 w-28 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">trades</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Finalize */}
      <div className="flex items-center justify-end gap-3">
        {isComplete && (
          <span className={cn("flex items-center gap-1.5 text-sm text-success")}>
            <CircleCheck className="size-4" />
            Plan set
          </span>
        )}
        <Button
          type="button"
          variant={isComplete ? "outline" : "default"}
          onClick={toggleComplete}
          disabled={completing}
          className="gap-1.5"
        >
          {completing && <Loader2 className="size-3.5 animate-spin" />}
          {isComplete ? "Reopen plan" : "Mark plan complete"}
        </Button>
      </div>
    </div>
  );
}
