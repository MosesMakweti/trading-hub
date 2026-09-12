"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Info, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addDirectionalEvidenceItem,
  deleteDirectionalEvidenceItem,
  updateDirectionalEvidenceItem,
} from "@/actions/daily-asset-analysis.actions";
import {
  compareSuggestedToFinalBias,
  summarizeDirectionalEvidence,
  type EvidenceDirection,
} from "@/domain/today/directional-evidence";
import type { DirectionalEvidenceItemDTO } from "@/types/today";
import type { FinalBias } from "@/lib/validation/daily-asset-analysis";

const TONE: Record<EvidenceDirection, { label: string; chip: string; bar: string; text: string }> = {
  BULLISH: {
    label: "Bullish",
    chip: "border-blue-500/18 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    bar: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
  },
  BEARISH: {
    label: "Bearish",
    chip: "border-orange-500/18 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    bar: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-300",
  },
};

function EvidenceRow({
  item,
  onToggle,
  onRemove,
}: {
  item: DirectionalEvidenceItemDTO;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm", TONE[item.direction].chip, !item.checked && "opacity-40")}>
      <Checkbox checked={item.checked} onCheckedChange={onToggle} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.label}`}
        className="shrink-0 text-muted-foreground/60 transition-colors hover:text-destructive"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function EvidenceColumn({
  direction,
  items,
  maxCount,
  onToggle,
  onRemove,
}: {
  direction: EvidenceDirection;
  items: DirectionalEvidenceItemDTO[];
  maxCount: number;
  onToggle: (item: DirectionalEvidenceItemDTO) => void;
  onRemove: (item: DirectionalEvidenceItemDTO) => void;
}) {
  const activeCount = items.filter((i) => i.checked).length;
  const tone = TONE[direction];
  const widthPercent = maxCount > 0 ? Math.min(100, (activeCount / maxCount) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={cn("text-[11px] font-semibold tracking-wide uppercase", tone.text)}>{tone.label}</span>
        <span className={cn("text-xs font-semibold tabular-nums", tone.text)}>{activeCount}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${widthPercent}%` }} />
      </div>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">None recorded.</p>
        ) : (
          items.map((item) => (
            <EvidenceRow key={item.id} item={item} onToggle={() => onToggle(item)} onRemove={() => onRemove(item)} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Directional Evidence (Stage 11 §7-13) — an OPTIONAL, collapsible bullish-vs-
 * bearish checklist per asset. Purely a trader-defined tally (never a fixed
 * methodology): the trader types a label, picks a side, and it's counted. The
 * suggested bias below is presented as evidence, not probability (§10) — a
 * count comparison, never a percentage. It never overrides the trader's own
 * Final Bias (§11); a disagreement is shown as a subtle note, not a block.
 */
export function DirectionalEvidencePanel({
  dateKey,
  dailyAssetAnalysisId,
  items,
  finalBias,
}: {
  dateKey: string;
  dailyAssetAnalysisId: string;
  items: DirectionalEvidenceItemDTO[];
  finalBias: FinalBias | null;
}) {
  const [localItems, setLocalItems] = useState(items);
  const [expanded, setExpanded] = useState(items.length > 0);
  const [newLabel, setNewLabel] = useState("");
  const [newDirection, setNewDirection] = useState<EvidenceDirection>("BULLISH");
  const [adding, startAdd] = useTransition();

  const summary = summarizeDirectionalEvidence(localItems);
  const agreement = compareSuggestedToFinalBias(summary.suggestedBias, finalBias ?? null);
  const maxCount = Math.max(summary.bullishCount, summary.bearishCount, 1);

  function addItem() {
    const label = newLabel.trim();
    if (!label) return;
    startAdd(async () => {
      const r = await addDirectionalEvidenceItem(dateKey, { dailyAssetAnalysisId, label, direction: newDirection });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setLocalItems((prev) => [...prev, r.item]);
      setNewLabel("");
    });
  }

  function toggleChecked(item: DirectionalEvidenceItemDTO) {
    setLocalItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
    void updateDirectionalEvidenceItem(dateKey, item.id, { checked: !item.checked }).then((r) => {
      if (!r.success) toast.error(r.error);
    });
  }

  function removeItem(item: DirectionalEvidenceItemDTO) {
    setLocalItems((prev) => prev.filter((i) => i.id !== item.id));
    void deleteDirectionalEvidenceItem(dateKey, item.id).then((r) => {
      if (!r.success) toast.error(r.error);
    });
  }

  const bullish = localItems.filter((i) => i.direction === "BULLISH");
  const bearish = localItems.filter((i) => i.direction === "BEARISH");

  const summaryLine =
    summary.leadingDirection === "NONE"
      ? "No directional evidence recorded"
      : summary.leadingDirection === "BALANCED"
        ? `Balanced — ${summary.bullishCount} vs ${summary.bearishCount}`
        : `${summary.leadingDirection === "BULLISH" ? summary.bullishCount : summary.bearishCount} ${TONE[summary.leadingDirection].label} leading`;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/30 p-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">Directional evidence (optional)</p>
          <p className="text-xs text-muted-foreground/70">{summaryLine}</p>
        </div>
        {expanded ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EvidenceColumn direction="BULLISH" items={bullish} maxCount={maxCount} onToggle={toggleChecked} onRemove={removeItem} />
            <EvidenceColumn direction="BEARISH" items={bearish} maxCount={maxCount} onToggle={toggleChecked} onRemove={removeItem} />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["BULLISH", "BEARISH"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setNewDirection(d)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium transition-colors",
                    newDirection === d ? TONE[d].chip : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {TONE[d].label}
                </button>
              ))}
            </div>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="+ Major support / Buy-side liquidity / USD weakness…"
              className="h-8 flex-1 text-sm"
              disabled={adding}
            />
            <Button type="button" size="sm" className="h-8 gap-1 px-2.5" onClick={addItem} disabled={adding || !newLabel.trim()}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>

          {summary.suggestedBias && (
            <p className="text-xs text-muted-foreground">
              Suggested bias: <span className="font-semibold text-foreground">{summary.suggestedBias}</span>
            </p>
          )}
          {agreement === "CONFLICT" && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Your recorded evidence currently favors {summary.suggestedBias === "LONG" ? "bullish" : "bearish"}, but
              your final bias is {finalBias}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
