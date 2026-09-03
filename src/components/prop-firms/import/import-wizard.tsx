"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  confirmPropFirmImportAction,
  inspectPropFirmImportFileAction,
  previewPropFirmImportAction,
} from "@/actions/prop-firm-import.actions";
import { shouldAutoSelect } from "@/domain/prop-firms/import/adapter-registry";
import type { ColumnMapping, ImportPlatform } from "@/domain/prop-firms/import/types";
import type { TransactionClassification } from "@/domain/prop-firms/import/classify-transaction";
import type {
  ConfirmResult,
  InspectedTable,
  PreviewSummary,
} from "@/server/services/prop-firm-import.service";
import type { MappingTemplateDTO } from "@/types/prop-firms";
import { ImportDropzone, type LoadedFile } from "./import-dropzone";
import { TableSelect } from "./table-select";
import { PlatformSelect } from "./platform-select";
import { ColumnMappingForm, REQUIRED_MAPPING_KEYS } from "./column-mapping-form";
import { TimezoneSelect, browserTimezone } from "./timezone-select";
import { ImportPreview } from "./import-preview";

type Step = "UPLOAD" | "TABLE" | "PLATFORM" | "MAPPING" | "TIMEZONE" | "PREVIEW" | "DONE";

const STEP_LABELS: Record<Step, string> = {
  UPLOAD: "File",
  TABLE: "Sheet / table",
  PLATFORM: "Platform",
  MAPPING: "Columns",
  TIMEZONE: "Timezone",
  PREVIEW: "Review",
  DONE: "Done",
};

