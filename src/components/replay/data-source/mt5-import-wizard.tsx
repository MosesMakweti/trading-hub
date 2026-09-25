"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmMt5ImportAction, previewMt5ImportAction } from "@/actions/mt5-import.actions";
import { TIMEFRAMES, type Timeframe } from "@/domain/market-data/timeframe";
import { Mt5ImportDropzone, type LoadedMt5File } from "./mt5-import-dropzone";
import type { Mt5ImportPreview, TimeConvention } from "@/domain/mt5-import/types";
import type { MarketDataImportSummaryDTO } from "@/server/services/mt5-import.service";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1m": "M1 — 1 minute",
  "5m": "M5 — 5 minutes",
  "15m": "M15 — 15 minutes",
  "30m": "M30 — 30 minutes",
  "1h": "H1 — 1 hour",
  "4h": "H4 — 4 hours",
  "1D": "D1 — 1 day",
};

type ConventionKind = "UTC" | "FIXED_OFFSET" | "IANA_ZONE";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatRange(from: number, to: number): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

/**
 * §8-13 — reuses the EXISTING MT5 historical-candle import pipeline end to
 * end (no new parser): upload → preview (server re-detects/parses/resolves)
 * → the trader supplies whatever the preview says is missing → confirm
 * persists via `createMt5Import`. Deliberately NOT the same wizard as the
 * MT4/MT5 TRADE/account-history importer (`prop-firms/import/`) — this one
 * imports market CANDLES for Replay, a completely different pipeline, and
 * says so explicitly in its own copy.
 */
