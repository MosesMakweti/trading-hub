// One-off backfill: seeds an opening AccountLedgerEntry per existing
// PropFirmAccount so PropFirmAccount.currentBalance can become ledger-derived
// on read (see domain/prop-firms/track-record.ts, account-ledger.service.ts)
// without losing any pre-ledger manually-entered balance.
//
// For every account: one ACCOUNT_INITIALIZED entry for startingBalance, then
// (only when the stored currentBalance is set and differs from
// startingBalance) one CUSTOM_ADJUSTMENT entry carrying the difference, so
// the ledger-derived balance matches whatever the trader had manually
// entered before this phase shipped.
//
// Idempotent: uses the same (sourceType, sourceId, eventType) upsert key
// postLedgerEntry uses, so re-running this script is a no-op the second time.
//
// Run with: node --experimental-strip-types prisma/backfill-prop-firm-ledger.mjs
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function upsertLedgerEntry({ accountId, stageId, eventType, amount, balanceAfter, reason, sourceType, sourceId }) {
  const existing = await prisma.accountLedgerEntry.findUnique({
    where: { sourceType_sourceId_eventType: { sourceType, sourceId, eventType } },
  });
  if (existing) return existing;
  return prisma.accountLedgerEntry.create({
    data: { accountId, stageId, eventType, amount, balanceAfter, reason, sourceType, sourceId },
  });
}

async function main() {
  const accounts = await prisma.propFirmAccount.findMany({
    select: {
      id: true,
      startingBalance: true,
      currentBalance: true,
      stages: { orderBy: { order: "asc" }, take: 1, select: { id: true } },
    },
  });

  let initialized = 0;
  let adjusted = 0;

  for (const account of accounts) {
    const firstStageId = account.stages[0]?.id ?? null;
    const startingBalance = account.startingBalance;

    await upsertLedgerEntry({
      accountId: account.id,
      stageId: firstStageId,
      eventType: "ACCOUNT_INITIALIZED",
      amount: startingBalance,
      balanceAfter: startingBalance,
      reason: null,
      sourceType: "ACCOUNT_INIT",
      sourceId: account.id,
    });
    initialized += 1;

    if (account.currentBalance != null && !account.currentBalance.equals(startingBalance)) {
      const diff = account.currentBalance.minus(startingBalance);
      await upsertLedgerEntry({
        accountId: account.id,
        stageId: firstStageId,
        eventType: "CUSTOM_ADJUSTMENT",
        amount: diff,
        balanceAfter: account.currentBalance,
        reason: "Migrated pre-ledger manual balance",
        sourceType: "ACCOUNT_INIT",
        sourceId: `${account.id}:migrated-balance`,
      });
      adjusted += 1;
    }
  }

  console.log(`Backfilled ${initialized} account(s); ${adjusted} needed a migrated-balance adjustment.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
