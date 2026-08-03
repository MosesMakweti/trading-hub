"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { SimpleListSection } from "@/components/plan/simple-list-section";
import { PartialTpList } from "@/components/strategy-lab/partial-tp-list";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { updateTradeManagement } from "@/actions/strategy-trade-management.actions";
import {
  archiveCustomRule,
  createCustomRule,
  reorderCustomRules,
  updateCustomRule,
} from "@/actions/strategy-trade-management.actions";
import type { TradeManagementRichField } from "@/lib/validation/strategy-trade-management";
import type { TradeManagementDTO } from "@/types/strategies";

const FIELDS: { key: TradeManagementRichField; label: string; placeholder: string }[] = [
  { key: "takeProfitPhilosophy", label: "Overall take-profit philosophy", placeholder: "How do you think about taking profit?" },
  { key: "initialStopPlacement", label: "Initial stop-loss placement", placeholder: "Where does the first stop go?" },
  { key: "breakEvenRules", label: "Break-even rules", placeholder: "When do you move to break-even?" },
  { key: "trailingStopRules", label: "Trailing-stop rules", placeholder: "How do you trail?" },
  { key: "scalingInRules", label: "Scaling-in rules", placeholder: "When do you add to a position?" },
  { key: "scalingOutRules", label: "Scaling-out rules", placeholder: "When do you reduce?" },
];

type RichFields = Record<TradeManagementRichField, unknown>;

export function TradeManagementSection({
  strategyId,
  tradeManagement,
}: {
  strategyId: string;
  tradeManagement: TradeManagementDTO;
}) {
  const tm = tradeManagement;

  const [fields, setFields] = useState<RichFields>(() => ({
    takeProfitPhilosophy: tm.takeProfitPhilosophy,
    initialStopPlacement: tm.initialStopPlacement,
    breakEvenRules: tm.breakEvenRules,
    trailingStopRules: tm.trailingStopRules,
    scalingInRules: tm.scalingInRules,
    scalingOutRules: tm.scalingOutRules,
  }));
  const [limits, setLimits] = useState({
    maxHoldingTime: tm.maxHoldingTime ?? "",
    maxRiskPercent: tm.maxRiskPercent?.toString() ?? "",
  });

  const limitsSave = useDebouncedAutosave({
    value: limits,
    serialize: (v) => JSON.stringify([v.maxHoldingTime.trim(), v.maxRiskPercent.trim()]),
    save: async (v) => {
      const pct = v.maxRiskPercent.trim();
      const num = pct === "" ? null : Number(pct);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "Max risk must be 0–100%." };
      }
      return updateTradeManagement(strategyId, tm.id, {
        maxHoldingTime: v.maxHoldingTime.trim() === "" ? null : v.maxHoldingTime.trim(),
        maxRiskPercent: num,
      });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveRich(key: TradeManagementRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateTradeManagement(strategyId, tm.id, { [key]: content });
    };
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How you manage a position after entry.
      </p>

      {/* Core rules + limits */}
      <div className="glass space-y-5 rounded-2xl p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <RichTextEditor
                initialContent={fields[f.key]}
                placeholder={f.placeholder}
                onSave={saveRich(f.key)}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tm-max-hold" className="text-xs">
              Maximum holding time
            </Label>
            <Input
              id="tm-max-hold"
              value={limits.maxHoldingTime}
              onChange={(e) => setLimits((l) => ({ ...l, maxHoldingTime: e.target.value }))}
              placeholder="e.g. 2 hours, 1 session"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-max-risk" className="text-xs">
              Maximum risk (% per trade)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="tm-max-risk"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={limits.maxRiskPercent}
                onChange={(e) => setLimits((l) => ({ ...l, maxRiskPercent: e.target.value }))}
                placeholder="e.g. 1"
                className="max-w-32"
              />
              <span className="text-sm text-muted-foreground">%</span>
              {limitsSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              {limitsSave === "saved" && <Check className="size-3.5 text-success" />}
            </div>
          </div>
        </div>
      </div>

      {/* Partial take-profit levels */}
      <div className="glass space-y-3 rounded-2xl p-5">
        <div>
          <h3 className="text-sm font-medium">Partial take-profit levels</h3>
          <p className="text-xs text-muted-foreground">
            Where you scale out — trigger, how much to close, and why.
          </p>
        </div>
        <PartialTpList
          strategyId={strategyId}
          tradeManagementId={tm.id}
          initialLevels={tm.partialTakeProfits}
        />
      </div>

      {/* Custom rules (reuses the plan SimpleListSection) */}
      <div className="glass space-y-3 rounded-2xl p-5">
        <div>
          <h3 className="text-sm font-medium">Custom rules</h3>
          <p className="text-xs text-muted-foreground">
            Your own management rules — e.g. &ldquo;Move stop to BE after 2R&rdquo;, &ldquo;Never add after news&rdquo;.
          </p>
        </div>
        <SimpleListSection
          initialItems={tm.customRules}
          fields={[{ key: "text", placeholder: "e.g. Trail below M5 swing lows" }]}
          actions={{
            create: (values) => createCustomRule(strategyId, tm.id, values),
            update: (id, values) => updateCustomRule(strategyId, id, values),
            archive: (id) => archiveCustomRule(strategyId, id),
            reorder: (orderedIds) => reorderCustomRules(strategyId, tm.id, orderedIds),
          }}
          emptyMessage="No custom rules yet."
          addLabel="Add rule"
          itemLabel="rule"
        />
      </div>
    </div>
  );
}
