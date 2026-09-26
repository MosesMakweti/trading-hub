import { prisma, type TransactionClient } from "@/server/db";
import { deleteMediaFile } from "@/lib/media-storage";
import { getOrCreatePerformanceAccount } from "@/server/services/accounts.service";
import { deleteBacktestRun } from "@/server/services/backtest-run.service";
import {
  collectMediaCandidates,
  deleteUnreferencedMediaAssets,
  removeOwnerAttachments,
  type MediaOwnerSet,
} from "@/server/services/media.service";
import { runLive } from "@/server/workspace/scope";
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
  | "backtesting"
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
 * Backtesting V1 — ids of the user's LIVE environment-owned records (raw SQL,
 * so soft-deleted rows are included and their media is cleaned too). Media
 * attachments aren't environment-scoped, so every live-data section resolves
 * its owners here instead of collecting "all TRADE media" — which would have
 * wiped Backtest Runs' screenshots along with live trades.
 */
async function liveOwnerIds(tx: TransactionClient, userId: string) {
  const [trades, notes, analyses] = await Promise.all([
    tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Trade" WHERE "userId" = ${userId} AND "backtestRunId" IS NULL`,
    tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "DailyNote" WHERE "userId" = ${userId} AND "backtestRunId" IS NULL`,
    tx.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "DailyAssetAnalysis" a JOIN "TradingDay" d ON d."id" = a."tradingDayId"
      WHERE a."userId" = ${userId} AND d."backtestRunId" IS NULL
    `,
  ]);
  return { tradeIds: trades.map((r) => r.id), noteIds: notes.map((r) => r.id), analysisIds: analyses.map((r) => r.id) };
}

/** Deletes every Backtest Run of the user, each with its media-safe cleanup. */
async function deleteAllBacktestRuns(userId: string): Promise<void> {
  const runs = await prisma.backtestRun.findMany({ where: { userId }, select: { id: true } });
  for (const run of runs) await deleteBacktestRun(userId, run.id);
}

/**
 * Deletes one section's data for the user. Each branch runs its row deletes in a
 * single transaction (so a failure leaves nothing half-removed), then cleans any
 * hosted files after the DB commit.
 */
export async function deleteDataSection(userId: string, section: DataSection): Promise<void> {
  switch (section) {
    case "backtesting": {
      await deleteAllBacktestRuns(userId);
      return;
    }
    case "journal-trades": {
      // LIVE trades only (explicit scope) — Backtest Runs are their own section.
      const keys = await runLive(() =>
        prisma.$transaction(async (tx) => {
          const { tradeIds } = await liveOwnerIds(tx, userId);
          const owners: MediaOwnerSet[] = [{ ownerType: "TRADE", ownerIds: tradeIds }];
          const candidates = await collectMediaCandidates(tx, userId, owners, tradeIds);
          await removeOwnerAttachments(tx, userId, owners);
          // Opportunities are journal/trade data — remove them too. (Trade.opportunityId
          // is SetNull, so deleting trades alone would strand the opportunity records.)
          await tx.tradeOpportunity.deleteMany({ where: { userId } });
          // Trade cascade removes its psychology response, allocations and plan
          // screenshots — BEFORE their assets, which the screenshot FK restricts.
          await tx.trade.deleteMany({ where: { userId } });
          return deleteUnreferencedMediaAssets(tx, userId, candidates);
        }),
      );
      await deleteFiles(keys);
      return;
    }
    case "today-plans": {
      const keys = await runLive(() =>
        prisma.$transaction(async (tx) => {
          const { analysisIds } = await liveOwnerIds(tx, userId);
          const owners: MediaOwnerSet[] = [{ ownerType: "DAILY_ASSET_ANALYSIS", ownerIds: analysisIds }];
          const candidates = await collectMediaCandidates(tx, userId, owners, []);
          await removeOwnerAttachments(tx, userId, owners);
          await tx.tradingDay.deleteMany({ where: { userId } });
          await tx.weeklyReview.deleteMany({ where: { userId } });
          return deleteUnreferencedMediaAssets(tx, userId, candidates);
        }),
      );
      await deleteFiles(keys);
      return;
    }
    case "strategies": {
      const media = await collectMedia(userId, STRATEGY_MEDIA_OWNERS);
      await prisma.$transaction([
        prisma.mediaAsset.deleteMany({ where: { id: { in: media.assetIds }, userId } }),
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
      const keys = await runLive(() =>
        prisma.$transaction(async (tx) => {
          const { noteIds } = await liveOwnerIds(tx, userId);
          const owners: MediaOwnerSet[] = [{ ownerType: "DAILY_NOTE", ownerIds: noteIds }];
          const candidates = await collectMediaCandidates(tx, userId, owners, []);
          await removeOwnerAttachments(tx, userId, owners);
          await tx.dailyNote.deleteMany({ where: { userId } });
          return deleteUnreferencedMediaAssets(tx, userId, candidates);
        }),
      );
      await deleteFiles(keys);
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
  // Everything trader-created includes Backtesting — removed deliberately
  // (each run with its media-safe cleanup), never as a side effect.
  await deleteAllBacktestRuns(userId);

  const media = await prisma.mediaAsset.findMany({
    where: { userId },
    select: { storageKey: true },
  });

  await runLive(() => prisma.$transaction([
    prisma.tradeOpportunity.deleteMany({ where: { userId } }), // executed/missed opportunities
    prisma.trade.deleteMany({ where: { userId } }), // cascade psychology + allocations + plan screenshots
    prisma.dailyNote.deleteMany({ where: { userId } }),
    prisma.weeklyReview.deleteMany({ where: { userId } }),
    prisma.tradingDay.deleteMany({ where: { userId } }),
    // Assets AFTER trades: TradePlanScreenshot → MediaAsset is ON DELETE RESTRICT.
    prisma.mediaAsset.deleteMany({ where: { userId } }), // cascade attachments
    prisma.strategy.deleteMany({ where: { userId } }), // cascade all Strategy-Lab children
    prisma.strategyChecklistItem.deleteMany({ where: { userId } }), // belt-and-suspenders
    prisma.strategySession.deleteMany({ where: { userId } }),
    prisma.routineSection.deleteMany({ where: { userId } }), // cascade items
    prisma.routineItem.deleteMany({ where: { userId } }),
    prisma.tradingAccount.deleteMany({ where: { userId } }), // incl. Performance Account
  ]));

  await deleteFiles(media.map((m) => m.storageKey));

  // Re-seed the default workspace: a fresh Performance Account at $100k.
  await getOrCreatePerformanceAccount(userId);
}

export interface DataCounts {
  backtestRuns: number;
  /** LIVE trades (Backtest Runs are counted separately). */
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
  const [backtestRuns, trades, tradingDays, strategies, psychology, accounts, routineSections, notes] =
    await Promise.all([
      prisma.backtestRun.count({ where: { userId } }),
      prisma.trade.count({ where: { userId } }),
      prisma.tradingDay.count({ where: { userId } }),
      prisma.strategy.count({ where: { userId } }),
      prisma.psychologyQuestionnaireResponse.count({ where: { trade: { userId } } }),
      prisma.tradingAccount.count({ where: { userId, kind: { not: "PERFORMANCE" } } }),
      prisma.routineSection.count({ where: { userId } }),
      prisma.dailyNote.count({ where: { userId } }),
    ]);
  return { backtestRuns, trades, tradingDays, strategies, psychology, accounts, routineSections, notes };
}
