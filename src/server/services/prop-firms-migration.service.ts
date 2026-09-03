import { prisma } from "@/server/db";
import { postLedgerEntry } from "@/server/services/account-ledger.service";
import type { AccountStageType, PropFirmAccountStatus } from "@prisma/client";
import { MIGRATED_ACCOUNTS_FIRM_NAME } from "@/data/prop-firm-directory";

const LEGACY_STATUS_MAP: Record<string, PropFirmAccountStatus> = {
  ACTIVE: "ACTIVE",
  PASSED: "PASSED",
  FAILED: "FAILED",
  SUSPENDED: "ARCHIVED",
  CLOSED: "ARCHIVED",
};

const LEGACY_PHASE_MAP: Record<string, AccountStageType> = {
  PHASE_1: "PHASE_1",
  PHASE_2: "PHASE_2",
  MASTER: "MASTER_FUNDED",
};

/**
 * Lazy, idempotent backfill — the same pattern `archivePastActiveDays` uses
 * at the top of `/today`'s page load. The first time a user opens
 * /prop-firms, every pre-existing PROP_FIRM-kind TradingAccount that isn't
 * yet paired with a PropFirmAccount gets wrapped into one, under a single
 * custom "Migrated Accounts" UserPropFirm (created once, reused after). No
 * data is copied or deleted — the original TradingAccount row (and every
 * trade allocation against it) is untouched; the new PropFirmAccount just
 * points at it via `tradingAccountId`. Safe to call on every page load: once
 * every legacy account is linked, this is a single no-op query.
 */
export async function ensureLegacyPropFirmsMigrated(userId: string): Promise<void> {
  const unmigrated = await prisma.tradingAccount.findMany({
    where: { userId, kind: "PROP_FIRM", deletedAt: null, propFirmAccount: { is: null } },
  });
  if (unmigrated.length === 0) return;

  await prisma.$transaction(async (tx) => {
    let bucket = await tx.userPropFirm.findFirst({
      where: { userId, identityKind: "CUSTOM", customCompanyName: MIGRATED_ACCOUNTS_FIRM_NAME },
    });
    if (!bucket) {
      bucket = await tx.userPropFirm.create({
        data: {
          userId,
          identityKind: "CUSTOM",
          customCompanyName: MIGRATED_ACCOUNTS_FIRM_NAME,
          // Best-effort default — the old schema never tracked a market
          // category, so this can't be inferred; the trader can split these
          // out into the correct firm/category once migrated.
          marketCategory: "CFD",
          notes: "Auto-created to hold accounts from the old Accounts section until you assign the real prop firm.",
        },
      });
    }

    for (const legacy of unmigrated) {
      const accountSize = legacy.accountSize?.toNumber() ?? 0;
      const noteParts = [
        legacy.propFirmName ? `Originally recorded prop firm: ${legacy.propFirmName}` : null,
        legacy.notes,
      ].filter((s): s is string => Boolean(s));

      const account = await tx.propFirmAccount.create({
        data: {
          userId,
          userPropFirmId: bucket.id,
          tradingAccountId: legacy.id,
          displayName: legacy.name,
          marketCategory: "CFD",
          modelType: "CUSTOM",
          accountSize,
          startingBalance: accountSize,
          purchasePrice: legacy.purchaseCost?.toNumber() ?? null,
          status: LEGACY_STATUS_MAP[legacy.status] ?? "ACTIVE",
          notes: noteParts.length > 0 ? noteParts.join(" — ") : null,
        },
      });

      const stage = await tx.accountStage.create({
        data: {
          accountId: account.id,
          name: "Migrated stage",
          order: 1,
          type: legacy.phase ? LEGACY_PHASE_MAP[legacy.phase] : "CUSTOM",
          startingBalance: accountSize,
          startDate: legacy.createdAt,
          status: account.status === "ACTIVE" ? "ACTIVE" : "ARCHIVED",
        },
      });

      await tx.accountMilestone.create({
        data: {
          accountId: account.id,
          type: "ACCOUNT_PURCHASED",
          title: `${legacy.name} migrated from the old Accounts section`,
        },
      });

      // Same opening ledger entry createPropFirmAccount posts for a
      // brand-new account — a lazily-migrated legacy account needs its own
      // ledger history seeded too, or its currentBalance/track-record would
      // read as empty (see also prisma/backfill-prop-firm-ledger.mjs, the
      // one-off equivalent for accounts that already existed when this
      // ledger shipped).
      await postLedgerEntry(tx, {
        accountId: account.id,
        stageId: stage.id,
        eventType: "ACCOUNT_INITIALIZED",
        amount: accountSize,
        sourceType: "ACCOUNT_INIT",
        sourceId: account.id,
      });
    }
  });
}
