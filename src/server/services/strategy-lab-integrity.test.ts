import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import * as strategies from "@/server/services/strategies.service";
import * as sot from "@/server/services/strategy-sot.service";
import * as st from "@/server/services/strategy-setup-types.service";
import { StrategyLabError, toStrategyActionError } from "@/server/services/strategy-errors";
import { checklistInput, makeTestUser } from "@/server/testing/strategy-fixture";

/** Regression tests for Strategy Lab audit findings #5–#10. */

const userIds: string[] = [];
async function setup(label: string) {
  const u = await makeTestUser(`integrity-${label}`);
  userIds.push(u.id);
  const s = await strategies.createStrategy(u.id, { name: `S ${label}`, description: undefined });
  return { userId: u.id, strategyId: s.id };
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function bullishScenarioId(userId: string, strategyId: string, setupTypeId: string) {
  const types = await st.listSetupTypesWithScenarios(userId, strategyId);
  return types.find((t) => t.id === setupTypeId)!.scenarios.find((s) => s.direction === "BULLISH")!.id;
}

describe("#5 archived setup-type names can be reused", () => {
  it("allows re-creating an archived name, still rejects live duplicates with a readable message", async () => {
    const { userId, strategyId } = await setup("reuse");
    const first = await st.createSetupType(userId, strategyId, { name: "Type A" });
    await st.archiveSetupType(userId, first.id);
    const again = await st.createSetupType(userId, strategyId, { name: "Type A" });
    expect(again.id).not.toBe(first.id);
    await expect(st.createSetupType(userId, strategyId, { name: "Type A" })).rejects.toThrow(
      "A setup type with this name already exists.",
    );
  });

  it("the DB index alone (bypassing the app check) still blocks two LIVE rows, and maps to the same message", async () => {
    const { userId, strategyId } = await setup("reuse-race");
    await st.createSetupType(userId, strategyId, { name: "Race" });
    const raw = prisma.strategySetupType.create({ data: { userId, strategyId, name: "Race" } });
    await expect(raw).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("#6 confluence direction changes can't invalidate scenarios", () => {
  it("refuses switching a confluence used in a Bullish scenario to BEARISH-only, names the scenario", async () => {
    const { userId, strategyId } = await setup("dir");
    const c = await sot.createChecklistItem(userId, strategyId, "CONFLUENCE", checklistInput({ name: "Sweep" }));
    const t = await st.createSetupType(userId, strategyId, { name: "Type A" });
    await st.addScenarioCondition(userId, await bullishScenarioId(userId, strategyId, t.id), { checklistItemId: c.id });

    await expect(
      sot.updateChecklistItem(userId, c.id, checklistInput({ name: "Sweep", directionApplicability: "BEARISH" })),
    ).rejects.toThrow(/Type A › Bullish/);
    // BULLISH is still compatible with the Bullish scenario.
    await sot.updateChecklistItem(userId, c.id, checklistInput({ name: "Sweep", directionApplicability: "BULLISH" }));
    const eff = await st.getEffectiveScenario(userId, t.id, "LONG");
    expect(eff?.conditions.map((x) => x.directionApplicability)).toEqual(["BULLISH"]);
  });

  it("allows a direction change once the item is only in archived scenarios", async () => {
    const { userId, strategyId } = await setup("dir-archived");
    const c = await sot.createChecklistItem(userId, strategyId, "CONFLUENCE", checklistInput({ name: "Sweep" }));
    const t = await st.createSetupType(userId, strategyId, { name: "Type A" });
    await st.addScenarioCondition(userId, await bullishScenarioId(userId, strategyId, t.id), { checklistItemId: c.id });
    await st.archiveSetupType(userId, t.id);
    await expect(
      sot.updateChecklistItem(userId, c.id, checklistInput({ name: "Sweep", directionApplicability: "BEARISH" })),
    ).resolves.toBeUndefined();
  });
});

describe("#7 disabled confluences are never scored through a setup type", () => {
  it("excludes a disabled mandatory confluence from the effective scenario", async () => {
    const { userId, strategyId } = await setup("disabled");
    const off = await sot.createChecklistItem(userId, strategyId, "CONFLUENCE", checklistInput({ name: "Off", mandatory: true }));
    const on = await sot.createChecklistItem(userId, strategyId, "CONFLUENCE", checklistInput({ name: "On" }));
    const t = await st.createSetupType(userId, strategyId, { name: "Type A" });
    const scenarioId = await bullishScenarioId(userId, strategyId, t.id);
    await st.addScenarioCondition(userId, scenarioId, { checklistItemId: off.id });
    await st.addScenarioCondition(userId, scenarioId, { checklistItemId: on.id });
    await sot.updateChecklistItem(userId, off.id, checklistInput({ name: "Off", mandatory: true, enabled: false }));

    const eff = await st.getEffectiveScenario(userId, t.id, "LONG");
    expect(eff?.conditions.map((c) => c.name)).toEqual(["On"]);
    const ref = await strategies.getStrategyReference(userId, strategyId);
    expect(ref?.confluences.map((c) => c.name)).toEqual(["On"]); // reference list agrees
  });
});

describe("#8 setup types of deleted strategies never load", () => {
  it("getEffectiveScenario returns null once the parent strategy is deleted", async () => {
    const { userId, strategyId } = await setup("deadstrat");
    const t = await st.createSetupType(userId, strategyId, { name: "Type A" });
    expect(await st.getEffectiveScenario(userId, t.id, "LONG")).not.toBeNull();
    await strategies.deleteStrategy(userId, strategyId);
    expect(await st.getEffectiveScenario(userId, t.id, "LONG")).toBeNull();
  });
});

describe("#9 readable errors, ownership enforced", () => {
  it("editing/deleting another user's or a deleted item fails with a readable error, not a Prisma one", async () => {
    const a = await setup("own-a");
    const b = await setup("own-b");
    const item = await sot.createChecklistItem(a.userId, a.strategyId, "CONFLUENCE", checklistInput({ name: "A's" }));
    const session = await sot.createStrategySession(a.userId, a.strategyId, { name: "London", color: "GRAY", enabled: true });

    for (const attempt of [
      () => sot.deleteChecklistItem(b.userId, item.id),
      () => sot.updateChecklistItem(b.userId, item.id, checklistInput({ name: "hijack" })),
      () => sot.deleteStrategySession(b.userId, session.id),
      () => sot.updateStrategySession(b.userId, session.id, { name: "hijack", color: "GRAY", enabled: true }),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(StrategyLabError);
    }
    // Untouched.
    expect((await sot.listStrategyChecklist(a.userId, a.strategyId, "CONFLUENCE"))[0].name).toBe("A's");

    await sot.deleteChecklistItem(a.userId, item.id);
    await expect(sot.deleteChecklistItem(a.userId, item.id)).rejects.toThrow(/already deleted/);
    await expect(sot.updateChecklistItem(a.userId, "does-not-exist", checklistInput({ name: "x" }))).rejects.toThrow(/no longer exists/);
  });

  it("toStrategyActionError never leaks raw database messages", () => {
    const known = (code: string) =>
      new Prisma.PrismaClientKnownRequestError("Invalid `prisma.x.update()` invocation: secret internals", { code, clientVersion: "x" });
    expect(toStrategyActionError(known("P2002"), "fallback")).toMatch(/already in use/);
    expect(toStrategyActionError(known("P2025"), "fallback")).toMatch(/no longer exists/);
    expect(toStrategyActionError(known("P9999"), "fallback")).toBe("fallback");
    expect(toStrategyActionError(new StrategyLabError("Readable."), "fallback")).toBe("Readable.");
    expect(toStrategyActionError("weird", "fallback")).toBe("fallback");
  });
});

describe("#10 concurrent publishing", () => {
  it("two simultaneous publishes create exactly one version and fail the other with a clear conflict", async () => {
    const { userId, strategyId } = await setup("race");
    const results = await Promise.allSettled([
      strategies.publishStrategyVersion(userId, strategyId, "a"),
      strategies.publishStrategyVersion(userId, strategyId, "b"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(StrategyLabError);
    expect(failed[0].reason.message).toMatch(/just published/);

    const versions = await prisma.strategyVersion.findMany({ where: { strategyId } });
    expect(versions.map((v) => v.version)).toEqual([1]);
    expect((await strategies.getStrategy(userId, strategyId))?.version).toBe(2);

    // A later, sequential publish continues the numbering cleanly.
    await strategies.publishStrategyVersion(userId, strategyId, null);
    const after = await prisma.strategyVersion.findMany({ where: { strategyId }, orderBy: { version: "asc" } });
    expect(after.map((v) => v.version)).toEqual([1, 2]);
  });
});

describe("opening a strategy never writes", () => {
  it("getTradeManagement is read-only; ensureTradeManagement creates once, scoped to the owner", async () => {
    const { userId, strategyId } = await setup("lazy-tm");
    const tmSvc = await import("@/server/services/strategy-trade-management.service");
    expect(await tmSvc.getTradeManagement(userId, strategyId)).toBeNull();
    expect(await prisma.strategyTradeManagement.count({ where: { strategyId } })).toBe(0);

    const [a, b] = await Promise.all([
      tmSvc.ensureTradeManagement(userId, strategyId),
      tmSvc.ensureTradeManagement(userId, strategyId),
    ]);
    expect(a).toBe(b);
    expect(await prisma.strategyTradeManagement.count({ where: { strategyId } })).toBe(1);

    const intruder = await setup("lazy-tm-intruder");
    await expect(tmSvc.ensureTradeManagement(intruder.userId, strategyId)).rejects.toThrow(/not found/i);
  });
});
