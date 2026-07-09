"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importTradesFromJson } from "@/actions/import.actions";
import type { ImportSummary } from "@/server/services/import.service";

export function ImportTradesForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, setIsPending] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsPending(true);
    setSummary(null);
    const text = await file.text();
    const result = await importTradesFromJson(text);
    setIsPending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setSummary(result.summary);
    toast.success(
      `Imported ${result.summary.imported} trade${result.summary.imported === 1 ? "" : "s"}.`,
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-3.5" />
        {isPending ? "Importing..." : "Import trades from JSON"}
      </Button>

      {summary && (
        <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
          <p>
            <span className="font-medium text-success">{summary.imported} imported</span> ·{" "}
            <span className="text-muted-foreground">{summary.skipped} skipped (duplicates)</span> ·{" "}
            <span className={summary.errored > 0 ? "text-danger" : "text-muted-foreground"}>
              {summary.errored} errors
            </span>
          </p>
          {summary.rows.some((r) => r.status !== "skipped") && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {summary.rows
                .filter((r) => r.status !== "skipped")
                .map((r) => (
                  <li key={r.index}>
                    Row {r.index + 1}: {r.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
