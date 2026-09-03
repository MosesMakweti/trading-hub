import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getAccountDetail } from "@/server/services/prop-firms.service";
import { listMediaForOwners } from "@/server/services/media.service";
import {
  toExecutionDTO,
  toImportBatchDTO,
  toLedgerEntryDTO,
  toMappingTemplateDTO,
  toPropFirmAccountDTO,
  toRuleHealthDTO,
  toTrackRecordDTO,
} from "@/server/services/prop-firms.mapper";
import { listExecutionsForAccount } from "@/server/services/trade-executions.service";
import { getAccountLedger, getLedgerDerivedBalances } from "@/server/services/account-ledger.service";
import { listImportBatches } from "@/server/services/prop-firm-import.service";
import { listMappingTemplates } from "@/server/services/prop-firm-import-mapping.service";
import { getAccountTrackRecord, getStageRuleHealth, getStageTrackRecord } from "@/server/services/prop-firms-health.service";
import { FadeIn } from "@/components/shared/motion";
import { AccountWorkspace } from "@/components/prop-firms/account-workspace/account-workspace";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const user = await requireUser();
  const { id, accountId } = await params;

  let accountRaw;
  try {
    accountRaw = await getAccountDetail(user.id, accountId);
  } catch {
    notFound();
  }
  if (accountRaw.userPropFirmId !== id) notFound();

  const ownerIds = [...accountRaw.milestones.map((m) => m.id), ...accountRaw.payouts.map((p) => p.id)];
  const [mediaByOwnerId, executionsRaw, ledgerRaw, trackRecordRaw, ruleHealthByStage] = await Promise.all([
    listMediaForOwners(user.id, "PROP_FIRM_MILESTONE", ownerIds),
    listExecutionsForAccount(user.id, accountId),
    getAccountLedger(user.id, accountId),
    getAccountTrackRecord(user.id, accountId),
    Promise.all(
      accountRaw.stages.map(async (stage) => [stage.id, await getStageRuleHealth(user.id, stage.id)] as const),
    ),
  ]);

  const ledgerBalanceByAccountId = await getLedgerDerivedBalances([accountId]);
  const [importBatchesRaw, mappingTemplatesRaw] = await Promise.all([
    listImportBatches(user.id, accountId),
    listMappingTemplates(user.id),
  ]);
  const account = toPropFirmAccountDTO(accountRaw, mediaByOwnerId, ledgerBalanceByAccountId);
  const executions = executionsRaw.map(toExecutionDTO);
  const ledger = ledgerRaw.map(toLedgerEntryDTO);
  const trackRecord = toTrackRecordDTO(trackRecordRaw);
  const importBatches = importBatchesRaw.map(toImportBatchDTO);
  const mappingTemplates = mappingTemplatesRaw.map(toMappingTemplateDTO);

  // Per-stage track records (spec §7: "switch between current stage /
  // previous stages / lifetime") — same computeTrackRecord math as the
  // lifetime summary above, just scoped to one stage's own ledger/executions.
  const stageTrackRecordEntries = await Promise.all(
    accountRaw.stages.map(async (stage) => [stage.id, toTrackRecordDTO(await getStageTrackRecord(user.id, stage.id))] as const),
  );
  const stageTrackRecords = Object.fromEntries(stageTrackRecordEntries);

  const ruleHealthByRuleId = new Map(
    ruleHealthByStage.flatMap(([stageId, results]) => {
      const stage = accountRaw.stages.find((s) => s.id === stageId);
      return results.map((result) => {
        const rule = stage?.rules.find((r) => r.id === result.ruleId);
        return [result.ruleId, toRuleHealthDTO(result, rule?.name ?? "Rule", rule?.ruleKey ?? "CUSTOM")] as const;
      });
    }),
  );

  const firm = accountRaw.userPropFirm;
  const firmSummary = {
    id: firm.id,
    companyName: firm.directoryEntry?.companyName ?? firm.customCompanyName ?? "Unnamed firm",
    logoUrl: firm.directoryEntry?.logoUrl ?? firm.customLogoUrl,
    accentColor: firm.directoryEntry?.accentColor ?? firm.customAccentColor,
  };

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <AccountWorkspace
        account={account}
        firm={firmSummary}
        executions={executions}
        ledger={ledger}
        trackRecord={trackRecord}
        stageTrackRecords={stageTrackRecords}
        ruleHealthByRuleId={Object.fromEntries(ruleHealthByRuleId)}
        importBatches={importBatches}
        mappingTemplates={mappingTemplates}
      />
    </FadeIn>
  );
}
