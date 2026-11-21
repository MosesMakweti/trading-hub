import { Prisma, type MindsetMantra, type MindsetPreference } from "@prisma/client";

import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import { DEFAULT_MANTRAS } from "@/domain/mindset/defaults";
import {
  DEFAULT_PREFERENCES,
  isBreathingPatternId,
  isSoundId,
  type MindsetPreferences,
} from "@/domain/mindset/options";
import { LOOKBACK_REVIEWS, recommendFromReviews, type MindsetRecommendation, type ReviewEvidence } from "@/domain/mindset/recommendations";

/**
 * Mindset (pre-trading meditation). Every query is scoped to the signed-in
 * user; ids from the client are only ever looked up together with userId.
 * Recommendations are derived on read from finalized Weekly Trade Audits —
 * nothing about the trader's library is ever changed automatically.
 */

export class MindsetError extends Error {}

export interface MantraDTO {
  id: string;
  text: string;
  category: string;
  enabled: boolean;
  defaultKey: string | null;
  sortOrder: number;
}

export interface MindsetSessionDTO {
  id: string;
  startedAt: string;
  plannedSeconds: number;
  activeSeconds: number | null;
  status: "COMPLETED" | "INTERRUPTED" | "IN_PROGRESS";
  environment: "NATURE" | "FOCUS";
  sound: string | null;
  categories: string[];
  mantraCount: number;
  fromRecommendation: boolean;
}

const toMantraDTO = (m: MindsetMantra): MantraDTO => ({
  id: m.id,
  text: m.text,
  category: m.category,
  enabled: m.enabled,
  defaultKey: m.defaultKey,
  sortOrder: m.sortOrder,
});

function toPreferences(row: MindsetPreference | null): MindsetPreferences {
  if (!row) return DEFAULT_PREFERENCES;
  return {
    environment: row.environment,
    durationSeconds: row.durationSeconds,
    secondsPerMantra: row.secondsPerMantra,
    order: row.order,
    repeat: row.repeat,
    selectedCategories: row.selectedCategories,
    selectedMantraIds: row.selectedMantraIds,
    audioEnabled: row.audioEnabled,
    sound: isSoundId(row.sound) ? row.sound : DEFAULT_PREFERENCES.sound,
    volume: row.volume,
    breathingEnabled: row.breathingEnabled,
    breathingPattern: isBreathingPatternId(row.breathingPattern) ? row.breathingPattern : DEFAULT_PREFERENCES.breathingPattern,
  };
}

async function upsertPreferenceRow(userId: string): Promise<MindsetPreference> {
  try {
    return await prisma.mindsetPreference.upsert({ where: { userId }, update: {}, create: { userId } });
  } catch (e) {
    // Two first visits at once: the loser of the insert race reads the winner's row.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.mindsetPreference.findUniqueOrThrow({ where: { userId } });
    }
    throw e;
  }
}

/**
 * Seeds the default mantras exactly once per trader. The claim on
 * `defaultsSeededAt` is a single conditional update, so concurrent first
 * visits seed once; the unique (userId, defaultKey) index is a second guard.
 * After seeding, defaults are never re-added — even if every one is deleted.
 */
