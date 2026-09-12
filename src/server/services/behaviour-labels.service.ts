import type { TagColor } from "@prisma/client";

import { prisma } from "@/server/db";
import { DEFAULT_BEHAVIOUR_LABELS } from "@/domain/behaviour-labels/defaults";
import type {
  BehaviourLabelCreateInput,
  BehaviourLabelUpdateInput,
} from "@/lib/validation/behaviour-labels";

export interface TradeBehaviourLabelSummaryDTO {
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
  color: TagColor;
}

/**
 * Trade Review overhaul (Stage 7 §8) — a reusable, per-user catalog of
 * trader-behaviour tags, seeded lazily on first use (same pattern as
 * getOrCreatePerformanceAccount / ensureLegacyPropFirmsMigrated: no manual
 * seed script to remember to run, no data created until a user actually
 * needs it). NOT strategy-specific — labels describe conduct, not a setup.
 */

/** Case-insensitive duplicate-name check among a user's LIVE labels (the DB
 *  @@unique is case-sensitive defense-in-depth; this gives a friendlier
 *  error and catches case-only duplicates it wouldn't). Mirrors
 *  strategy-setup-types.service.ts's assertUniqueSetupTypeName. */
async function assertUniqueLabelName(userId: string, name: string, excludeId?: string) {
  const existing = await prisma.behaviourLabel.findMany({
    where: { userId, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
  });
  const normalized = name.trim().toLowerCase();
  if (existing.some((l) => l.name.trim().toLowerCase() === normalized)) {
    throw new Error("A behaviour label with this name already exists.");
  }
}

/** Lists a user's live behaviour labels, seeding the default catalog the
 *  very first time they have none at all (a trader who archives every
 *  default afterward is never re-seeded — this only fires on a truly empty
 *  catalog, checked including soft-deleted rows). */
export async function listBehaviourLabels(userId: string) {
  // Raw query: BehaviourLabel is registered in the soft-delete extension
  // (server/db.ts), which silently adds `deletedAt: null` to every
  // findFirst/findMany/count — a plain findFirst here would see an
  // all-archived user as "empty" and try to re-seed, colliding with the
  // still-present (soft-deleted) rows on the (userId, name) unique
  // constraint. Mirrors nextTradeNumber's own bypass in trades.service.ts.
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::int AS count FROM "BehaviourLabel" WHERE "userId" = ${userId}
  `;
  const hasAny = Number(rows[0]?.count ?? 0) > 0;
  if (!hasAny) {
    await prisma.behaviourLabel.createMany({
      data: DEFAULT_BEHAVIOUR_LABELS.map((label, index) => ({
        userId,
        name: label.name,
        polarity: label.polarity,
        isDefault: true,
        sortOrder: index,
      })),
    });
  }
  return prisma.behaviourLabel.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ polarity: "asc" }, { sortOrder: "asc" }],
  });
}

export async function createBehaviourLabel(userId: string, data: BehaviourLabelCreateInput) {
  await assertUniqueLabelName(userId, data.name);
  const last = await prisma.behaviourLabel.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.behaviourLabel.create({
    data: {
      userId,
      name: data.name,
      polarity: data.polarity,
      color: data.color,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateBehaviourLabel(userId: string, id: string, data: BehaviourLabelUpdateInput) {
  if (data.name !== undefined) {
    await assertUniqueLabelName(userId, data.name, id);
  }
  const result = await prisma.behaviourLabel.updateMany({
    where: { id, userId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    },
  });
  if (result.count === 0) throw new Error("Behaviour label not found.");
}

export async function archiveBehaviourLabel(userId: string, id: string): Promise<void> {
  const result = await prisma.behaviourLabel.updateMany({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Behaviour label not found.");
}

/** Every behaviour label currently attached to a trade, ordered like the catalog. */
export async function listTradeBehaviourLabels(userId: string, tradeId: string) {
  const rows = await prisma.tradeBehaviourLabel.findMany({
    where: { tradeId, trade: { userId } },
    include: { behaviourLabel: true },
  });
  return rows
    .map((r) => r.behaviourLabel)
    .filter((l) => l.deletedAt == null)
    .sort((a, b) => (a.polarity === b.polarity ? a.sortOrder - b.sortOrder : a.polarity.localeCompare(b.polarity)));
}

/**
 * Journal rebuild (Stage 9 §7/§19) — every behaviour label for MANY trades in
 * one batched query, grouped by tradeId. The Journal day view needs this per
 * trade in its list; fetching it once for the whole day (rather than once
 * per TradeCard) is what keeps that page N+1-free.
 */
export async function listBehaviourLabelsForTrades(
  userId: string,
  tradeIds: string[],
): Promise<Record<string, TradeBehaviourLabelSummaryDTO[]>> {
  if (tradeIds.length === 0) return {};
  const rows = await prisma.tradeBehaviourLabel.findMany({
    where: { tradeId: { in: tradeIds }, trade: { userId } },
    include: { behaviourLabel: true },
  });
  const byTrade: Record<string, TradeBehaviourLabelSummaryDTO[]> = {};
  for (const row of rows) {
    if (row.behaviourLabel.deletedAt) continue;
    (byTrade[row.tradeId] ??= []).push({
      name: row.behaviourLabel.name,
      polarity: row.behaviourLabel.polarity,
      color: row.behaviourLabel.color,
    });
  }
  return byTrade;
}

/**
 * Replaces the FULL set of behaviour labels on a trade in one call — a fast
 * multi-select toggles labels client-side and submits the whole resulting
 * set, simpler and safer than one attach/detach round-trip per click.
 * Cross-user protected: a labelId that isn't this user's own is silently
 * dropped rather than attached (defense in depth; the UI never offers one).
 */
export async function setTradeBehaviourLabels(userId: string, tradeId: string, labelIds: string[]): Promise<void> {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId }, select: { id: true } });
  if (!trade) throw new Error("Trade not found.");

  const owned = await prisma.behaviourLabel.findMany({
    where: { id: { in: labelIds }, userId, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((l) => l.id));
  const validIds = labelIds.filter((id) => ownedIds.has(id));

  await prisma.$transaction([
    prisma.tradeBehaviourLabel.deleteMany({ where: { tradeId } }),
    ...validIds.map((behaviourLabelId) =>
      prisma.tradeBehaviourLabel.create({ data: { tradeId, behaviourLabelId } }),
    ),
  ]);
}
