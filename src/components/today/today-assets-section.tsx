"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, LineChart, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { ImageAttachments } from "@/components/media/image-attachments";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { SaveDot } from "@/components/today/today-ui";
import { DirectionalEvidencePanel } from "@/components/today/directional-evidence-panel";
import { AddTradeDialog } from "@/components/today/add-trade-dialog";
import type { SaveState } from "@/hooks/use-debounced-autosave";
import {
  archiveDailyAssetAnalysis,
  createOrGetDailyAssetAnalysis,
  updateDailyAssetAnalysis,
} from "@/actions/daily-asset-analysis.actions";
import type { DayBias } from "@/lib/validation/today";
import type { FinalBias } from "@/lib/validation/daily-asset-analysis";
import type { DailyAssetAnalysisDTO } from "@/types/today";
import type { SessionWindow } from "@/domain/schedule/session-countdown";

const MARKET_BIASES: { value: DayBias; label: string; selected: "default" | "destructive" | "secondary" }[] = [
  { value: "BULLISH", label: "Bullish", selected: "default" },
  { value: "BEARISH", label: "Bearish", selected: "destructive" },
  { value: "NEUTRAL", label: "Neutral", selected: "secondary" },
];

const FINAL_BIASES: { value: FinalBias; label: string; selected: "default" | "destructive" | "secondary" }[] = [
  { value: "LONG", label: "Long", selected: "default" },
  { value: "SHORT", label: "Short", selected: "destructive" },
  { value: "NEUTRAL", label: "Neutral", selected: "secondary" },
];

function BiasRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; selected: "default" | "destructive" | "secondary" }[];
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={value === o.value ? o.selected : "outline"}
            aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? null : o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Today's Assets (Stage 11 §3-4) — the ONE place a trader picks which assets
 * they're watching/trading today AND analyzes each one. Adding an asset here
 * directly creates/opens its DailyAssetAnalysis row; there is no separate
 * watchlist to keep in sync (that duplication — "watchlist → separate Asset
 * Analysis creation" — is exactly what this consolidates). Fast/visual by
 * design: collapsed to a one-line header (asset + final bias) by default;
 * only the card being worked on is expanded. Technical/fundamental/final
 * biases are three independent selectors — never forced to agree with each
 * other, and Directional Evidence (optional) may only *suggest* a bias.
 */
export function TodayAssetsSection({
  dateKey,
  analyses,
  strategies,
  tradeFormAccounts,
  activeSessions,
  sessionWindows,
}: {
  dateKey: string;
  analyses: DailyAssetAnalysisDTO[];
  // Today V2 (T3) — for each card's "Active strategy" selector and its
  // "Start Trade Idea" launch point (asset + strategy + bias + session, all
  // plain form defaults — see add-trade-dialog.tsx's own doc comment).
  strategies: { id: string; name: string; version: number }[];
  tradeFormAccounts: { id: string; name: string; kind: string }[];
  activeSessions: string[];
  sessionWindows: SessionWindow[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(analyses.length === 1 ? [analyses[0].id] : []),
  );
  const [newSymbol, setNewSymbol] = useState("");
  const [creating, startCreate] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<DailyAssetAnalysisDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addAsset(symbolRaw: string) {
    const symbol = symbolRaw.trim();
    if (!symbol) return;
    startCreate(async () => {
      const r = await createOrGetDailyAssetAnalysis(dateKey, { assetSymbol: symbol });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setExpanded((prev) => new Set(prev).add(r.id));
      setNewSymbol("");
      router.refresh();
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const r = await archiveDailyAssetAnalysis(dateKey, pendingDelete.id);
    setDeleting(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    setPendingDelete(null);
    toast.success("Removed from today's assets.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose the assets you&apos;re watching/trading today, then analyze each one — technical
        structure, fundamental view, and your final trading conclusion. They don&apos;t have to agree.
      </p>

      <div className="flex items-center gap-2">
        <Input
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAsset(newSymbol);
            }
          }}
          placeholder="Add today's asset — e.g. XAUUSD"
          className="h-9 max-w-60"
          disabled={creating}
        />
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={creating || !newSymbol.trim()}
          onClick={() => addAsset(newSymbol)}
        >
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add asset
        </Button>
      </div>

      {analyses.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="No assets selected yet"
          description="Add an asset above to start today's market plan — key areas of interest, HTF/session bias, fundamental view, and your final conclusion."
        />
      ) : (
        <div className="space-y-3">
          {analyses.map((analysis) => (
            <AssetAnalysisCard
              key={analysis.id}
              dateKey={dateKey}
              analysis={analysis}
              expanded={expanded.has(analysis.id)}
              onToggle={() => toggle(analysis.id)}
              onDelete={() => setPendingDelete(analysis)}
              strategies={strategies}
              tradeFormAccounts={tradeFormAccounts}
              activeSessions={activeSessions}
              sessionWindows={sessionWindows}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove this asset?"
        description={`This permanently removes ${pendingDelete?.assetSymbol ?? "this asset"}'s analysis and screenshots for today.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function AssetAnalysisCard({
  dateKey,
  analysis,
  expanded,
  onToggle,
  onDelete,
  strategies,
  tradeFormAccounts,
  activeSessions,
  sessionWindows,
}: {
  dateKey: string;
  analysis: DailyAssetAnalysisDTO;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  strategies: { id: string; name: string; version: number }[];
  tradeFormAccounts: { id: string; name: string; kind: string }[];
  activeSessions: string[];
  sessionWindows: SessionWindow[];
}) {
  const [htfBias, setHtfBias] = useState<DayBias | null>(analysis.htfBias);
  const [sessionBias, setSessionBias] = useState<DayBias | null>(analysis.sessionBias);
  const [fundamentalBias, setFundamentalBias] = useState<DayBias | null>(analysis.fundamentalBias);
  const [finalBias, setFinalBias] = useState<FinalBias | null>(analysis.finalBias);
  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(analysis.activeStrategyId);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function save(patch: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    setSaveState("saving");
    const r = await updateDailyAssetAnalysis(dateKey, analysis.id, patch);
    setSaveState(r.success ? "saved" : "error");
    if (!r.success) toast.error(r.error);
    return r;
  }

  const symbolStyle = TAG_STYLES[colorForName(analysis.assetSymbol)];
  const finalBadge = FINAL_BIASES.find((f) => f.value === finalBias);

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 p-3.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs",
              symbolStyle.chip,
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", symbolStyle.dot)} />
            {analysis.assetSymbol}
          </span>
          {finalBadge && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                finalBadge.value === "LONG" && "bg-success/15 text-success",
                finalBadge.value === "SHORT" && "bg-destructive/15 text-destructive",
                finalBadge.value === "NEUTRAL" && "bg-secondary text-secondary-foreground",
              )}
            >
              {finalBadge.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <SaveDot state={saveState} />
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border/60 p-3.5">
          <div className="flex items-center justify-between">
            {/* Today V2 (T3) — launched FROM this asset's plan, so the new
                Trade Idea starts pre-filled with this asset's own bias,
                active strategy, and the day's session — see
                add-trade-dialog.tsx's own doc comment for the split between
                this and the generic "Add trade" entry points. */}
            <AddTradeDialog
              dateKey={dateKey}
              accounts={tradeFormAccounts}
              strategies={strategies}
              initialAssetSymbol={analysis.assetSymbol}
              initialStrategyId={activeStrategyId ?? undefined}
              finalBias={finalBias}
              activeSessions={activeSessions}
              sessionWindows={sessionWindows}
              trigger={
                <Button type="button" size="sm" variant="outline" className="gap-1.5">
                  <Sparkles className="size-3.5" />
                  Start trade idea
                </Button>
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          </div>

          {/* Areas of Interest — the ONE place these live (Stage 11 §4). */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">Key areas of interest</p>
            <RichTextEditor
              initialContent={analysis.keyLevels}
              placeholder="Major support/resistance, supply/demand, liquidity, previous highs/lows, imbalance/FVG, session highs/lows, custom levels…"
              onSave={(content) => save({ keyLevels: content })}
            />
          </div>

          {/* Technical */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Technical</p>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Market structure</p>
              <RichTextEditor
                initialContent={analysis.marketStructure}
                placeholder="Range, trend, key structure breaks…"
                onSave={(content) => save({ marketStructure: content })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BiasRow
                label="HTF bias"
                options={MARKET_BIASES}
                value={htfBias}
                onChange={(v) => {
                  setHtfBias(v);
                  void save({ htfBias: v });
                }}
              />
              <BiasRow
                label="Session bias"
                options={MARKET_BIASES}
                value={sessionBias}
                onChange={(v) => {
                  setSessionBias(v);
                  void save({ sessionBias: v });
                }}
              />
            </div>
          </div>

          {/* Fundamental */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Fundamental</p>
            <BiasRow
              label="This asset's fundamental bias"
              options={MARKET_BIASES}
              value={fundamentalBias}
              onChange={(v) => {
                setFundamentalBias(v);
                void save({ fundamentalBias: v });
              }}
            />
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Asset-specific fundamentals</p>
              <RichTextEditor
                initialContent={analysis.fundamentalNotes}
                placeholder="e.g. USD strength, yields, geopolitical risk, gold-specific catalysts…"
                onSave={(content) => save({ fundamentalNotes: content })}
              />
            </div>
          </div>

          {/* Directional Evidence — optional (Stage 11 §7-13) */}
          <DirectionalEvidencePanel
            dateKey={dateKey}
            dailyAssetAnalysisId={analysis.id}
            items={analysis.evidenceItems}
            finalBias={finalBias}
          />

          {/* Conclusion */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Conclusion</p>
            <BiasRow
              label="Final trading bias — not derived from the above"
              options={FINAL_BIASES}
              value={finalBias}
              onChange={(v) => {
                setFinalBias(v);
                void save({ finalBias: v });
              }}
            />
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Active strategy — the default for a new Trade Idea on this asset today
              </p>
              <Select
                items={{ "": "No default strategy", ...Object.fromEntries(strategies.map((s) => [s.id, s.name])) }}
                value={activeStrategyId ?? ""}
                onValueChange={(v) => {
                  const next = v || null;
                  setActiveStrategyId(next);
                  void save({ activeStrategyId: next });
                }}
              >
                <SelectTrigger className="h-9 w-full max-w-72">
                  <SelectValue placeholder="No default strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No default strategy</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Notes</p>
            <RichTextEditor
              initialContent={analysis.notes}
              placeholder="Anything else worth remembering about this asset today…"
              onSave={(content) => save({ notes: content })}
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Chart screenshots</p>
            <ImageAttachments
              ownerType="DAILY_ASSET_ANALYSIS"
              ownerId={analysis.id}
              category="CHART"
              requireTimeframe
            />
          </div>
        </div>
      )}
    </div>
  );
}