export async function ensureMindsetDefaults(userId: string): Promise<void> {
  await upsertPreferenceRow(userId);
  const claim = await prisma.mindsetPreference.updateMany({ where: { userId, defaultsSeededAt: null }, data: { defaultsSeededAt: new Date() } });
  if (claim.count === 0) return;
  await prisma.mindsetMantra.createMany({
    data: DEFAULT_MANTRAS.map((m, i) => ({ userId, text: m.text, category: m.category, defaultKey: m.key, sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function listMantras(userId: string): Promise<MantraDTO[]> {
  const rows = await prisma.mindsetMantra.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toMantraDTO);
}

export async function createMantra(userId: string, input: { text: string; category: string }): Promise<MantraDTO> {
  const last = await prisma.mindsetMantra.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.mindsetMantra.create({
    data: { userId, text: input.text, category: input.category, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return toMantraDTO(row);
}

export async function updateMantra(userId: string, id: string, patch: Partial<{ text: string; category: string; enabled: boolean }>): Promise<void> {
  const result = await prisma.mindsetMantra.updateMany({ where: { id, userId, deletedAt: null }, data: patch });
  if (result.count === 0) throw new MindsetError("Mantra not found.");
}

/** Soft delete — a deleted default is never re-seeded. */
export async function deleteMantra(userId: string, id: string): Promise<void> {
  const result = await prisma.mindsetMantra.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date(), enabled: false } });
  if (result.count === 0) throw new MindsetError("Mantra not found.");
}

/** Renames a whole category (every mantra in it). */
export async function renameCategory(userId: string, from: string, to: string): Promise<number> {
  const result = await prisma.mindsetMantra.updateMany({ where: { userId, deletedAt: null, category: from }, data: { category: to } });
  return result.count;
}

export async function getPreferences(userId: string): Promise<MindsetPreferences> {
  return toPreferences(await prisma.mindsetPreference.findUnique({ where: { userId } }));
}

/** Saves the last-used settings. Selected mantra ids are filtered to ones the user owns. */
export async function savePreferences(userId: string, patch: Partial<MindsetPreferences>): Promise<MindsetPreferences> {
  await upsertPreferenceRow(userId);
  const data: Prisma.MindsetPreferenceUpdateInput = { ...patch };
  if (patch.selectedMantraIds) {
    const owned = await prisma.mindsetMantra.findMany({
      where: { userId, deletedAt: null, id: { in: patch.selectedMantraIds } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));
    data.selectedMantraIds = patch.selectedMantraIds.filter((id) => ownedIds.has(id));
  }
  const row = await prisma.mindsetPreference.update({ where: { userId }, data });
  return toPreferences(row);
}

// ── Sessions (history only) ────────────────────────────────────────────────

export async function startSession(
  userId: string,
  input: { plannedSeconds: number; environment: "NATURE" | "FOCUS"; sound: string | null; categories: string[]; mantraCount: number; recommendationKey: string | null },
): Promise<{ id: string }> {
  const row = await prisma.mindsetSession.create({ data: { userId, ...input } });
  return { id: row.id };
}

/** First end wins: ending an already-ended session is a no-op (idempotent). */
export async function endSession(userId: string, id: string, input: { status: "COMPLETED" | "INTERRUPTED"; activeSeconds: number }): Promise<void> {
  await prisma.mindsetSession.updateMany({
    where: { id, userId, status: "STARTED" },
    data: { status: input.status, activeSeconds: Math.max(0, Math.round(input.activeSeconds)), endedAt: new Date() },
  });
}

export async function listSessions(userId: string, limit = 20): Promise<MindsetSessionDTO[]> {
  const rows = await prisma.mindsetSession.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: limit });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    plannedSeconds: r.plannedSeconds,
    activeSeconds: r.activeSeconds,
    // A session never ended (closed tab, lost connection) reads as interrupted
    // once it is clearly over.
    status:
      r.status === "STARTED"
        ? now - r.startedAt.getTime() > (r.plannedSeconds + 3600) * 1000
          ? "INTERRUPTED"
          : "IN_PROGRESS"
        : r.status,
    environment: r.environment,
    sound: r.sound,
    categories: r.categories,
    mantraCount: r.mantraCount,
    fromRecommendation: r.recommendationKey != null,
  }));
}

// ── Edge Review → recommendations ──────────────────────────────────────────

/**
 * The evidence the trader recorded in their most recent FINALIZED weekly
 * audits (in-progress reviews never count): weaknesses, invalid reasons and
 * execution issues on judged trades, and weaknesses / miss reasons on missed
 * setups. All scopes of a week are considered together.
 */
export async function loadReviewEvidence(userId: string): Promise<ReviewEvidence[]> {
  const audits = await prisma.weeklyTradeAudit.findMany({
    where: { userId, status: "FINALIZED" },
    orderBy: [{ weekStart: "desc" }, { finalizedAt: "desc" }],
    take: LOOKBACK_REVIEWS,
    select: {
      id: true,
      weekStart: true,
      assessments: { select: { weaknesses: true, invalidReasons: true, executionIssues: true } },
      expectedTrades: { select: { weaknesses: true, missReason: true } },
    },
  });
  return audits.map((a) => ({
    auditId: a.id,
    weekStart: utcDateToKey(a.weekStart),
    tags: [
      ...a.assessments.flatMap((x) => [
        ...x.weaknesses.map((w) => `weakness:${w}`),
        ...x.invalidReasons.map((r) => `invalid:${r}`),
        ...x.executionIssues.map((i) => `issue:${i}`),
      ]),
      ...a.expectedTrades.flatMap((e) => [...e.weaknesses.map((w) => `weakness:${w}`), ...(e.missReason ? [`miss:${e.missReason}`] : [])]),
    ],
  }));
}

export async function getRecommendations(userId: string): Promise<MindsetRecommendation[]> {
  const [evidence, pref] = await Promise.all([loadReviewEvidence(userId), prisma.mindsetPreference.findUnique({ where: { userId }, select: { dismissedRecommendationKey: true } })]);
  return recommendFromReviews(evidence).filter((r) => r.key !== pref?.dismissedRecommendationKey);
}

export async function dismissRecommendation(userId: string, key: string): Promise<void> {
  await upsertPreferenceRow(userId);
  await prisma.mindsetPreference.update({ where: { userId }, data: { dismissedRecommendationKey: key } });
}

// ── Dashboard read model ───────────────────────────────────────────────────

export interface MindsetDashboard {
  mantras: MantraDTO[];
  preferences: MindsetPreferences;
  sessions: MindsetSessionDTO[];
  recommendations: MindsetRecommendation[];
}

export async function loadMindsetDashboard(userId: string): Promise<MindsetDashboard> {
  await ensureMindsetDefaults(userId);
  const [mantras, preferences, sessions, recommendations] = await Promise.all([
    listMantras(userId),
    getPreferences(userId),
    listSessions(userId),
    getRecommendations(userId).catch((e) => {
      // Recommendations are optional — the normal experience must still load.
      console.error("[mindset] recommendations failed", e);
      return [];
    }),
  ]);
  return { mantras, preferences, sessions, recommendations };
}
