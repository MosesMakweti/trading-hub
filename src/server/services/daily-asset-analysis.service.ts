import { Prisma, type DailyAssetAnalysis, type DirectionalEvidenceItem } from "@prisma/client";

import { prisma } from "@/server/db";
import { getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { summarizeDirectionalEvidence } from "@/domain/today/directional-evidence";
import type {
  DailyAssetAnalysisUpdateInput,
  DirectionalEvidenceItemUpdateInput,
} from "@/lib/validation/daily-asset-analysis";
import type { DailyAssetAnalysisDTO, DirectionalEvidenceItemDTO } from "@/types/today";

type AnalysisWithEvidence = DailyAssetAnalysis & { directionalEvidenceItems: DirectionalEvidenceItem[] };

const withEvidence = { directionalEvidenceItems: { orderBy: { sortOrder: "asc" as const } } };

function toEvidenceItemDTO(item: DirectionalEvidenceItem): DirectionalEvidenceItemDTO {
  return {
    id: item.id,
    label: item.label,
    direction: item.direction as DirectionalEvidenceItemDTO["direction"],
    checked: item.checked,
    note: item.note,
  };
}

export function toDailyAssetAnalysisDTO(row: AnalysisWithEvidence): DailyAssetAnalysisDTO {
  const evidenceItems = row.directionalEvidenceItems.map(toEvidenceItemDTO);
  return {
    id: row.id,
    assetSymbol: row.assetSymbol,
    marketStructure: row.marketStructure,
    htfBias: row.htfBias as DailyAssetAnalysisDTO["htfBias"],
    sessionBias: row.sessionBias as DailyAssetAnalysisDTO["sessionBias"],
    fundamentalBias: row.fundamentalBias as DailyAssetAnalysisDTO["fundamentalBias"],
    fundamentalNotes: row.fundamentalNotes,
    finalBias: row.finalBias as DailyAssetAnalysisDTO["finalBias"],
    notes: row.notes,
    keyLevels: row.keyLevels,
    evidenceItems,
    evidenceSummary: summarizeDirectionalEvidence(evidenceItems),
  };
}

/** Every asset analysis for a day, in display order — the single source of
 *  truth for "Today's Assets" (Stage 11 §3): there is no separate watchlist
 *  driving this list anymore. Read-only — a day with no TradingDay row yet
 *  simply has no analyses. */
export async function listDailyAssetAnalyses(
  userId: string,
  dateKey: string,
): Promise<AnalysisWithEvidence[]> {
  const day = await getTradingDay(userId, dateKey);
  if (!day) return [];
  return prisma.dailyAssetAnalysis.findMany({
    where: { tradingDayId: day.id },
    include: withEvidence,
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Find-or-create: one analysis per (day, asset) — the `@@unique` on
 * (tradingDayId, assetSymbol) is what makes this idempotent. This is also
 * what powers the watchlist convenience (clicking a watchlist asset opens —
 * or transparently creates — its analysis) without ever risking a duplicate.
 */
export async function createOrGetDailyAssetAnalysis(
  userId: string,
  dateKey: string,
  assetSymbolRaw: string,
): Promise<DailyAssetAnalysis> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  const assetSymbol = assetSymbolRaw.trim().toUpperCase();

  const existing = await prisma.dailyAssetAnalysis.findFirst({
    where: { tradingDayId: day.id, assetSymbol, deletedAt: null },
  });
  if (existing) return existing;

  const last = await prisma.dailyAssetAnalysis.findFirst({
    where: { tradingDayId: day.id },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.dailyAssetAnalysis.create({
    data: { userId, tradingDayId: day.id, assetSymbol, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

/**
 * Trade Idea Validation Shield (Stage 4 §10) — the day's finalBias for one
 * asset, if it has an analysis. Read-only, no create (unlike
 * createOrGetDailyAssetAnalysis): a trade form quietly checking for context
 * must never conjure up an empty analysis just by asking.
 */
export async function getFinalBiasForAsset(
  userId: string,
  dateKey: string,
  assetSymbolRaw: string,
): Promise<DailyAssetAnalysisDTO["finalBias"] | null> {
  const assetSymbol = assetSymbolRaw.trim().toUpperCase();
  if (!assetSymbol) return null;
  const day = await getTradingDay(userId, dateKey);
  if (!day) return null;
  const analysis = await prisma.dailyAssetAnalysis.findFirst({
    where: { tradingDayId: day.id, assetSymbol, deletedAt: null },
    select: { finalBias: true },
  });
  return (analysis?.finalBias as DailyAssetAnalysisDTO["finalBias"]) ?? null;
}

/** Ownership check reused by every mutation below — scoped directly through
 *  the analysis's own userId (denormalized at create time), never inferred. */
const owned = (userId: string, id: string) => ({ id, userId, deletedAt: null });

export async function updateDailyAssetAnalysis(
  userId: string,
  id: string,
  data: DailyAssetAnalysisUpdateInput,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (data.htfBias !== undefined) patch.htfBias = data.htfBias;
  if (data.sessionBias !== undefined) patch.sessionBias = data.sessionBias;
  if (data.fundamentalBias !== undefined) patch.fundamentalBias = data.fundamentalBias;
  if (data.fundamentalNotes !== undefined) {
    patch.fundamentalNotes = data.fundamentalNotes === null ? Prisma.DbNull : data.fundamentalNotes;
  }
  if (data.finalBias !== undefined) patch.finalBias = data.finalBias;
  if (data.marketStructure !== undefined) {
    patch.marketStructure = data.marketStructure === null ? Prisma.DbNull : data.marketStructure;
  }
  if (data.notes !== undefined) patch.notes = data.notes === null ? Prisma.DbNull : data.notes;
  if (data.keyLevels !== undefined) {
    patch.keyLevels = data.keyLevels === null ? Prisma.DbNull : data.keyLevels;
  }

  const result = await prisma.dailyAssetAnalysis.updateMany({
    where: owned(userId, id),
    data: patch as Prisma.DailyAssetAnalysisUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Asset analysis not found.");
}

export async function archiveDailyAssetAnalysis(userId: string, id: string): Promise<void> {
  const result = await prisma.dailyAssetAnalysis.updateMany({
    where: owned(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Asset analysis not found.");
}

export async function reorderDailyAssetAnalyses(
  userId: string,
  dateKey: string,
  orderedIds: string[],
): Promise<void> {
  const day = await getTradingDay(userId, dateKey);
  if (!day) return;
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.dailyAssetAnalysis.updateMany({
        where: { id, userId, tradingDayId: day.id },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ── Directional Evidence (Stage 11 §7-13) ───────────────────────────────────
// Fast, disposable per-asset checklist rows — deliberately hard-deleted (no
// soft-delete) since these are day-prep scratch items, not historical trade
// data. Ownership is scoped through the analysis's own userId, same pattern
// as every mutation above.

export async function addDirectionalEvidenceItem(
  userId: string,
  dailyAssetAnalysisId: string,
  label: string,
  direction: "BULLISH" | "BEARISH",
): Promise<DirectionalEvidenceItemDTO> {
  const analysis = await prisma.dailyAssetAnalysis.findFirst({
    where: { id: dailyAssetAnalysisId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!analysis) throw new Error("Asset analysis not found.");

  const last = await prisma.directionalEvidenceItem.findFirst({
    where: { dailyAssetAnalysisId },
    orderBy: { sortOrder: "desc" },
  });

  const item = await prisma.directionalEvidenceItem.create({
    data: {
      userId,
      dailyAssetAnalysisId,
      label,
      direction,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  return toEvidenceItemDTO(item);
}

export async function updateDirectionalEvidenceItem(
  userId: string,
  id: string,
  data: DirectionalEvidenceItemUpdateInput,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (data.label !== undefined) patch.label = data.label;
  if (data.direction !== undefined) patch.direction = data.direction;
  if (data.checked !== undefined) patch.checked = data.checked;
  if (data.note !== undefined) patch.note = data.note;

  const result = await prisma.directionalEvidenceItem.updateMany({
    where: { id, userId },
    data: patch as Prisma.DirectionalEvidenceItemUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Evidence item not found.");
}

export async function deleteDirectionalEvidenceItem(userId: string, id: string): Promise<void> {
  const result = await prisma.directionalEvidenceItem.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Evidence item not found.");
}

export async function reorderDirectionalEvidenceItems(
  userId: string,
  dailyAssetAnalysisId: string,
  orderedIds: string[],
): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.directionalEvidenceItem.updateMany({
        where: { id, userId, dailyAssetAnalysisId },
        data: { sortOrder: index },
      }),
    ),
  );
}

export interface DailyMarketContextDTO {
  /** The asset's CURRENT finalBias — may have moved since a given trade was
   *  created; a trade's own frozen `dailyBiasSnapshot` remains the durable
   *  historical record (Stage 4/11 §18), this is only live context. */
  finalBias: DailyAssetAnalysisDTO["finalBias"];
  evidenceSummary: DailyAssetAnalysisDTO["evidenceSummary"];
}

/**
 * Trade Idea integration (Stage 11 §18) — read-only live context for the
 * asset's Daily Market Plan analysis, reused (not copied/duplicated) by the
 * Trade Idea view. Returns null when no analysis exists for that asset today
 * (never fabricates one). Does not create — same read-only contract as
 * `getFinalBiasForAsset`.
 */
export async function getDailyMarketContextForAsset(
  userId: string,
  dateKey: string,
  assetSymbolRaw: string,
): Promise<DailyMarketContextDTO | null> {
  const assetSymbol = assetSymbolRaw.trim().toUpperCase();
  if (!assetSymbol) return null;
  const day = await getTradingDay(userId, dateKey);
  if (!day) return null;
  const analysis = await prisma.dailyAssetAnalysis.findFirst({
    where: { tradingDayId: day.id, assetSymbol, deletedAt: null },
    include: withEvidence,
  });
  if (!analysis) return null;
  return {
    finalBias: analysis.finalBias as DailyAssetAnalysisDTO["finalBias"],
    evidenceSummary: summarizeDirectionalEvidence(analysis.directionalEvidenceItems.map(toEvidenceItemDTO)),
  };
}
