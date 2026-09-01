"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatDate } from "@/components/prop-firms/format";
import { CsvImportButton } from "@/components/prop-firms/import/csv-import-button";
import {
  previewRollbackPropFirmImportAction,
  rollbackPropFirmImportBatchAction,
} from "@/actions/prop-firm-import.actions";
import type { ImportBatchDTO, MappingTemplateDTO, PropFirmAccountDTO } from "@/types/prop-firms";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const PLATFORM_LABELS: Record<string, string> = {
  MT4: "MetaTrader 4",
  MT5: "MetaTrader 5",
  CTRADER: "cTrader",
  NINJATRADER: "NinjaTrader",
  TRADOVATE: "Tradovate",
  GENERIC_CSV: "Generic CSV",
};

interface PendingRollback {
  batchId: string;
  fileName: string;
  executions: number;
  transactions: number;
  payouts: number;
}

export function ImportTab({
  account,
  batches,
  mappingTemplates,
}: {
  account: PropFirmAccountDTO;
  batches: ImportBatchDTO[];
  mappingTemplates: MappingTemplateDTO[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingRollback | null>(null);
  const [isRollingBack, startRollback] = useTransition();

  async function openRollback(batch: ImportBatchDTO) {
    const res = await previewRollbackPropFirmImportAction(batch.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setPending({
      batchId: batch.id,
      fileName: res.preview.fileName,
      executions: res.preview.executionsToRemove,
      transactions: res.preview.transactionsToRemove,
      payouts: res.preview.payoutsToRemove,
    });
  }

  function confirmRollback() {
    if (!pending) return;
    startRollback(async () => {
      const res = await rollbackPropFirmImportBatchAction({ batchId: pending.batchId });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Import rolled back.");
      setPending(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Statement imports</h3>
          <p className="text-xs text-muted-foreground">
            Upload broker statements (CSV, Excel, HTML or XML) to auto-fill trades, balance, and payouts for this
            account.
          </p>
        </div>
        <CsvImportButton
          accountId={account.id}
          accountName={account.displayName}
          mappingTemplates={mappingTemplates}
        />
      </div>

      {batches.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No imports yet"
          description="Import an MT4, MT5, cTrader, NinjaTrader, Tradovate or generic broker statement to populate this account from your real records."
        />
      ) : (
        <div className="space-y-1.5">
          {batches.map((batch) => {
            const rolledBack = batch.status === "ROLLED_BACK";
            return (
              <div
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="truncate">{batch.fileName}</span>
                    <Badge variant="outline">{PLATFORM_LABELS[batch.platform] ?? batch.platform}</Badge>
                    <Badge variant="outline">{batch.fileFormat}</Badge>
                    {rolledBack && <Badge variant="outline">Rolled back</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(batch.createdAt)}
                    {batch.sheetOrTableName && ` · ${batch.sheetOrTableName}`} · {plural(batch.newTradesCount, "trade")} ·{" "}
                    {plural(batch.newExecutionsCount, "execution")}
                    {batch.newPayoutsCount > 0 && ` · ${plural(batch.newPayoutsCount, "payout")}`}
                    {batch.skippedDuplicatesCount > 0 && ` · ${batch.skippedDuplicatesCount} dupes`}
                    {batch.rejectedRowsCount > 0 && ` · ${batch.rejectedRowsCount} invalid`}
                  </div>
                </div>
                {!rolledBack && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => void openRollback(batch)}
                  >
                    <RotateCcw className="size-3.5" />
                    Roll back
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pending != null}
        onOpenChange={(next) => !next && setPending(null)}
        title="Roll back this import?"
        description={
          pending
            ? `Removes ${pending.executions} executions, ${pending.transactions} cash transactions, and ${pending.payouts} payouts from "${pending.fileName}", then rebuilds this account's imported trades from what's left. Manually entered data and other import batches are untouched.`
            : ""
        }
        confirmLabel="Roll back"
        variant="destructive"
        isPending={isRollingBack}
        onConfirm={confirmRollback}
      />
    </div>
  );
}
