import { requireUser } from "@/server/guards";
import { ensureLegacyPropFirmsMigrated } from "@/server/services/prop-firms-migration.service";
import { listActiveDirectoryEntries } from "@/server/services/prop-firm-directory.service";
import { listUserPropFirms } from "@/server/services/prop-firms.service";
import { listMediaForOwners } from "@/server/services/media.service";
import { collectAccountIds, collectEvidenceOwnerIds, toUserPropFirmDTO } from "@/server/services/prop-firms.mapper";
import { getLedgerDerivedBalances } from "@/server/services/account-ledger.service";
import { FadeIn } from "@/components/shared/motion";
import { PropFirmsView } from "@/components/prop-firms/prop-firms-view";
import type { DirectoryEntryDTO } from "@/types/prop-firms";

export default async function PropFirmsPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const user = await requireUser();
  const { market } = await searchParams;
  const initialMarket = market === "FUTURES" ? "FUTURES" : "CFD";

  // Lazy, idempotent — wraps any pre-existing PROP_FIRM TradingAccount that
  // isn't yet paired with a PropFirmAccount into a "Migrated Accounts" firm.
  // No-ops once every legacy account has been migrated.
  await ensureLegacyPropFirmsMigrated(user.id);

  const [directory, firms] = await Promise.all([
    listActiveDirectoryEntries(),
    listUserPropFirms(user.id),
  ]);

  // One batched query for every certificate/evidence file across every
  // milestone and payout, rather than N+1 per-item requests. Same for
  // ledger-derived balances (currentBalance is never trusted from the
  // stored column here — see prop-firms.mapper.ts).
  const [mediaByOwnerId, ledgerBalanceByAccountId] = await Promise.all([
    listMediaForOwners(user.id, "PROP_FIRM_MILESTONE", collectEvidenceOwnerIds(firms)),
    getLedgerDerivedBalances(collectAccountIds(firms)),
  ]);

  const directoryDtos: DirectoryEntryDTO[] = directory.map((d) => ({
    id: d.id,
    companyName: d.companyName,
    slug: d.slug,
    logoUrl: d.logoUrl,
    markets: d.markets,
    website: d.website,
    accentColor: d.accentColor,
  }));

  const firmDtos = firms.map((f) => toUserPropFirmDTO(f, mediaByOwnerId, ledgerBalanceByAccountId));

  return (
    <FadeIn className="mx-auto max-w-7xl">
      <PropFirmsView directory={directoryDtos} firms={firmDtos} initialMarket={initialMarket} />
    </FadeIn>
  );
}
