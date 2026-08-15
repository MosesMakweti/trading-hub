"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import {
  previewAllocationAction,
  removeExecutionAction,
  upsertExecutionAction,
  type AllocationPreviewDTO,
} from "@/actions/trade-executions.actions";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";

const RISK_ENTRY_MODES = { PERCENT: "% Risk", AMOUNT: "$ Amount", FIXED_SIZE: "Fixed size" };
const RISK_BASES = { CURRENT_BALANCE: "Current balance", CURRENT_EQUITY: "Current equity", STAGE_STARTING_BALANCE: "Stage starting balance" };
const STATUSES = { PLANNED: "Planned", OPEN: "Open", CLOSED: "Closed", CANCELLED: "Cancelled" };

type Draft = {
  riskEntryMode: string;
  riskBasis: string;
  riskInputValue: string;
  actualEntry: string;
  actualExit: string;
  actualLotSize: string;
  actualContractQty: string;
  grossPnl: string;
  commission: string;
  swapFinancing: string;
  otherFees: string;
  actualR: string;
  status: string;
  executionNotes: string;
};

function draftFromExecution(execution: ExecutionDTO | undefined): Draft {
  return {
    riskEntryMode: execution?.riskEntryMode ?? "PERCENT",
    riskBasis: execution?.riskBasis ?? "CURRENT_BALANCE",
    riskInputValue: execution ? String(execution.riskInputValue) : "1",
    actualEntry: execution?.actualEntry != null ? String(execution.actualEntry) : "",
    actualExit: execution?.actualExit != null ? String(execution.actualExit) : "",
    actualLotSize: execution?.actualLotSize != null ? String(execution.actualLotSize) : "",
    actualContractQty: execution?.actualContractQty != null ? String(execution.actualContractQty) : "",
    grossPnl: execution?.grossPnl != null ? String(execution.grossPnl) : "",
    commission: execution?.commission != null ? String(execution.commission) : "",
    swapFinancing: execution?.swapFinancing != null ? String(execution.swapFinancing) : "",
    otherFees: execution?.otherFees != null ? String(execution.otherFees) : "",
    actualR: execution?.actualR != null ? String(execution.actualR) : "",
    status: execution?.status ?? "PLANNED",
    executionNotes: execution?.executionNotes ?? "",
  };
}

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function AccountAllocationRow({
  tradeId,
  account,
  execution,
  onRemoved,
}: {
  tradeId: string;
  account: AccountAllocationSelectorDTO;
  execution: ExecutionDTO | undefined;
  onRemoved: () => void;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFromExecution(execution));
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<AllocationPreviewDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const inactiveAccount = account.status !== "ACTIVE" || !account.currentStageId;

  useEffect(() => {
    if (!editable) return;
    const timeout = setTimeout(() => {
      setPreviewLoading(true);
      previewAllocationAction(tradeId, {
        propFirmAccountId: account.id,
        riskEntryMode: draft.riskEntryMode,
        riskBasis: draft.riskBasis,
        riskInputValue: toNumberOrNull(draft.riskInputValue) ?? 0,
      }).then((result) => {
        setPreviewLoading(false);
        if (result.success) {
          setPreview(result.preview);
        }
      });
    }, 400);
    return () => clearTimeout(timeout);
  }, [draft.riskEntryMode, draft.riskBasis, draft.riskInputValue, account.id, tradeId, editable]);

  function handleSave() {
    startTransition(async () => {
      const result = await upsertExecutionAction(tradeId, {
        propFirmAccountId: account.id,
        riskEntryMode: draft.riskEntryMode,
        riskBasis: draft.riskBasis,
        riskInputValue: toNumberOrNull(draft.riskInputValue) ?? 0,
        actualEntry: toNumberOrNull(draft.actualEntry),
        actualExit: toNumberOrNull(draft.actualExit),
        actualLotSize: toNumberOrNull(draft.actualLotSize),
        actualContractQty: toNumberOrNull(draft.actualContractQty),
        grossPnl: toNumberOrNull(draft.grossPnl),
        commission: toNumberOrNull(draft.commission),
        swapFinancing: toNumberOrNull(draft.swapFinancing),
        otherFees: toNumberOrNull(draft.otherFees),
        actualR: toNumberOrNull(draft.actualR),
        status: draft.status,
        executionNotes: draft.executionNotes.trim() || null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Allocation saved.");
      router.refresh();
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeExecutionAction(tradeId, account.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Allocation removed.");
      onRemoved();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <PropFirmLogo name={account.companyName} logoUrl={account.logoUrl} accentColor={account.accentColor} className="size-8" />
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {account.displayName}
              <Badge variant="outline">{account.marketCategory}</Badge>
              {account.currentStageName && <Badge variant="secondary">{account.currentStageName}</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {account.companyName} · {formatCurrency(account.startingBalance)}
            </div>
          </div>
        </div>
        {editable && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove allocation" onClick={handleRemove} disabled={isPending}>
            <X />
          </Button>
        )}
      </div>

      {inactiveAccount && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          This account is {account.status.toLowerCase()} or has no active stage — allocations can&apos;t be saved.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Risk type</label>
          <Select items={RISK_ENTRY_MODES} value={draft.riskEntryMode} onValueChange={(v) => v && setDraft((d) => ({ ...d, riskEntryMode: v }))} disabled={!editable}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(RISK_ENTRY_MODES).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Risk basis</label>
          <Select items={RISK_BASES} value={draft.riskBasis} onValueChange={(v) => v && setDraft((d) => ({ ...d, riskBasis: v }))} disabled={!editable}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(RISK_BASES).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Risk value</label>
          <Input type="number" step="0.01" value={draft.riskInputValue} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, riskInputValue: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Status</label>
          <Select items={STATUSES} value={draft.status} onValueChange={(v) => v && setDraft((d) => ({ ...d, status: v }))} disabled={!editable}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUSES).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        {previewLoading ? (
          <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Calculating…</span>
        ) : preview ? (
          <>
            <span>
              Planned risk: <span className="font-medium text-foreground">{formatCurrency(preview.plannedRiskAmount)}</span>
            </span>
            <span>
              Position size:{" "}
              <span className="font-medium text-foreground">
                {preview.positionSize.kind === "computed"
                  ? `${preview.positionSize.positionSize?.toFixed(2)} ${preview.positionSize.unit?.toLowerCase()}`
                  : "needs instrument data"}
              </span>
            </span>
            {preview.plannedR != null && (
              <span>
                Planned R: <span className="font-medium text-foreground">{preview.plannedR.toFixed(2)}R</span>
              </span>
            )}
          </>
        ) : (
          <span>Enter a risk value to preview.</span>
        )}
      </div>

      {preview && preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w) => (
            <div
              key={w.code}
              className={`rounded-lg px-3 py-1.5 text-xs ${w.severity === "hard_block" ? "border border-danger/30 bg-danger/10 text-danger" : "border border-warning/30 bg-warning/10 text-warning"}`}
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Actual entry</label>
          <Input type="number" step="any" value={draft.actualEntry} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, actualEntry: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Actual exit</label>
          <Input type="number" step="any" value={draft.actualExit} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, actualExit: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{account.marketCategory === "FUTURES" ? "Contracts" : "Lot size"}</label>
          <Input
            type="number"
            step="any"
            value={account.marketCategory === "FUTURES" ? draft.actualContractQty : draft.actualLotSize}
            disabled={!editable}
            onChange={(e) =>
              setDraft((d) => (account.marketCategory === "FUTURES" ? { ...d, actualContractQty: e.target.value } : { ...d, actualLotSize: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Gross PnL</label>
          <Input type="number" step="0.01" value={draft.grossPnl} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, grossPnl: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Commission</label>
          <Input type="number" step="0.01" value={draft.commission} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, commission: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Swap/financing</label>
          <Input type="number" step="0.01" value={draft.swapFinancing} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, swapFinancing: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Other fees</label>
          <Input type="number" step="0.01" value={draft.otherFees} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, otherFees: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Actual R (if gross PnL unknown)</label>
          <Input type="number" step="0.01" value={draft.actualR} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, actualR: e.target.value }))} />
        </div>
      </div>

      {execution?.isPnlEstimated && (
        <div className="text-[11px] text-muted-foreground italic">
          Net PnL is estimated from actual R × planned risk — enter gross PnL once confirmed to replace it.
        </div>
      )}

      <Textarea
        rows={2}
        placeholder="Execution notes"
        value={draft.executionNotes}
        disabled={!editable}
        onChange={(e) => setDraft((d) => ({ ...d, executionNotes: e.target.value }))}
      />

      {editable && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save allocation"}
          </Button>
        </div>
      )}
    </div>
  );
}
