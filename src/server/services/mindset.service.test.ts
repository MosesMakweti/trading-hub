import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { DEFAULT_MANTRAS } from "@/domain/mindset/defaults";
import {
  createMantra,
  deleteMantra,
  dismissRecommendation,
  endSession,
  ensureMindsetDefaults,
  getPreferences,
  getRecommendations,
  listMantras,
  listSessions,
  loadMindsetDashboard,
  MindsetError,
  renameCategory,
  savePreferences,
  startSession,
  updateMantra,
} from "@/server/services/mindset.service";
import { createMantraSchema, preferencesSchema } from "@/lib/validation/mindset";

const userIds: string[] = [];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function makeUser(label: string) {
  const user = await prisma.user.create({ data: { email: `mindset-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` } });
  userIds.push(user.id);
  return user;
}

describe("default mantras", () => {
  it("are seeded once — repeated and concurrent visits never duplicate them", async () => {
    const user = await makeUser("defaults");
    await Promise.all([ensureMindsetDefaults(user.id), ensureMindsetDefaults(user.id), ensureMindsetDefaults(user.id)]);
    await loadMindsetDashboard(user.id);
    const mantras = await listMantras(user.id);
    expect(mantras).toHaveLength(DEFAULT_MANTRAS.length);
    expect(new Set(mantras.map((m) => m.defaultKey)).size).toBe(DEFAULT_MANTRAS.length);
  });

  it("are never re-added after the trader deletes them", async () => {
    const user = await makeUser("defaults-deleted");
    await ensureMindsetDefaults(user.id);
    for (const m of await listMantras(user.id)) await deleteMantra(user.id, m.id);
    await loadMindsetDashboard(user.id);
    expect(await listMantras(user.id)).toEqual([]);
  });
});

describe("mantra management", () => {
  it("creates, edits, disables and deletes a mantra, with custom categories", async () => {
    const user = await makeUser("crud");
    const m = await createMantra(user.id, { text: "I trade my plan, not my P&L.", category: "My rules" });
    await updateMantra(user.id, m.id, { text: "I trade my plan, not my P&L, today.", enabled: false });
    let [row] = (await listMantras(user.id)).filter((x) => x.id === m.id);
    expect(row).toMatchObject({ text: "I trade my plan, not my P&L, today.", enabled: false, category: "My rules" });
    expect(await renameCategory(user.id, "My rules", "Personal rules")).toBe(1);
    [row] = (await listMantras(user.id)).filter((x) => x.id === m.id);
    expect(row.category).toBe("Personal rules");
    await deleteMantra(user.id, m.id);
    expect((await listMantras(user.id)).find((x) => x.id === m.id)).toBeUndefined();
    await expect(deleteMantra(user.id, m.id)).rejects.toThrow(MindsetError);
  });

  it("isolates users — nobody can read, edit or delete another trader's mantras", async () => {
    const owner = await makeUser("iso-owner");
    const other = await makeUser("iso-other");
    const m = await createMantra(owner.id, { text: "Mine.", category: "Discipline" });
    expect((await listMantras(other.id)).find((x) => x.id === m.id)).toBeUndefined();
    await expect(updateMantra(other.id, m.id, { text: "Hijacked" })).rejects.toThrow(MindsetError);
    await expect(deleteMantra(other.id, m.id)).rejects.toThrow(MindsetError);
    const saved = await savePreferences(other.id, { selectedMantraIds: [m.id] });
    expect(saved.selectedMantraIds).toEqual([]); // can't select someone else's mantra
  });

  it("validates input", () => {
    expect(createMantraSchema.safeParse({ text: "  ", category: "Patience" }).success).toBe(false);
    expect(createMantraSchema.safeParse({ text: "x".repeat(281), category: "Patience" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ durationSeconds: 10 }).success).toBe(false);
    expect(preferencesSchema.safeParse({ sound: "not-a-sound" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ volume: 101 }).success).toBe(false);
  });
});

describe("preferences", () => {
  it("start from sensible defaults and persist changes", async () => {
    const user = await makeUser("prefs");
    expect(await getPreferences(user.id)).toMatchObject({ environment: "NATURE", durationSeconds: 300, secondsPerMantra: 10, audioEnabled: true, breathingEnabled: true });
    const mine = await createMantra(user.id, { text: "Mine.", category: "Patience" });
    await savePreferences(user.id, { environment: "FOCUS", durationSeconds: 600, order: "RANDOM", sound: "stream", volume: 35, breathingEnabled: false, selectedMantraIds: [mine.id] });
    expect(await getPreferences(user.id)).toMatchObject({ environment: "FOCUS", durationSeconds: 600, order: "RANDOM", sound: "stream", volume: 35, breathingEnabled: false, selectedMantraIds: [mine.id] });
  });
});

