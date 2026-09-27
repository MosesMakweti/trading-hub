"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  attachDatasetToRunAction,
  completeImportUploadAction,
  createImportUploadAction,
  deleteHistoricalDatasetAction,
  detachDatasetFromRunAction,
  previewImportUploadAction,
} from "@/actions/native-replay.actions";
import type { HistoricalImportReport } from "@/domain/native-replay/m1-dataset";
import type { HistoricalDatasetDTO } from "@/server/services/native-replay/historical-dataset.service";
import type { DatasetPinDTO } from "@/server/services/native-replay/backtest-dataset-pin.service";

export interface AttachOption {
  runId: string;
  runName: string;
  assetSymbol: string;
  period: string;
}

/**
 * Puts the file straight into storage with the presigned URL — the bytes
 * never go through an application request. Throws a readable error; a
 * network-level failure here almost always means the bucket's CORS policy
 * doesn't allow this site's origin yet.
 */
async function putToStorage(url: string, headers: Record<string, string>, file: File): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers, body: file });
  } catch {
    throw new Error("The upload to storage was blocked. The storage bucket must allow uploads from this site (CORS).");
  }
  if (!res.ok) throw new Error(`Storage refused the upload (${res.status}).`);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const day = (wallClock: string | null) => wallClock?.replace("T", " ") ?? "—";

