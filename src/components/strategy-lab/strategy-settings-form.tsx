"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { STRATEGY_STATUS_META, STRATEGY_STATUS_ORDER } from "@/components/strategy-lab/strategy-status-badge";
import type { SaveState } from "@/hooks/use-debounced-autosave";
import type { StrategyStatusValue } from "@/lib/validation/strategies";

export interface StrategySettingsState {
  name: string;
  description: string;
  applicableAssets: string[];
  status: StrategyStatusValue;
}

const STATUS_LABELS = Object.fromEntries(
  STRATEGY_STATUS_ORDER.map((s) => [s, STRATEGY_STATUS_META[s].label]),
) as Record<StrategyStatusValue, string>;

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <Check className="size-3.5" /> Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger">
        <CircleAlert className="size-3.5" /> Save failed
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Autosaves as you type</span>;
}

export function StrategySettingsForm({
  value,
  onChange,
  saveState,
}: {
  value: StrategySettingsState;
  onChange: (next: StrategySettingsState) => void;
  saveState: SaveState;
}) {
  function patch(partial: Partial<StrategySettingsState>) {
    onChange({ ...value, ...partial });
  }

  const nameEmpty = value.name.trim().length === 0;

  return (
    <div className="glass space-y-5 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Strategy settings</h2>
        <SaveIndicator state={saveState} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-name" className="text-xs">
          Strategy name
        </Label>
        <Input
          id="settings-name"
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-invalid={nameEmpty}
        />
        {nameEmpty && <p className="text-xs text-danger">Name can&apos;t be empty.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-description" className="text-xs">
          Description
        </Label>
        <Textarea
          id="settings-description"
          rows={3}
          placeholder="A short summary of the edge this strategy captures."
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Applicable assets</Label>
          <AssetTagInput
            value={value.applicableAssets}
            onChange={(applicableAssets) => patch({ applicableAssets })}
          />
          <p className="text-[11px] text-muted-foreground">
            These become available in the Journal when this strategy is selected.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            items={STATUS_LABELS}
            value={value.status}
            onValueChange={(status) => patch({ status: status as StrategyStatusValue })}
          >
            <SelectTrigger className={cn("w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_STATUS_ORDER.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
