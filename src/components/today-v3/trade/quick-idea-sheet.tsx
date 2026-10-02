"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IdeaForm, type IdeaFormDefaults } from "@/components/today-v3/trade/idea-form";
import type { DayUsage } from "@/domain/today/limit-state";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";

export interface QuickIdeaRequest {
  defaults: IdeaFormDefaults;
  assetLocked: boolean;
  opportunityId?: string;
  /** Changes per open so the form remounts fresh. */
  key: number;
}

/**
 * Today V3 — Quick Trade Idea: a side sheet on desktop, full-screen on small
 * screens. Fast enough to fill while the market is moving; replaces the
 * Journal's full TradeForm on LIVE Today.
 */
export function QuickIdeaSheet({
  request,
  onClose,
  onCreated,
  dateKey,
  strategies,
  assetOptions,
  analysisFor,
  plan,
  usage,
  limits,
  projectedRiskPercent,
}: {
  request: QuickIdeaRequest | null;
  onClose: () => void;
  onCreated: (tradeId: string, next: "plan" | "idea") => void;
  dateKey: string;
  strategies: { id: string; name: string; version: number }[];
  assetOptions: string[];
  analysisFor: (symbol: string) => DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
  projectedRiskPercent: number | null;
}) {
  return (
    <Sheet open={request != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>New trade idea</SheetTitle>
          <SheetDescription>What you know right now. Plan levels and execution come next.</SheetDescription>
        </SheetHeader>
        {request && (
          <div className="px-4 pb-6">
            <IdeaForm
              key={request.key}
              mode="create"
              dateKey={dateKey}
              strategies={strategies}
              defaults={request.defaults}
              assetLocked={request.assetLocked}
              assetOptions={assetOptions}
              analysisFor={analysisFor}
              plan={plan}
              usage={usage}
              limits={limits}
              projectedRiskPercent={projectedRiskPercent}
              opportunityId={request.opportunityId}
              onDone={onCreated}
              onCancel={onClose}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