function ReportView({ report }: { report: HistoricalImportReport }) {
  const rows: [string, string][] = [
    ["Symbol", report.symbol.symbol ? `${report.symbol.symbol}${report.symbol.sourceSymbol !== report.symbol.symbol ? ` (broker: ${report.symbol.sourceSymbol})` : ""}` : "—"],
    ["Source", "MT5 M1 historical data"],
    ["Range", report.range ? `${day(report.range.firstBar)} → ${day(report.range.lastBar)}` : "—"],
    ["Valid bars", fmt(report.counts.bars)],
    ["Duplicates", `${fmt(report.counts.exactDuplicatesCollapsed)} identical collapsed · ${fmt(report.counts.conflictingDuplicates)} conflicting`],
    ["Detected gaps", `${fmt(report.gaps.total)} (weekend ${report.gaps.byKind.WEEKEND}, no-tick ${report.gaps.byKind.SHORT}, daily break ${report.gaps.byKind.RECURRING_DAILY}, intraday ${report.gaps.byKind.INTRADAY}, multi-day ${report.gaps.byKind.MULTI_DAY})`],
    ["Invalid OHLC", fmt(report.counts.invalidOhlc)],
    ["Invalid rows", fmt(report.counts.invalidRows)],
    ["Price precision", report.priceScale == null ? "—" : `${report.priceScale} decimals`],
    ["Time basis", "Broker/server time (as exported; UTC offset unknown)"],
    ["Volume", [report.volume.hasTickVolume && "tick volume", report.volume.hasRealVolume && "real volume", report.volume.hasSpread && "spread"].filter(Boolean).join(", ") || "none"],
  ];
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">
        {report.state === "INVALID" ? "Can't be imported" : report.reviewRecommended ? "Valid — review recommended" : report.state === "VALID_WITH_WARNINGS" ? "Valid, with notes" : "Valid"}
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {report.errors.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-destructive">
          {report.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {report.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {report.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {report.rowIssues.samples.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Row problems ({fmt(report.rowIssues.total)})</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs">
            {report.rowIssues.samples.map((s) => <li key={`${s.line}-${s.kind}`}>line {s.line}: {s.message}</li>)}
          </ul>
        </details>
      )}
      {report.gaps.largest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Largest gaps</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs">
            {report.gaps.largest.map((g) => <li key={g.from}>{day(g.from)} → {day(g.to)} · {fmt(g.minutes)} min · {g.kind.toLowerCase().replace("_", " ")}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function HistoricalDataPanel({
  datasets,
  pins,
  attachOptions,
}: {
  datasets: HistoricalDatasetDTO[];
  pins: DatasetPinDTO[];
  attachOptions: Record<string, AttachOption[]>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [symbol, setSymbol] = useState("");
  const [report, setReport] = useState<HistoricalImportReport | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [pinBusy, startPin] = useTransition();
  const [toDelete, setToDelete] = useState<HistoricalDatasetDTO | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function reset() {
    setFile(null);
    setReport(null);
    setSymbol("");
    setUploadId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Validate: (first time) get a presigned URL and upload directly to storage, then validate there. */
  async function validate() {
    if (!file) return;
    setBusy("preview");
    try {
      let id = uploadId;
      if (!id) {
        const created = await createImportUploadAction({ fileName: file.name, sizeBytes: file.size, symbol: symbol.trim() || null });
        if (!created.success) throw new Error(created.error);
        await putToStorage(created.uploadUrl, created.uploadHeaders, file);
        id = created.uploadId;
        setUploadId(id);
      }
      const res = await previewImportUploadAction({ uploadId: id, symbol: symbol.trim() || null });
      if (!res.success) throw new Error(res.error);
      setReport(res.report);
      // An invalid file (other than a missing symbol) ends the upload — a fixed file needs a new one.
      if (res.report.state === "INVALID" && res.report.symbol.symbol != null) setUploadId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function importDataset() {
    if (!uploadId) return;
    setBusy("import");
    try {
      const res = await completeImportUploadAction({ uploadId, symbol: symbol.trim() || null });
      if (!res.success) {
        if ("report" in res && res.report) setReport(res.report);
        setUploadId(null);
        throw new Error(res.error);
      }
      toast.success(`Imported ${fmt(res.dataset.barCount)} M1 bars.`);
      reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  function attach(datasetId: string, value: string) {
    const [runId, assetSymbol] = value.split("|");
    startPin(async () => {
      const res = await attachDatasetToRunAction({ runId, assetSymbol, datasetId });
      if (!res.success) toast.error(res.error);
      else {
        toast.success(`Attached — ${res.coveredDays} day${res.coveredDays === 1 ? "" : "s"} of the run have data.`);
        router.refresh();
      }
    });
  }

  function detach(pin: DatasetPinDTO) {
    startPin(async () => {
      const res = await detachDatasetFromRunAction({ runId: pin.runId, assetSymbol: pin.assetSymbol });
      if (!res.success) toast.error(res.error);
      else router.refresh();
    });
  }

  function handleDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteHistoricalDatasetAction(toDelete.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Dataset deleted.");
      setToDelete(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section aria-labelledby="import-heading" className="space-y-4 rounded-xl border border-border bg-card/60 p-4">
        <h2 id="import-heading" className="font-medium">Import MT5 M1 export</h2>
        <p className="text-xs text-muted-foreground">
          In MT5: View → Symbols → Bars → M1 → Export Bars. The file goes straight to private storage, is validated
          there, and is deleted once imported. Timestamps are kept exactly as exported (broker/server time).
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="nr-file">MT5 Market Bars export (.csv, .txt or no extension)</Label>
          <Input
            id="nr-file"
            ref={fileRef}
            type="file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
              setUploadId(null);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nr-symbol">Broker symbol (if not in the file name)</Label>
          <Input id="nr-symbol" value={symbol} maxLength={32} placeholder="e.g. EURUSD.a" onChange={(e) => setSymbol(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!file || busy != null} onClick={validate}>
            {busy === "preview" ? <Loader2 className="animate-spin" /> : null}
            Validate
          </Button>
          <Button type="button" disabled={!uploadId || busy != null || report == null || report.state === "INVALID"} onClick={importDataset}>
            {busy === "import" ? <Loader2 className="animate-spin" /> : <Upload />}
            Import
          </Button>
        </div>
        {report && <ReportView report={report} />}
      </section>

      <section aria-labelledby="datasets-heading" className="space-y-3">
        <h2 id="datasets-heading" className="font-medium">Datasets</h2>
        {datasets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Database className="size-5" />
            No historical data yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {datasets.map((d) => (
              <li key={d.id} className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {d.symbol} <span className="text-xs text-muted-foreground">· MT5 M1{d.sourceSymbol !== d.symbol ? ` · broker ${d.sourceSymbol}` : ""}</span>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {day(d.firstBar)} → {day(d.lastBar)} · {fmt(d.barCount)} bars
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.status === "READY" ? "Ready" : d.status === "IMPORTING" ? "Importing…" : `Failed: ${d.failureReason ?? "unknown error"}`}
                      {d.originalFileName ? ` · ${d.originalFileName}` : ""}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${d.symbol} dataset`} onClick={() => setToDelete(d)}>
                    <Trash2 />
                  </Button>
                </div>
                {d.status === "READY" && (
                  <div className="space-y-1.5 text-xs">
                    {pins.filter((p) => p.datasetId === d.id).map((p) => (
                      <p key={p.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          Used by <span className="font-medium">{p.runName}</span> · {p.assetSymbol}
                          {p.frozen ? " · replay started (locked)" : ""}
                          {p.runStatus !== "ACTIVE" ? ` · ${p.runStatus.toLowerCase()}` : ""}
                        </span>
                        {!p.frozen && p.runStatus === "ACTIVE" && (
                          <button type="button" className="underline underline-offset-2" disabled={pinBusy} onClick={() => detach(p)}>
                            Detach
                          </button>
                        )}
                      </p>
                    ))}
                    {(attachOptions[d.id] ?? []).length > 0 && (
                      <label className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">Attach to</span>
                        <select
                          className="rounded-md border border-border bg-background px-2 py-1"
                          defaultValue=""
                          disabled={pinBusy}
                          aria-label={`Attach ${d.symbol} dataset to a run`}
                          onChange={(e) => {
                            if (e.target.value) attach(d.id, e.target.value);
                            e.target.value = "";
                          }}
                        >
                          <option value="">choose a run…</option>
                          {attachOptions[d.id].map((o) => (
                            <option key={`${o.runId}|${o.assetSymbol}`} value={`${o.runId}|${o.assetSymbol}`}>
                              {o.runName} · {o.assetSymbol} ({o.period})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
                {d.status === "READY" && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Validation report</summary>
                    <div className="mt-2">
                      <ReportView report={d.report} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this dataset?"
        description={toDelete ? `${toDelete.symbol} (${fmt(toDelete.barCount)} M1 bars) will be permanently deleted. This can't be undone.` : ""}
        confirmLabel="Delete dataset"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