export function ImportWizard({
  accountId,
  mappingTemplates,
  onClose,
}: {
  accountId: string;
  mappingTemplates: MappingTemplateDTO[];
  onClose: () => void;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("UPLOAD");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileFormat, setFileFormat] = useState<string | null>(null);
  const [tables, setTables] = useState<InspectedTable[]>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tableAutoSelected, setTableAutoSelected] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [platform, setPlatform] = useState<ImportPlatform | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [timezone, setTimezone] = useState<string>(browserTimezone());
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [overrides, setOverrides] = useState<Record<string, TransactionClassification>>({});
  const [profitSplitOverride, setProfitSplitOverride] = useState("");
  const [result, setResult] = useState<ConfirmResult | null>(null);

  const [inspecting, startInspect] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [confirming, startConfirm] = useTransition();

  const selectedTable = tables.find((t) => t.id === tableId) ?? null;
  const detected = selectedTable?.detected ?? [];

  const needsTable = tables.length > 1;
  const needsMapping = platform === "GENERIC_CSV";
  const visibleSteps: Step[] = [
    "UPLOAD",
    ...(needsTable ? (["TABLE"] as Step[]) : []),
    "PLATFORM",
    ...(needsMapping ? (["MAPPING"] as Step[]) : []),
    "TIMEZONE",
    "PREVIEW",
    "DONE",
  ];
  const stepIndex = visibleSteps.indexOf(step);

  /** Adopt a table's headers, mapping guess, and platform detection. */
  function applyTable(t: InspectedTable) {
    setHeaders(t.headers);
    setMapping(t.bestGuessMapping);
    const auto = shouldAutoSelect(t.detected);
    setAutoSelected(auto);
    setPlatform(auto ? t.detected[0].platform : null);
    setPreview(null);
  }

  function inspect(loaded: LoadedFile) {
    setFile(loaded);
    startInspect(async () => {
      const res = await inspectPropFirmImportFileAction({
        fileName: loaded.fileName,
        fileContentBase64: loaded.contentBase64,
        mimeType: loaded.mimeType,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const { inspection } = res;
      setFileFormat(inspection.fileFormat);
      setTables(inspection.tables);
      setTableId(inspection.selectedTableId);
      setTableAutoSelected(inspection.tables.length > 1);
      const selected =
        inspection.tables.find((t) => t.id === inspection.selectedTableId) ?? inspection.tables[0];
      if (selected) applyTable(selected);
      if (inspection.warnings.length > 0) inspection.warnings.forEach((w) => toast.message(w));
      setStep(inspection.tables.length > 1 ? "TABLE" : "PLATFORM");
    });
  }

  function chooseTable(id: string) {
    setTableId(id);
    setTableAutoSelected(false);
    const t = tables.find((x) => x.id === id);
    if (t) applyTable(t);
  }

  function runPreview() {
    if (!file || !platform) return;
    startPreview(async () => {
      const res = await previewPropFirmImportAction({
        accountId,
        platform,
        fileName: file.fileName,
        fileContentBase64: file.contentBase64,
        mimeType: file.mimeType,
        tableId: tableId ?? undefined,
        timezone,
        mapping: needsMapping ? mapping : undefined,
        profitSplitPercentOverride: profitSplitOverride ? Number(profitSplitOverride) : undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setPreview(res.preview);
      setStep("PREVIEW");
    });
  }

  function confirmImport() {
    if (!file || !platform) return;
    startConfirm(async () => {
      const res = await confirmPropFirmImportAction({
        accountId,
        platform,
        fileName: file.fileName,
        fileContentBase64: file.contentBase64,
        mimeType: file.mimeType,
        tableId: tableId ?? undefined,
        timezone,
        mapping: needsMapping ? mapping : undefined,
        classificationOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        profitSplitPercentOverride: profitSplitOverride ? Number(profitSplitOverride) : undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setResult(res.result);
      setStep("DONE");
      toast.success("Import confirmed.");
      router.refresh();
    });
  }

  // Recompute the preview whenever the user lands back on PREVIEW after
  // changing an upstream choice — keeps the shown numbers honest.
  useEffect(() => {
    if (step === "PREVIEW" && !preview && !previewing) runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Re-run the preview (debounced) when the user enters/edits a profit-split %
  // for an account that has none configured, so the split figures populate.
  useEffect(() => {
    if (step !== "PREVIEW" || !profitSplitOverride) return;
    const h = setTimeout(() => {
      setPreview(null);
      runPreview();
    }, 450);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitSplitOverride]);

  const requiredMapped = REQUIRED_MAPPING_KEYS.every((k) => Boolean(mapping[k]));

  function canGoNext(): boolean {
    switch (step) {
      case "UPLOAD":
        return Boolean(file) && !inspecting;
      case "TABLE":
        return Boolean(tableId);
      case "PLATFORM":
        return Boolean(platform);
      case "MAPPING":
        return requiredMapped;
      case "TIMEZONE":
        return Boolean(timezone);
      default:
        return true;
    }
  }

  function goNext() {
    if (!canGoNext()) return;
    const next = visibleSteps[stepIndex + 1];
    if (next === "PREVIEW") {
      setPreview(null);
      setStep("PREVIEW");
    } else if (next) {
      setStep(next);
    }
  }

  function goBack() {
    const prev = visibleSteps[stepIndex - 1];
    if (prev) {
      if (step === "PREVIEW") setPreview(null);
      setStep(prev);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1" aria-hidden>
        {visibleSteps.slice(0, -1).map((s, i) => (
          <div
            key={s}
            className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Step {Math.min(stepIndex + 1, visibleSteps.length - 1)} of {visibleSteps.length - 1} · {STEP_LABELS[step]}
        {fileFormat && step !== "UPLOAD" && ` · ${fileFormat} file`}
      </p>

      <div className="min-h-64">
        {step === "UPLOAD" && (
          <div className="space-y-3">
            <ImportDropzone loadedFileName={file?.fileName ?? null} onLoaded={inspect} />
            {inspecting && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Scanning the file…
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Imported trades stay separate from your Journal, the global trade log, and the Performance Account —
              they only affect this prop-firm account&apos;s balance, payouts, and track record.
            </p>
          </div>
        )}

        {step === "TABLE" && (
          <TableSelect
            tables={tables}
            selectedId={tableId}
            autoSelected={tableAutoSelected}
            onSelect={chooseTable}
          />
        )}

        {step === "PLATFORM" && (
          <PlatformSelect
            detected={detected}
            selected={platform}
            autoSelected={autoSelected}
            onSelect={(p) => {
              setPlatform(p);
              setAutoSelected(false);
              setPreview(null);
            }}
          />
        )}

        {step === "MAPPING" && (
          <ColumnMappingForm headers={headers} mapping={mapping} onChange={setMapping} templates={mappingTemplates} />
        )}

        {step === "TIMEZONE" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Broker statements use local timestamps. Pick the timezone the export was generated in so trade times
              land correctly.
            </p>
            <TimezoneSelect value={timezone} onChange={setTimezone} />
          </div>
        )}

        {step === "PREVIEW" &&
          (previewing || !preview ? (
            <p className="flex items-center gap-1.5 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Building preview…
            </p>
          ) : (
            <ImportPreview
              preview={preview}
              overrides={overrides}
              onOverride={(dedupeKey, classification) =>
                setOverrides((prev) => ({ ...prev, [dedupeKey]: classification }))
              }
              profitSplitInput={
                preview.profitSplitRequired
                  ? { value: profitSplitOverride, onChange: setProfitSplitOverride }
                  : null
              }
            />
          ))}

        {step === "DONE" && result && (
          <div className="space-y-3 py-4 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-success/15">
              <Check className="size-5 text-success" />
            </div>
            <div>
              <p className="font-medium">Import complete</p>
              <p className="text-sm text-muted-foreground">
                {result.newTradesCount} trades · {result.newExecutionsCount} executions · {result.newPayoutsCount} payouts
                {result.skippedDuplicatesCount > 0 && ` · ${result.skippedDuplicatesCount} duplicates skipped`}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              You can roll this batch back any time from the Import tab.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        {step === "DONE" ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5"
            onClick={goBack}
            disabled={stepIndex === 0 || previewing || confirming}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
        )}

        {step === "PREVIEW" ? (
          <Button
            type="button"
            className="gap-1.5"
            onClick={confirmImport}
            disabled={
              !preview || previewing || confirming || (preview.profitSplitRequired && !profitSplitOverride)
            }
          >
            <Check className="size-3.5" />
            {confirming ? "Importing…" : "Confirm import"}
          </Button>
        ) : step === "DONE" ? (
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        ) : (
          <Button type="button" className="gap-1.5" onClick={goNext} disabled={!canGoNext()}>
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