describe("session history", () => {
  it("records a session and ends it once (first end wins)", async () => {
    const user = await makeUser("sessions");
    const { id } = await startSession(user.id, { plannedSeconds: 300, environment: "FOCUS", sound: "rain", categories: ["Patience"], mantraCount: 8, recommendationKey: "PATIENCE:x" });
    expect((await listSessions(user.id))[0]).toMatchObject({ id, status: "IN_PROGRESS", fromRecommendation: true });
    await endSession(user.id, id, { status: "COMPLETED", activeSeconds: 299.6 });
    await endSession(user.id, id, { status: "INTERRUPTED", activeSeconds: 10 });
    expect((await listSessions(user.id))[0]).toMatchObject({ status: "COMPLETED", activeSeconds: 300 });
  });

  it("can't end another user's session, and shows a never-ended old session as interrupted", async () => {
    const owner = await makeUser("sessions-owner");
    const other = await makeUser("sessions-other");
    const { id } = await startSession(owner.id, { plannedSeconds: 180, environment: "NATURE", sound: null, categories: [], mantraCount: 5, recommendationKey: null });
    await endSession(other.id, id, { status: "COMPLETED", activeSeconds: 180 });
    expect((await listSessions(owner.id))[0].status).toBe("IN_PROGRESS");
    await prisma.mindsetSession.update({ where: { id }, data: { startedAt: new Date(Date.now() - 3 * 3600 * 1000) } });
    expect((await listSessions(owner.id))[0].status).toBe("INTERRUPTED");
    expect(await listSessions(other.id)).toEqual([]);
  });
});

describe("Edge Review recommendations", () => {
  let weekOffset = 0;
  async function audit(userId: string, weekStart: string, status: "FINALIZED" | "IN_PROGRESS", assessments: { weaknesses?: string[]; invalidReasons?: string[]; executionIssues?: string[] }[], misses: string[] = []) {
    weekOffset += 1;
    const a = await prisma.weeklyTradeAudit.create({
      data: { userId, weekStart: new Date(`${weekStart}T00:00:00Z`), weekEnd: new Date(`${weekStart}T00:00:00Z`), scopeKey: `*|*${weekOffset}`, status, finalizedAt: status === "FINALIZED" ? new Date() : null },
    });
    for (const x of assessments) {
      await prisma.tradeAuditAssessment.create({
        data: {
          userId,
          auditId: a.id,
          dateKey: new Date(`${weekStart}T00:00:00Z`),
          weaknesses: (x.weaknesses ?? []) as never,
          invalidReasons: (x.invalidReasons ?? []) as never,
          executionIssues: (x.executionIssues ?? []) as never,
        },
      });
    }
    for (const m of misses) {
      await prisma.auditExpectedTrade.create({
        data: { userId, auditId: a.id, dateKey: new Date(`${weekStart}T00:00:00Z`), clientKey: `${a.id}-${m}`, assetSymbol: "X", direction: "LONG", validityReason: "v", missReason: m as never },
      });
    }
    return a;
  }

  it("shows the normal experience with no review history", async () => {
    const user = await makeUser("rec-empty");
    expect((await loadMindsetDashboard(user.id)).recommendations).toEqual([]);
  });

  it("ignores in-progress reviews and isolated mistakes", async () => {
    const user = await makeUser("rec-insufficient");
    await audit(user.id, "2026-11-16", "IN_PROGRESS", [{ invalidReasons: ["REVENGE"] }, { invalidReasons: ["REVENGE"] }]);
    await audit(user.id, "2026-11-09", "FINALIZED", [{ invalidReasons: ["REVENGE"] }]);
    await audit(user.id, "2026-11-02", "FINALIZED", [{ weaknesses: ["IMPATIENCE"] }]);
    expect(await getRecommendations(user.id)).toEqual([]);
  });

  it("recommends from a recurring pattern in finalized reviews, and respects dismissal until new evidence arrives", async () => {
    const user = await makeUser("rec-recurring");
    await audit(user.id, "2026-11-09", "FINALIZED", [{ invalidReasons: ["EARLY_ENTRY"] }, { executionIssues: ["NO_CONFIRMATION"] }]);
    await audit(user.id, "2026-11-02", "FINALIZED", [{ executionIssues: ["ENTRY_TIMING"] }]);
    const [rec] = await getRecommendations(user.id);
    expect(rec).toMatchObject({ pattern: "CONFIRMATION", title: "Waiting for Confirmation", reviewCount: 2, occurrences: 3 });

    await dismissRecommendation(user.id, rec.key);
    expect(await getRecommendations(user.id)).toEqual([]);
    // Saved mantras are never changed by a recommendation.
    await ensureMindsetDefaults(user.id);
    const before = await listMantras(user.id);

    await audit(user.id, "2026-11-16", "FINALIZED", [{ invalidReasons: ["EARLY_ENTRY"] }]);
    const [again] = await getRecommendations(user.id);
    expect(again.pattern).toBe("CONFIRMATION");
    expect(again.key).not.toBe(rec.key);
    expect(await listMantras(user.id)).toEqual(before);
  });

  it("counts weaknesses and miss reasons recorded on missed setups", async () => {
    const user = await makeUser("rec-misses");
    await audit(user.id, "2026-11-09", "FINALIZED", [], ["HESITATION", "FEAR"]);
    await audit(user.id, "2026-11-02", "FINALIZED", [{ executionIssues: ["PREMATURE_EXIT"] }]);
    expect((await getRecommendations(user.id)).map((r) => r.pattern)).toEqual(["TRUST_PROCESS"]);
  });
});
