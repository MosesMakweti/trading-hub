import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, ShieldAlert, Trash2, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import { accountRoiPercent } from "@/domain/prop-firms/metrics";
import { deletePropFirmAccountAction } from "@/actions/prop-firms.actions";
import { CsvImportButton } from "@/components/prop-firms/import/csv-import-button";
import type { MappingTemplateDTO, PropFirmAccountDTO, UserPropFirmDTO } from "@/types/prop-firms";

const MODEL_LABELS: Record<string, string> = {
  ONE_PHASE: "One-phase",
  TWO_PHASE: "Two-phase",
  THREE_PHASE: "Three-phase",
  INSTANT_FUNDED: "Instant funded",
  CUSTOM: "Custom",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  ACTIVE: "secondary",
  PASSED: "success",
  FAILED: "danger",
  BREACHED: "danger",
  FUNDED: "success",
  ARCHIVED: "outline",
};

function currentStage(account: PropFirmAccountDTO) {
  return account.stages.find((s) => s.status === "ACTIVE") ?? null;
}

function lastActivity(account: PropFirmAccountDTO): string {
  const dates = account.milestones.map((m) => m.achievedAt);
  if (dates.length === 0) return account.createdAt;
  return dates.reduce((latest, d) => (d > latest ? d : latest), dates[0]);
}

function AccountCard({
  account,
  firmId,
  mappingTemplates,
}: {
  account: PropFirmAccountDTO;
  firmId: string;
  mappingTemplates: MappingTemplateDTO[];
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const stage = currentStage(account);
  const pnl = account.currentBalance != null ? account.currentBalance - account.startingBalance : null;
  const roi = pnl != null ? accountRoiPercent(pnl, account.startingBalance) : null;
  const isAtRisk = account.status === "ACTIVE" && account.currentBalance != null && account.currentBalance < account.startingBalance;
  const isBreached = account.status === "BREACHED";

  function handleDelete() {
    startDelete(async () => {
      const result = await deletePropFirmAccountAction(account.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Account deleted.");
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{account.displayName}</span>
            <Badge variant={STATUS_VARIANT[account.status] ?? "secondary"}>{account.status}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatCurrency(account.accountSize)} · {MODEL_LABELS[account.modelType] ?? account.modelType}
            {stage ? ` · ${stage.name}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/prop-firms/${firmId}/accounts/${account.id}`} />}
            aria-label={`Open ${account.displayName}`}
          >
            <ArrowUpRight className="size-4" />
            Open account
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            onClick={() => setConfirmDelete(true)}
            title="Delete account"
            aria-label={`Delete ${account.displayName}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {(isAtRisk || isBreached) && (
        <div className="flex flex-wrap gap-2">
          {isAtRisk && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <AlertTriangle className="size-3" /> At risk
            </span>
          )}
          {isBreached && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
              <ShieldAlert className="size-3" /> Breached
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <Field label="Balance" value={account.currentBalance != null ? formatCurrency(account.currentBalance) : "—"} />
        <Field
          label="P&L"
          value={pnl != null ? formatSignedCurrency(pnl) : "—"}
          tone={pnl == null || pnl === 0 ? undefined : pnl > 0 ? "text-success" : "text-danger"}
        />
        <Field
          label="ROI"
          value={roi != null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
          tone={roi == null || roi === 0 ? undefined : roi > 0 ? "text-success" : "text-danger"}
        />
        <Field label="Stage progress" value="Unavailable" hint="Live rule tracking not yet enabled" />
        <Field label="Profit target remaining" value="Unavailable" hint="Live rule tracking not yet enabled" />
        <Field label="Daily loss remaining" value="Unavailable" hint="Live rule tracking not yet enabled" />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Last activity {formatDate(lastActivity(account))}</span>
        <CsvImportButton
          accountId={account.id}
          accountName={account.displayName}
          mappingTemplates={mappingTemplates}
          variant="outline"
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this account?"
        description={`"${account.displayName}" will be removed from Prop Firms and account selectors. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Field({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("text-sm font-medium", tone, value === "Unavailable" && "text-muted-foreground italic")}>
        {value}
      </div>
    </div>
  );
}

export function AccountsTab({
  firm,
  mappingTemplates,
}: {
  firm: UserPropFirmDTO;
  mappingTemplates: MappingTemplateDTO[];
}) {
  if (firm.accounts.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="No purchased accounts yet"
        description={`Add a purchased account for ${firm.companyName} to start tracking its stages, rules, and performance.`}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {firm.accounts.map((account) => (
        <AccountCard key={account.id} account={account} firmId={firm.id} mappingTemplates={mappingTemplates} />
      ))}
    </div>
  );
}
