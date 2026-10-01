"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AdapterDetectResult, ImportPlatform } from "@/domain/prop-firms/import/types";

const PLATFORM_LABELS: Record<string, string> = {
  MT4: "MetaTrader 4",
  MT5: "MetaTrader 5",
  CTRADER: "cTrader",
  NINJATRADER: "NinjaTrader",
  TRADOVATE: "Tradovate",
  GENERIC_CSV: "Generic CSV (manual column mapping)",
};

export function PlatformSelect({
  detected,
  selected,
  autoSelected,
  onSelect,
}: {
  detected: AdapterDetectResult[];
  selected: ImportPlatform | null;
  autoSelected: boolean;
  onSelect: (platform: ImportPlatform) => void;
}) {
  return (
    <div className="space-y-2">
      {autoSelected && selected && (
        <p className="text-xs text-muted-foreground">
          Auto-detected <span className="font-medium text-foreground">{PLATFORM_LABELS[selected]}</span> from the file
          headers — change it below if that&apos;s wrong.
        </p>
      )}
      {detected.map((d) => {
        const isActive = selected === d.platform;
        const pct = Math.round(d.confidence * 100);
        return (
          <button
            key={d.platform}
            type="button"
            onClick={() => onSelect(d.platform)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
              isActive ? "border-primary bg-accent/40" : "border-border hover:bg-muted/50",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {PLATFORM_LABELS[d.platform] ?? d.platform}
                {isActive && <Check className="size-3.5 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">{d.reason}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-viz-1" style={{ width: `${pct}%` }} />
              </div>
              <Badge variant="outline">{pct}%</Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}