export function Mt5ImportWizard({
  canonicalSymbolHint,
  onImported,
  onCancel,
}: {
  canonicalSymbolHint: string;
  onImported: (imp: MarketDataImportSummaryDTO) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<LoadedMt5File | null>(null);
  const [sourceSymbol, setSourceSymbol] = useState(canonicalSymbolHint);
  const [timeframeHint, setTimeframeHint] = useState<Timeframe | "">("");
  const [conventionKind, setConventionKind] = useState<ConventionKind>("UTC");
  const [ianaZone, setIanaZone] = useState(browserTimezone());
  const [offsetMinutes, setOffsetMinutes] = useState("0");
  const [preview, setPreview] = useState<Mt5ImportPreview | null>(null);
  const [overlapping, setOverlapping] = useState<MarketDataImportSummaryDTO[] | null>(null);

  const [previewing, startPreview] = useTransition();
  const [confirming, startConfirm] = useTransition();

  function currentConvention(): TimeConvention | null {
    if (conventionKind === "UTC") return { kind: "UTC" };
    if (conventionKind === "IANA_ZONE") return ianaZone ? { kind: "IANA_ZONE", zone: ianaZone } : null;
    const n = Number(offsetMinutes);
    return Number.isFinite(n) ? { kind: "FIXED_OFFSET", offsetMinutes: n } : null;
  }

  function runPreview(loaded: LoadedMt5File) {
    startPreview(async () => {
      const res = await previewMt5ImportAction({
        fileName: loaded.fileName,
        fileContentBase64: loaded.contentBase64,
        sourceSymbol: sourceSymbol || null,
        timeframeHint: timeframeHint || null,
        timeConvention: currentConvention(),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setPreview(res.preview);
      setOverlapping(null);
    });
  }

  function onLoaded(loaded: LoadedMt5File) {
    setFile(loaded);
    setPreview(null);
    runPreview(loaded);
  }

  // Re-run the preview whenever the trader edits metadata to resolve a
  // NEEDS_USER_INPUT state — never silently guessed (§9).
  function resolveAndRepreview() {
    if (!file) return;
    runPreview(file);
  }

  function confirm(allowOverlap = false) {
    if (!file || !preview || !preview.symbol.canonicalSymbol) return;
    startConfirm(async () => {
      const res = await confirmMt5ImportAction({
        fileName: file.fileName,
        fileContentBase64: file.contentBase64,
        sourceSymbol: sourceSymbol || null,
        timeframeHint: timeframeHint || null,
        timeConvention: currentConvention(),
        canonicalSymbol: preview.symbol.canonicalSymbol!,
        allowOverlap,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      if (res.result.status === "ERROR") {
        toast.error(res.result.error);
        return;
      }
      if (res.result.status === "OVERLAP_CONFIRMATION_REQUIRED") {
        setOverlapping(res.result.overlapping);
        return;
      }
      toast.success("MT5 data imported.");
      onImported(res.result.import);
    });
  }

  const needsInput = preview?.state === "NEEDS_USER_INPUT";
  const invalid = preview?.state === "INVALID";
  const ready = preview?.state === "READY" || preview?.state === "READY_WITH_WARNINGS";

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Import historical candle data exported from MT5 for market replay — not the same as the MT4/MT5 trade or
        account-history importer under Prop Firms.
      </p>

      <Mt5ImportDropzone loadedFileName={file?.fileName ?? null} onLoaded={onLoaded} />

      {previewing && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading the file…
        </p>
      )}

      {file && !previewing && preview && (needsInput || invalid) && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {invalid && (
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {preview.issues[0] ?? "This file can't be imported."}
            </p>
          )}
          {needsInput && (
            <p className="text-xs text-muted-foreground">A few details couldn&apos;t be determined from the file — confirm them below.</p>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Broker / source symbol</label>
            <Input
              value={sourceSymbol}
              onChange={(e) => setSourceSymbol(e.target.value)}
              placeholder="e.g. XAUUSD.a"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Native timeframe</label>
            <Select value={timeframeHint} onValueChange={(v) => setTimeframeHint(v as Timeframe)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a timeframe" />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {TIMEFRAME_LABELS[tf]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Source timezone / time convention</label>
            <Select value={conventionKind} onValueChange={(v) => setConventionKind(v as ConventionKind)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="IANA_ZONE">Named timezone…</SelectItem>
                <SelectItem value="FIXED_OFFSET">Fixed offset from UTC…</SelectItem>
              </SelectContent>
            </Select>
            {conventionKind === "IANA_ZONE" && (
              <Input value={ianaZone} onChange={(e) => setIanaZone(e.target.value)} placeholder="e.g. Europe/London" className="h-8 text-sm" />
            )}
            {conventionKind === "FIXED_OFFSET" && (
              <Input
                type="number"
                value={offsetMinutes}
                onChange={(e) => setOffsetMinutes(e.target.value)}
                placeholder="Offset in minutes, e.g. 120"
                className="h-8 text-sm"
              />
            )}
          </div>

          <Button type="button" size="sm" onClick={resolveAndRepreview} disabled={previewing}>
            {previewing && <Loader2 className="size-3.5 animate-spin" />}
            Continue
          </Button>
        </div>
      )}

      {file && !previewing && preview && ready && (
        <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Symbol</span>
            <span className="font-medium">{preview.symbol.canonicalSymbol}</span>
            <span className="text-muted-foreground">Broker symbol</span>
            <span className="font-mono">{preview.symbol.sourceSymbol}</span>
            <span className="text-muted-foreground">Timeframe</span>
            <span className="font-medium">{preview.nativeTimeframe ? TIMEFRAME_LABELS[preview.nativeTimeframe] : "—"}</span>
            <span className="text-muted-foreground">Range</span>
            <span>{preview.range ? formatRange(preview.range.from, preview.range.to) : "—"}</span>
            <span className="text-muted-foreground">Candles</span>
            <span>
              {preview.rowCounts.valid.toLocaleString()} valid
              {preview.rowCounts.rejected > 0 && ` · ${preview.rowCounts.rejected.toLocaleString()} rejected`}
            </span>
            {preview.quality && (
              <>
                <span className="text-muted-foreground">Coverage</span>
                <span>{preview.quality.coveragePercent}%</span>
              </>
            )}
          </div>

          {preview.state === "READY_WITH_WARNINGS" && preview.issues.length > 0 && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              {preview.issues.map((issue, i) => (
                <p key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {issue}
                </p>
              ))}
            </div>
          )}

          {overlapping && overlapping.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              <p className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                This overlaps {overlapping.length} existing import{overlapping.length > 1 ? "s" : ""}:
              </p>
              <ul className="space-y-0.5 pl-5">
                {overlapping.map((o) => (
                  <li key={o.id}>
                    {o.canonicalSymbol} {o.nativeTimeframe} · {formatRange(new Date(o.rangeFrom).getTime(), new Date(o.rangeTo).getTime())}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">Both will be kept — the newest import wins for any overlapping candle.</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={confirming}>
              Cancel
            </Button>
            {overlapping && overlapping.length > 0 ? (
              <Button type="button" size="sm" className="gap-1.5" onClick={() => confirm(true)} disabled={confirming}>
                {confirming && <Loader2 className="size-3.5 animate-spin" />}
                Import Anyway
              </Button>
            ) : (
              <Button type="button" size="sm" className="gap-1.5" onClick={() => confirm(false)} disabled={confirming}>
                {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {confirming ? "Importing…" : "Import"}
              </Button>
            )}
          </div>
        </div>
      )}

      {!file && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
