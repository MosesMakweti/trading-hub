import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getUserPropFirmDetail } from "@/server/services/prop-firms.service";
import { listMediaForOwners } from "@/server/services/media.service";
import { collectAccountIds, collectEvidenceOwnerIds, toUserPropFirmDTO } from "@/server/services/prop-firms.mapper";
import { getLedgerDerivedBalances } from "@/server/services/account-ledger.service";
import { FadeIn } from "@/components/shared/motion";
import { CompanyWorkspace } from "@/components/prop-firms/company-workspace/company-workspace";

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

  const [mediaByOwnerId, ledgerBalanceByAccountId] = await Promise.all([
    listMediaForOwners(user.id, "PROP_FIRM_MILESTONE", collectEvidenceOwnerIds([firmRaw])),
    getLedgerDerivedBalances(collectAccountIds([firmRaw])),
  ]);
  const firm = toUserPropFirmDTO(firmRaw, mediaByOwnerId, ledgerBalanceByAccountId);

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <CompanyWorkspace firm={firm} />
    </FadeIn>
  );
}
