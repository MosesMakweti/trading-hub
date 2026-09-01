import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getUserPropFirmDetail } from "@/server/services/prop-firms.service";
import { listMediaForOwners } from "@/server/services/media.service";
import {
  collectAccountIds,
  collectEvidenceOwnerIds,
  toMappingTemplateDTO,
  toUserPropFirmDTO,
} from "@/server/services/prop-firms.mapper";
import { getLedgerDerivedBalances, getLedgerEventsForAccounts } from "@/server/services/account-ledger.service";
import { listMappingTemplates } from "@/server/services/prop-firm-import-mapping.service";
import { FadeIn } from "@/components/shared/motion";
import { CompanyWorkspace } from "@/components/prop-firms/company-workspace/company-workspace";
import { buildOverviewAccountInputs } from "@/domain/prop-firms/overview-series";

export default async function CompanyWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  let firmRaw;
  try {
    firmRaw = await getUserPropFirmDetail(user.id, id);
  } catch {
    notFound();
  }

  const accountIds = collectAccountIds([firmRaw]);
  const [mediaByOwnerId, ledgerBalanceByAccountId, mappingTemplatesRaw, ledgerEventsByAccount] = await Promise.all([
    listMediaForOwners(user.id, "PROP_FIRM_MILESTONE", collectEvidenceOwnerIds([firmRaw])),
    getLedgerDerivedBalances(accountIds),
    listMappingTemplates(user.id),
    getLedgerEventsForAccounts(accountIds),
  ]);
  const firm = toUserPropFirmDTO(firmRaw, mediaByOwnerId, ledgerBalanceByAccountId);
  const mappingTemplates = mappingTemplatesRaw.map(toMappingTemplateDTO);

  const overviewAccounts = buildOverviewAccountInputs([firm], ledgerEventsByAccount);

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <CompanyWorkspace firm={firm} mappingTemplates={mappingTemplates} overviewAccounts={overviewAccounts} />
    </FadeIn>
  );
}
