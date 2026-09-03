"use client";

import Link from "next/link";
import { AlertTriangle, Archive, ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { formatCurrency } from "@/components/journal/workspace/workspace-ui";
import type {
  ExecutionDTO,
  ImportBatchDTO,
  LedgerEntryDTO,
  MappingTemplateDTO,
  PropFirmAccountDTO,
  RuleHealthDTO,
  TrackRecordDTO,
} from "@/types/prop-firms";
import { ImportTab } from "./tabs/import-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { StagesTab } from "./tabs/stages-tab";
import { RulesTab } from "./tabs/rules-tab";
import { TradesTab } from "./tabs/trades-tab";
import { PayoutsTab } from "./tabs/payouts-tab";
import { MilestonesTab } from "./tabs/milestones-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { SettingsTab } from "./tabs/settings-tab";
import { LedgerTab } from "./tabs/ledger-tab";

export interface FirmSummary {
  id: string;
  companyName: string;
  logoUrl: string | null;
  accentColor: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  ACTIVE: "secondary",
  PASSED: "success",
  FAILED: "danger",
  BREACHED: "danger",
  FUNDED: "success",
  ARCHIVED: "outline",
};

export function AccountWorkspace({
  account,
  firm,
  executions,
  ledger,
  trackRecord,
  stageTrackRecords,
  ruleHealthByRuleId,
  importBatches,
  mappingTemplates,
}: {
  account: PropFirmAccountDTO;
  firm: FirmSummary;
  executions: ExecutionDTO[];
  ledger: LedgerEntryDTO[];
  trackRecord: TrackRecordDTO;
  stageTrackRecords: Record<string, TrackRecordDTO>;
  ruleHealthByRuleId: Record<string, RuleHealthDTO>;
  importBatches: ImportBatchDTO[];
  mappingTemplates: MappingTemplateDTO[];
}) {
  return (
    <div className="space-y-5">
      <Link
        href={`/prop-firms/${firm.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {firm.companyName}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} className="size-12" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{account.displayName}</h1>
              <Badge variant={STATUS_VARIANT[account.status] ?? "secondary"}>{account.status}</Badge>
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {formatCurrency(account.accountSize)} · {account.marketCategory} · {firm.companyName}
            </div>
          </div>
        </div>
      </div>

      {account.status === "ARCHIVED" && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Archive className="size-4 shrink-0" />
          This account is archived — it stays fully visible for history, but is excluded from active-account counts.
        </div>
      )}
      {account.status === "BREACHED" && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          This account was breached — its final stage history is preserved below.
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-max flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab account={account} trackRecord={trackRecord} ruleHealthByRuleId={ruleHealthByRuleId} ledger={ledger} />
        </TabsContent>
        <TabsContent value="stages" className="mt-4">
          <StagesTab account={account} ruleHealthByRuleId={ruleHealthByRuleId} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab account={account} ruleHealthByRuleId={ruleHealthByRuleId} />
        </TabsContent>
        <TabsContent value="trades" className="mt-4">
          <TradesTab account={account} executions={executions} lifetimeTrackRecord={trackRecord} stageTrackRecords={stageTrackRecords} />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab account={account} ledger={ledger} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab account={account} />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportTab account={account} batches={importBatches} mappingTemplates={mappingTemplates} />
        </TabsContent>
        <TabsContent value="milestones" className="mt-4">
          <MilestonesTab account={account} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab account={account} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab account={account} firmId={firm.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
