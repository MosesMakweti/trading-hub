import { prisma } from "@/server/db";
import { deleteMediaFile } from "@/lib/media-storage";
import { getOrCreatePerformanceAccount } from "@/server/services/accounts.service";
import type { MediaOwnerType } from "@prisma/client";

/**
 * Data Management — user-scoped destructive operations. Every function here is
 * keyed by `userId` so a trader can only ever remove their OWN data. Deletes are
 * hard deletes (the soft-delete extension only filters reads), so Prisma
 * onDelete: Cascade fires and no orphaned children are left behind. The one
 * exception is the polymorphic media system (MediaAttachment has no FK to its
 * owner), so we clean those rows + hosted files explicitly.
 */

export type DataSection =
  | "journal-trades"
  | "today-plans"
  | "strategies"
  | "psychology"
  | "accounts"
  | "routine"
  | "notes";

/** Collect the user's media (rows + storage keys) for a set of polymorphic owner types. */
async function collectMedia(userId: string, ownerTypes: MediaOwnerType[]) {
  const rows = await prisma.mediaAttachment.findMany({
    where: { ownerType: { in: ownerTypes }, media: { userId } },
    select: { mediaId: true, media: { select: { storageKey: true } } },
  });
  return {
    assetIds: [...new Set(rows.map((r) => r.mediaId))],
    storageKeys: rows.map((r) => r.media.storageKey),
  };
}

/** Best-effort local file cleanup — never blocks the DB result on a missing file. */
async function deleteFiles(storageKeys: string[]) {
  await Promise.all(storageKeys.map((key) => deleteMediaFile(key).catch(() => {})));
}

const STRATEGY_MEDIA_OWNERS: MediaOwnerType[] = [
  "STRATEGY",
  "STRATEGY_ENTRY_MODEL",
  "STRATEGY_CHECKLIST_ITEM",
  "STRATEGY_FRAMEWORK_STEP",
  "ARSENAL_CONCEPT",
];

/**
 * Deletes one section's data for the user. Each branch runs its row deletes in a
 * single transaction (so a failure leaves nothing half-removed), then cleans any
 * hosted files after the DB commit.
 */
export async function deleteDataSection(userId: string, section: DataSection): Promise<void> {
  switch (section) {
    case "journal-trades": {
      const media = await collectMedia(userId, ["TRADE"]);
      await prisma.$transaction([
        prisma.mediaAsset.deleteMany({ where: { id: { in: media.assetIds } } }),
        // Trade cascade removes its psychology response + account allocations.
        prisma.trade.deleteMany({ where: { userId } }),
      ]);
      await deleteFiles(media.storageKeys);
      return;
    }
    case "today-plans": {
      await prisma.$transaction([
        prisma.tradingDay.deleteMany({ where: { userId } }),
        prisma.weeklyReview.deleteMany({ where: { userId } }),
      ]);
      return;
    }
    case "strategies": {
      const media = await collectMedia(userId, STRATEGY_MEDIA_OWNERS);
      await prisma.$transaction([
        prisma.mediaAsset.deleteMany({ where: { id: { in: media.assetIds } } }),
        // Strategy cascade removes versions, arsenal, framework, timeframes,
        // checkpoints, entry models, trade management (+ PTP/rules), checklist
        // items, and sessions. Trades keep their frozen snapshot (strategyId → null).
        prisma.strategy.deleteMany({ where: { userId } }),
      ]);
      await deleteFiles(media.storageKeys);
      return;
    }
    case "psychology": {
      // Keep the trades; remove only their psychology questionnaires/grades.
      await prisma.psychologyQuestionnaireResponse.deleteMany({ where: { trade: { userId } } });
      return;
    }
    case "accounts": {
      // Every prop-firm / brokerage account (their allocations cascade). The
      // internal Performance Account — the analytics ledger — is preserved.
      await prisma.tradingAccount.deleteMany({ where: { userId, kind: { not: "PERFORMANCE" } } });
      return;
    }
    case "routine": {
      await prisma.$transaction([
        prisma.routineSection.deleteMany({ where: { userId } }), // cascade items
        prisma.routineItem.deleteMany({ where: { userId } }),
      ]);
      return;
    }
    case "notes": {
      const media = await collectMedia(userId, ["DAILY_NOTE"]);
      await prisma.$transaction([
        prisma.mediaAsset.deleteMany({ where: { id: { in: media.assetIds } } }),
        prisma.dailyNote.deleteMany({ where: { userId } }),
      ]);
      await deleteFiles(media.storageKeys);
      return;
    }
    default: {
      const _never: never = section;
      throw new Error(`Unknown data section: ${_never as string}`);
    }
  }
}

/**
 * Full reset — remove every piece of trader-created data and return a clean,
 * default workspace, while PRESERVING the user account/identity + auth rows
 * (User / Account / Session / VerificationToken are untouched). Analytics are
 * derived, so they recompute to empty automatically. A fresh Performance Account
 * is re-created at its $100k baseline so the app opens in its default state.
 */
export async function resetAllData(userId: string): Promise<void> {
  const media = await prisma.mediaAsset.findMany({
    where: { userId },
    select: { storageKey: true },
  });

  await prisma.$transaction([
    prisma.mediaAsset.deleteMany({ where: { userId } }), // cascade attachments
    prisma.trade.deleteMany({ where: { userId } }), // cascade psychology + allocations
    prisma.dailyNote.deleteMany({ where: { userId } }),
    prisma.weeklyReview.deleteMany({ where: { userId } }),
    prisma.tradingDay.deleteMany({ where: { userId } }),
    prisma.strategy.deleteMany({ where: { userId } }), // cascade all Strategy-Lab children
    prisma.strategyChecklistItem.deleteMany({ where: { userId } }), // belt-and-suspenders
    prisma.strategySession.deleteMany({ where: { userId } }),
    prisma.routineSection.deleteMany({ where: { userId } }), // cascade items
    prisma.routineItem.deleteMany({ where: { userId } }),
    prisma.tradingAccount.deleteMany({ where: { userId } }), // incl. Performance Account
  ]);

  await deleteFiles(media.map((m) => m.storageKey));

  // Re-seed the default workspace: a fresh Performance Account at $100k.
  await getOrCreatePerformanceAccount(userId);
}

export interface DataCounts {
  trades: number;
  tradingDays: number;
  strategies: number;
  psychology: number;
  accounts: number;
  routineSections: number;
  notes: number;
}

/** Live counts for the Data Management cards (active rows; soft-deleted excluded). */
export async function getDataCounts(userId: string): Promise<DataCounts> {
  const [trades, tradingDays, strategies, psychology, accounts, routineSections, notes] =
    await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.tradingDay.count({ where: { userId } }),
      prisma.strategy.count({ where: { userId } }),
      prisma.psychologyQuestionnaireResponse.count({ where: { trade: { userId } } }),
      prisma.tradingAccount.count({ where: { userId, kind: { not: "PERFORMANCE" } } }),
      prisma.routineSection.count({ where: { userId } }),
      prisma.dailyNote.count({ where: { userId } }),
    ]);
  return { trades, tradingDays, strategies, psychology, accounts, routineSections, notes };
}
