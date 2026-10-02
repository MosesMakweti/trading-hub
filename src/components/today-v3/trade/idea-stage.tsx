"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tag, colorForName } from "@/components/ui/tag";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import { PreTradeMoodRecap } from "@/components/journal/workspace/pre-trade-mood-recap";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { AssetContextPanel } from "@/components/today-v3/trade/asset-context-panel";
import { IdeaForm, type IdeaFormDefaults } from "@/components/today-v3/trade/idea-form";
import { loadIdeaForEditAction } from "@/actions/today-v3.actions";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";

/**
 * Today V3 — Idea stage: a compact record of what the trader knew when they
 * spotted it, plus today's asset context by reference. Editable before
 * entry through the canonical updateTrade path; after entry it is part of
 * the record (setup validation and bias snapshot are frozen then).
 */
export function IdeaStage({
  trade,
  strategies,
  analysisFor,
  plan,
  loggedBeforeReady,
  limitOverrideReason,
}: {
  trade: TradeWorkspaceDTO;
  strategies: { id: string; name: string; version: number }[];
  analysisFor: (symbol: string) => DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  loggedBeforeReady: boolean;
  limitOverrideReason: string | null;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [editing, setEditing] = useState<IdeaFormDefaults | null>(null);
  const [loading, start] = useTransition();
  // Editable only while it's a live idea: not after entry, not once cancelled.
  const canEdit = editable && trade.actualEntry == null && trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED";

  function openEditor() {
    start(async () => {
      const r = await loadIdeaForEditAction(trade.id);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setEditing({
        assetSymbol: trade.assetSymbol,
        strategyId: r.data.strategyId,
        direction: r.data.direction,
        directionFromFinalBias: false,
        session: r.data.selectedSession,
        selectedEntryModel: r.data.selectedEntryModel,
        selectedConfluences: r.data.selectedConfluences,
        setupTypeId: r.data.setupTypeId,
        selectedSetupConditions: r.data.selectedSetupConditions,
        setupOverrideReason: r.data.setupOverrideReason,
        setupOverrideNote: r.data.setupOverrideNote,
        reasonForTrade: r.data.reasonForTrade,
        preTradeMoodTags: r.data.preTradeMoodTags,
        preTradeMoodIntensity: r.data.preTradeMoodIntensity,
        preTradeMoodNote: r.data.preTradeMoodNote,
      });
    });
  }

  if (editing) {
    return (
      <IdeaForm
        mode="edit"
        dateKey={trade.dateKey}
        tradeId={trade.id}
        strategies={strategies}
        defaults={editing}
        assetLocked
        assetOptions={[]}
        analysisFor={analysisFor}
        plan={plan}
        onDone={() => {
          setEditing(null);
          router.refresh();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {(loggedBeforeReady || limitOverrideReason) && (
        <div className="space-y-1">
          {loggedBeforeReady && (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5" />
              Logged before readiness was confirmed
            </p>
          )}
          {limitOverrideReason && (
            <p className="text-xs">
              <span className="font-medium text-warning">Daily limit overridden: </span>
              {limitOverrideReason}
            </p>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Item label="Strategy" value={trade.strategyName ? `${trade.strategyName} · v${trade.strategyVersion}` : "Freeform"} />
        <Item label="Session" value={trade.sessionName ?? "—"} />
        <Item label="Entry model" value={trade.entryModelName ?? "—"} />
        <Item label="Daily bias at idea" value={trade.dailyBiasSnapshot ?? "No analysis"} />
      </dl>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <span className="text-xs text-muted-foreground">Confluences</span>
          {trade.confluenceLabels.length ? (
            <div className="flex flex-wrap gap-1.5">
              {trade.confluenceLabels.map((t) => (
                <Tag key={t.name} color={t.color ?? colorForName(t.name)}>
                  {t.name}
                </Tag>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic">None selected.</p>
          )}
        </div>
        {(trade.setupValid !== null || trade.setupScore != null) && (
          <SetupScoreCard
            score={trade.setupScore}
            rating={trade.setupRating}
            valid={trade.setupValid}
            missingMandatory={trade.missingMandatory}
            className="w-full max-w-xs"
          />
        )}
      </div>

      {trade.reasonForTrade && (
        <p className="text-sm">
          <span className="text-xs text-muted-foreground">Why: </span>
          {trade.reasonForTrade}
        </p>
      )}

      <PreTradeMoodRecap tags={trade.preTradeMoodTags} intensity={trade.preTradeMoodIntensity} note={trade.preTradeMoodNote} compact />

      <AssetContextPanel analysis={analysisFor(trade.assetSymbol)} plan={plan} />

      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openEditor} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
            Edit idea
          </Button>
        </div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
