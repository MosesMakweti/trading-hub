"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Lock, Loader2, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  listMt5DataSourceOptionsAction,
  resetMarketDataSourceAction,
  selectMt5DataSourceAction,
} from "@/actions/mt5-import.actions";
import { Mt5ImportWizard } from "./mt5-import-wizard";
import type { Timeframe } from "@/domain/market-data/timeframe";
import type { Mt5DataSourceOptionDTO } from "@/server/services/replay-review.service";
import type { MarketDataImportSummaryDTO } from "@/server/services/mt5-import.service";

function formatRange(fromIso: string, toIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${fmt(fromIso)} – ${fmt(toIso)}`;
}

type Choice = "AUTOMATIC" | "MT5";
type Mode = "CHOOSE" | "IMPORT";

/**
 * Edge Review Replay Data Source — the full picker (§4-7/§14-19), opened
 * from the Replay toolbar's compact "Data Source" control. Never exposes
 * internal provider names in the top-level choice (§4): the two options
 * are "Traditorium Historical Data" (automatic — whichever of
 * Databento/Twelve Data/Fixture the app would already pick) and "MT5
 * Imported Data" (an explicit trader choice, never auto-selected — §14/§25).
 */
export function DataSourceSheet({
  open,
  onOpenChange,
  sessionId,
  canonicalSymbol,
  nativeTimeframe,
  locked,
  currentSourceLabel,
  currentDatasetId,
  onSourceDecided,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  canonicalSymbol: string;
  nativeTimeframe: Timeframe;
  /** True once candles have already been served for this asset in this
   *  session — the source can no longer be changed (§16). */
  locked: boolean;
  /** The passive badge's current resolved label ("Databento", "MT5
   *  Imported", "Synthetic Fixture", …), or null before anything has
   *  loaded yet. */
  currentSourceLabel: string | null;
  /** The exact `MarketDataImport` id currently pinned, if the source is
   *  already (or was previously) explicitly set to MT5. */
  currentDatasetId: string | null;
  /** Called once a source decision has been made (selected MT5, or
   *  explicitly confirmed automatic) — the caller un-pauses its candle
   *  fetch for this asset. `importId` is the pinned dataset (MT5), or null
   *  for automatic resolution. */
  onSourceDecided: (importId: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("CHOOSE");
  const [choice, setChoice] = useState<Choice>(currentDatasetId ? "MT5" : "AUTOMATIC");
  const [options, setOptions] = useState<Mt5DataSourceOptionDTO[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selecting, startSelect] = useTransition();
  const [confirmingAutomatic, startConfirmAutomatic] = useTransition();

  function loadOptions() {
    setLoadingOptions(true);
    void listMt5DataSourceOptionsAction({ sessionId, canonicalSymbol, nativeTimeframe }).then((res) => {
      setLoadingOptions(false);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setOptions(res.options);
    });
  }

  useEffect(() => {
    if (open && !locked) {
      // Deferred a tick so this effect never calls setState synchronously
      // within its own body.
      queueMicrotask(() => {
        setMode("CHOOSE");
        setChoice(currentDatasetId ? "MT5" : "AUTOMATIC");
        loadOptions();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locked, sessionId, canonicalSymbol, nativeTimeframe]);

  function selectDataset(importId: string) {
    startSelect(async () => {
      const res = await selectMt5DataSourceAction({ sessionId, canonicalSymbol, importId, nativeTimeframe });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("MT5 Imported Data selected for this asset.");
      onOpenChange(false);
      onSourceDecided(importId);
    });
  }

  function confirmAutomatic() {
    startConfirmAutomatic(async () => {
      const res = await resetMarketDataSourceAction({ sessionId, canonicalSymbol });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
      onSourceDecided(null);
    });
  }

  function onImported(imp: MarketDataImportSummaryDTO) {
    setMode("CHOOSE");
    setOptions((prev) => {
      const reasons: string[] = [];
      if (imp.canonicalSymbol !== canonicalSymbol) reasons.push(`Different symbol (${imp.canonicalSymbol})`);
      if (imp.nativeTimeframe !== nativeTimeframe) reasons.push(`Different timeframe (${imp.nativeTimeframe})`);
      const next: Mt5DataSourceOptionDTO = { ...imp, compatible: reasons.length === 0, incompatibilityReasons: reasons };
      const rest = (prev ?? []).filter((o) => o.id !== imp.id);
      return [next, ...rest].sort((a, b) => Number(b.compatible) - Number(a.compatible));
    });
  }

  const compatible = options?.filter((o) => o.compatible) ?? [];
  const incompatible = options?.filter((o) => !o.compatible) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg">
        <SheetHeader className="px-0">
          <SheetTitle>Data Source</SheetTitle>
          <SheetDescription>
            {canonicalSymbol} · {nativeTimeframe}
          </SheetDescription>
        </SheetHeader>

        {locked ? (
          <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Lock className="size-3.5 text-muted-foreground" />
              Locked for this replay
            </p>
            <p className="text-xs text-muted-foreground">
              {`Candles have already been loaded for ${canonicalSymbol} in this review`} — the data source can&apos;t
              be changed anymore, to keep Replay&apos;s data consistent for the rest of this session.
            </p>
            {currentSourceLabel && <p className="text-sm font-medium">Current source: {currentSourceLabel}</p>}
            <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
              This is permanent for this exact review period and asset scope — there&apos;s no way to reset or
              switch it later, and reopening this same period always returns to this same session. To replay{" "}
              {canonicalSymbol} against a different source, choose it on a <span className="font-medium">different</span>{" "}
              Weekly/Monthly period or asset scope, before its first candle loads there.
            </p>
          </div>
        ) : mode === "IMPORT" ? (
          <div className="mt-4">
            <Mt5ImportWizard canonicalSymbolHint={canonicalSymbol} onImported={onImported} onCancel={() => setMode("CHOOSE")} />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setChoice("AUTOMATIC")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                  choice === "AUTOMATIC" ? "border-primary bg-accent/40" : "border-border hover:bg-muted/50",
                )}
              >
                <div>
                  <div className="font-medium">Traditorium Historical Data</div>
                  <div className="text-xs text-muted-foreground">The app&apos;s own market data — no setup needed.</div>
                </div>
                {choice === "AUTOMATIC" && <Check className="size-4 shrink-0 text-primary" />}
              </button>
              <button
                type="button"
                onClick={() => setChoice("MT5")}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                  choice === "MT5" ? "border-primary bg-accent/40" : "border-border hover:bg-muted/50",
                )}
              >
                <div>
                  <div className="font-medium">MT5 Imported Data</div>
                  <div className="text-xs text-muted-foreground">Replay using candles you&apos;ve imported from MT5.</div>
                </div>
                {choice === "MT5" && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            </div>

            {choice === "AUTOMATIC" && (
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={confirmAutomatic} disabled={confirmingAutomatic}>
                  {confirmingAutomatic && <Loader2 className="size-3.5 animate-spin" />}
                  Confirm
                </Button>
              </div>
            )}

            {choice === "MT5" && (
              <div className="space-y-3">
                {loadingOptions ? (
                  <p className="flex items-center gap-1.5 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading your imported datasets…
                  </p>
                ) : options && options.length === 0 ? (
                  <div className="space-y-3 rounded-lg border border-dashed border-border p-6 text-center">
                    <p className="text-sm font-medium">No MT5 data imported yet</p>
                    <p className="text-xs text-muted-foreground">
                      Import a CSV or TXT candle export from MT5 to replay {canonicalSymbol} with your own broker&apos;s data.
                    </p>
                    <Button type="button" size="sm" className="gap-1.5" onClick={() => setMode("IMPORT")}>
                      <Upload className="size-3.5" />
                      Import New MT5 Data
                    </Button>
                  </div>
                ) : (
                  <>
                    {compatible.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Compatible</p>
                        {compatible.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            disabled={selecting}
                            onClick={() => selectDataset(o.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-60"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">
                                {o.canonicalSymbol} · {o.nativeTimeframe}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatRange(o.rangeFrom, o.rangeTo)} · {o.candleCount.toLocaleString()} candles
                              </div>
                              {o.quality.longestUnexpectedGapIntervals > 0 && (
                                <div className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                                  <AlertTriangle className="size-3" /> Has data gaps
                                </div>
                              )}
                            </div>
                            {o.id === currentDatasetId && <Check className="size-4 shrink-0 text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {incompatible.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Other imports</p>
                        {incompatible.map((o) => (
                          <div key={o.id} className="rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5 text-sm opacity-70">
                            <div className="font-medium">
                              {o.canonicalSymbol} · {o.nativeTimeframe}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatRange(o.rangeFrom, o.rangeTo)} · {o.incompatibilityReasons.join(", ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setMode("IMPORT")}>
                      <Upload className="size-3.5" />
                      Import New MT5 Data
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
