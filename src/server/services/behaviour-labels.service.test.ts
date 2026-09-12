import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade } from "@/server/services/trades.service";
import * as svc from "@/server/services/behaviour-labels.service";
import { DEFAULT_BEHAVIOUR_LABELS } from "@/domain/behaviour-labels/defaults";
import type { TradeInput } from "@/lib/validation/trades";

/** Trade Review overhaul (Stage 7 §8) — real integration tests against the
 *  dev Postgres DB, same pattern as strategy-setup-types.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `behaviour-labels-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: null,
    actualRR: null,
    performanceRiskPercentOverride: null,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {},
    setupTypeId: null,
    selectedSetupConditions: [],
    setupOverrideReason: null,
    setupOverrideNote: null,
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    preTradeMoodNote: null,
    ...overrides,
  };
}

describe("behaviour-labels.service — catalog", () => {
  it("seeds the full default catalog on first use (12 positive + 21 negative)", async () => {
    const user = await makeUser("seed");
    const labels = await svc.listBehaviourLabels(user.id);
    expect(labels).toHaveLength(DEFAULT_BEHAVIOUR_LABELS.length);
    expect(labels.filter((l) => l.polarity === "POSITIVE")).toHaveLength(12);
    expect(labels.filter((l) => l.polarity === "NEGATIVE")).toHaveLength(21);
    expect(labels.every((l) => l.isDefault)).toBe(true);
  });

  it("never re-seeds once a user already has labels, even if all are archived", async () => {
    const user = await makeUser("no-reseed");
    const first = await svc.listBehaviourLabels(user.id);
    for (const label of first) {
      await svc.archiveBehaviourLabel(user.id, label.id);
    }
    const second = await svc.listBehaviourLabels(user.id);
    expect(second).toHaveLength(0);
  });

  it("creates a custom label and rejects a case-insensitive duplicate name", async () => {
    const user = await makeUser("custom-create");
    await svc.listBehaviourLabels(user.id); // seed first
    const created = await svc.createBehaviourLabel(user.id, {
      name: "Waited for London open",
      polarity: "POSITIVE",
      color: "TEAL",
    });
    expect(created.polarity).toBe("POSITIVE");

    await expect(
      svc.createBehaviourLabel(user.id, { name: "waited for london open", polarity: "POSITIVE", color: "GRAY" }),
    ).rejects.toThrow(/already exists/i);
  });

  it("archiving a label hides it from the catalog listing", async () => {
    const user = await makeUser("archive");
    const created = await svc.createBehaviourLabel(user.id, { name: "Custom Label", polarity: "NEGATIVE", color: "RED" });
    await svc.archiveBehaviourLabel(user.id, created.id);
    const labels = await svc.listBehaviourLabels(user.id);
    expect(labels.some((l) => l.id === created.id)).toBe(false);
  });

  it("labels are isolated across users — each gets their own seeded catalog", async () => {
    const a = await makeUser("isolation-a");
    const b = await makeUser("isolation-b");
    const labelsA = await svc.listBehaviourLabels(a.id);
    await svc.createBehaviourLabel(a.id, { name: "A-only label", polarity: "POSITIVE", color: "GREEN" });
    const labelsB = await svc.listBehaviourLabels(b.id);

    expect(labelsA.map((l) => l.userId).every((id) => id === a.id)).toBe(true);
    expect(labelsB.map((l) => l.userId).every((id) => id === b.id)).toBe(true);
    expect(labelsB.some((l) => l.name === "A-only label")).toBe(false);
  });
});

describe("behaviour-labels.service — trade assignment", () => {
  it("attaches multiple labels to a trade and isolates them from another trade", async () => {
    const user = await makeUser("trade-multi");
    const labels = await svc.listBehaviourLabels(user.id);
    const positive = labels.filter((l) => l.polarity === "POSITIVE").slice(0, 2);
    const negative = labels.find((l) => l.polarity === "NEGATIVE")!;

    const tradeA = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    const tradeB = await createTrade(user.id, "2026-01-06", minimalTradeInput());

    await svc.setTradeBehaviourLabels(user.id, tradeA.id, [positive[0].id, positive[1].id]);
    await svc.setTradeBehaviourLabels(user.id, tradeB.id, [negative.id]);

    const attachedA = await svc.listTradeBehaviourLabels(user.id, tradeA.id);
    const attachedB = await svc.listTradeBehaviourLabels(user.id, tradeB.id);

    expect(attachedA.map((l) => l.id).sort()).toEqual([positive[0].id, positive[1].id].sort());
    expect(attachedB.map((l) => l.id)).toEqual([negative.id]);
  });

  it("replacing the set removes labels no longer selected", async () => {
    const user = await makeUser("replace-set");
    const labels = await svc.listBehaviourLabels(user.id);
    const [a, b] = labels;
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());

    await svc.setTradeBehaviourLabels(user.id, trade.id, [a.id, b.id]);
    expect(await svc.listTradeBehaviourLabels(user.id, trade.id)).toHaveLength(2);

    await svc.setTradeBehaviourLabels(user.id, trade.id, [a.id]);
    const after = await svc.listTradeBehaviourLabels(user.id, trade.id);
    expect(after.map((l) => l.id)).toEqual([a.id]);
  });

  it("silently drops a label id that doesn't belong to the user (cross-user protection)", async () => {
    const owner = await makeUser("cross-user-owner");
    const attacker = await makeUser("cross-user-attacker");
    const ownerLabels = await svc.listBehaviourLabels(owner.id);
    const attackerTrade = await createTrade(attacker.id, "2026-01-05", minimalTradeInput());

    await svc.setTradeBehaviourLabels(attacker.id, attackerTrade.id, [ownerLabels[0].id]);
    const attached = await svc.listTradeBehaviourLabels(attacker.id, attackerTrade.id);
    expect(attached).toHaveLength(0);
  });
});
