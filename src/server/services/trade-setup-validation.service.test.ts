import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTrade, updateTradeSections } from "@/server/services/trades.service";
import { createStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as setupTypesSvc from "@/server/services/strategy-setup-types.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  strategy-setup-types.service.test.ts. Covers Stage 4 (Trade Idea
 *  Validation Shield): setupTypeId -> effective scenario -> validation
 *  state, override handling, freezing, and per-trade isolation. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `trade-setup-validation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

const confluence = (over: Record<string, unknown>) =>
  strategyChecklistItemSchema.parse({ name: "x", color: "GRAY", ...over });

/** Strategy with one Setup Type: a Bullish scenario (one mandatory + one
 *  optional condition) and a Bearish scenario (one mandatory condition). */
async function setupBullishBearish(label: string) {
  const user = await makeUser(label);
  const strategy = await createStrategy(user.id, { name: `Strategy ${label}`, description: undefined });

  const bullMandatory = await createChecklistItem(
    user.id,
    strategy.id,
    "CONFLUENCE",
    confluence({ name: "Bullish MSS", weight: 40, mandatory: true, directionApplicability: "BULLISH" }),
  );
  const bullOptional = await createChecklistItem(
    user.id,
    strategy.id,
    "CONFLUENCE",
    confluence({ name: "FVG Present", weight: 20, mandatory: false, directionApplicability: "BULLISH" }),
  );
  const bearMandatory = await createChecklistItem(
    user.id,
    strategy.id,
    "CONFLUENCE",
    confluence({ name: "Bearish MSS", weight: 40, mandatory: true, directionApplicability: "BEARISH" }),
  );

  const setupType = await setupTypesSvc.createSetupType(user.id, strategy.id, { name: "Type A" });
  const [withScenarios] = await setupTypesSvc.listSetupTypesWithScenarios(user.id, strategy.id);
  const bullishScenario = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
  const bearishScenario = withScenarios.scenarios.find((s) => s.direction === "BEARISH")!;

  await setupTypesSvc.addScenarioCondition(user.id, bullishScenario.id, { checklistItemId: bullMandatory.id });
  await setupTypesSvc.addScenarioCondition(user.id, bullishScenario.id, { checklistItemId: bullOptional.id });
  await setupTypesSvc.addScenarioCondition(user.id, bearishScenario.id, { checklistItemId: bearMandatory.id });

  return {
    userId: user.id,
    strategyId: strategy.id,
    setupTypeId: setupType.id,
    bullMandatory,
    bullOptional,
    bearMandatory,
    bullishScenarioId: bullishScenario.id,
    bearishScenarioId: bearishScenario.id,
  };
}

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

describe("Trade Idea Validation Shield (Stage 4)", () => {
  it("LONG resolves the Bullish scenario, and VALIDATED once its mandatory condition is checked", async () => {
    const s = await setupBullishBearish("long-bullish");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id],
      }),
    );
    expect(trade.setupScenarioId).toBe(s.bullishScenarioId);
    expect(trade.validationState).toBe("VALIDATED");
  });

  it("SHORT resolves the Bearish scenario", async () => {
    const s = await setupBullishBearish("short-bearish");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "SHORT",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bearMandatory.id],
      }),
    );
    expect(trade.setupScenarioId).toBe(s.bearishScenarioId);
    expect(trade.validationState).toBe("VALIDATED");
  });

  it("a strategy trade with no Setup Type selected uses the legacy flat-confluence flow untouched", async () => {
    const s = await setupBullishBearish("legacy-flow");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({ strategyId: s.strategyId, direction: "LONG", setupTypeId: null }),
    );
    expect(trade.setupTypeId).toBeNull();
    expect(trade.setupScenarioId).toBeNull();
    expect(trade.validationState).toBeNull();
    expect(trade.setupValidationSnapshot).toBeNull();
  });

  it("gates validation on mandatory conditions — missing one keeps it NOT_VALIDATED", async () => {
    const s = await setupBullishBearish("mandatory-gate");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [], // mandatory not checked
      }),
    );
    expect(trade.validationState).toBe("NOT_VALIDATED");
    const snapshot = trade.setupValidationSnapshot as unknown as { missingMandatoryConditionNames: string[] };
    expect(snapshot.missingMandatoryConditionNames).toEqual(["Bullish MSS"]);
  });

  it("optional conditions never block validation — mandatory-only selection still validates", async () => {
    const s = await setupBullishBearish("optional-non-blocking");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id], // optional (FVG) left unchecked
      }),
    );
    expect(trade.validationState).toBe("VALIDATED");
  });

  it("override requires it to actually be requested, preserves the reason and the incomplete checklist state", async () => {
    const s = await setupBullishBearish("override-preserve");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [], // mandatory NOT checked
        setupOverrideReason: "FOMO",
        setupOverrideNote: "Chart moved fast.",
      }),
    );
    expect(trade.validationState).toBe("OVERRIDDEN");
    expect(trade.overrideReason).toBe("FOMO");
    expect(trade.overrideNote).toBe("Chart moved fast.");
    const snapshot = trade.setupValidationSnapshot as unknown as {
      conditions: { checklistItemId: string; checked: boolean }[];
    };
    expect(snapshot.conditions.find((c) => c.checklistItemId === s.bullMandatory.id)?.checked).toBe(false);
  });

  it("the frozen snapshot survives a Strategy Lab edit to the Setup Type once the trade has an actual entry", async () => {
    const s = await setupBullishBearish("frozen-after-lock");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [], // NOT_VALIDATED — frozen exactly like this
      }),
    );
    expect(trade.validationState).toBe("NOT_VALIDATED");

    // Lock the trade the same way the real workspace does: the first actual entry.
    await updateTradeSections(s.userId, trade.id, { actualEntry: 1950 });

    // A later Strategy Lab edit adds a brand-new mandatory condition to the
    // very scenario this trade was validated against.
    const newMandatory = await createChecklistItem(
      s.userId,
      s.strategyId,
      "CONFLUENCE",
      confluence({ name: "Bullish Displacement", weight: 30, mandatory: true, directionApplicability: "BULLISH" }),
    );
    await setupTypesSvc.addScenarioCondition(s.userId, s.bullishScenarioId, { checklistItemId: newMandatory.id });

    // An unrelated resave of the trade must not pull in the live (now
    // different) scenario definition.
    const resaved = await updateTrade(
      s.userId,
      trade.id,
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id], // even a changed submission is ignored once locked
        executionMinutes: 600,
      }),
    );

    expect(resaved.validationState).toBe("NOT_VALIDATED");
    const snapshot = resaved.setupValidationSnapshot as unknown as { conditions: { checklistItemId: string }[] };
    expect(snapshot.conditions).toHaveLength(2); // still just the original mandatory + optional
    expect(snapshot.conditions.some((c) => c.checklistItemId === newMandatory.id)).toBe(false);
  });

  it("checked-state is isolated per trade — one trade's selection never leaks into another's", async () => {
    const s = await setupBullishBearish("isolation");
    const tradeA = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id],
      }),
    );
    const tradeB = await createTrade(
      s.userId,
      "2026-01-06",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id, s.bullOptional.id],
      }),
    );

    expect(tradeA.setupValidationSnapshot).not.toEqual(tradeB.setupValidationSnapshot);

    const refetchedA = await prisma.trade.findUniqueOrThrow({ where: { id: tradeA.id } });
    const snapshotA = refetchedA.setupValidationSnapshot as unknown as { score: number | null };
    const snapshotB = tradeB.setupValidationSnapshot as unknown as { score: number | null };
    expect(snapshotA.score).not.toBe(snapshotB.score);
    expect(snapshotB.score).toBe(100);
  });

  it("a direction change resolves a new scenario and does not carry over incompatible checked state", async () => {
    const s = await setupBullishBearish("direction-change");
    const trade = await createTrade(
      s.userId,
      "2026-01-05",
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "LONG",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id],
      }),
    );
    expect(trade.setupScenarioId).toBe(s.bullishScenarioId);
    expect(trade.validationState).toBe("VALIDATED");

    // Flip to SHORT, but simulate a client that failed to clear the stale
    // (bullish) checked ids — they must never satisfy the bearish gate.
    const flipped = await updateTrade(
      s.userId,
      trade.id,
      minimalTradeInput({
        strategyId: s.strategyId,
        direction: "SHORT",
        setupTypeId: s.setupTypeId,
        selectedSetupConditions: [s.bullMandatory.id],
      }),
    );
    expect(flipped.setupScenarioId).toBe(s.bearishScenarioId);
    expect(flipped.validationState).toBe("NOT_VALIDATED");
  });

  it("cross-user ownership is protected — another user's setupTypeId is rejected", async () => {
    const owner = await setupBullishBearish("cross-user-owner");
    const attacker = await makeUser("cross-user-attacker");
    const attackerStrategy = await createStrategy(attacker.id, { name: "Attacker Strategy", description: undefined });

    await expect(
      createTrade(
        attacker.id,
        "2026-01-05",
        minimalTradeInput({
          strategyId: attackerStrategy.id,
          direction: "LONG",
          setupTypeId: owner.setupTypeId,
          selectedSetupConditions: [],
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a Setup Type without a selected strategy", async () => {
    const s = await setupBullishBearish("invalid-no-strategy");
    await expect(
      createTrade(
        s.userId,
        "2026-01-05",
        minimalTradeInput({ strategyId: "", direction: "LONG", setupTypeId: s.setupTypeId }),
      ),
    ).rejects.toThrow(/strategy must be selected/i);
  });

  it("rejects a Setup Type that belongs to a different strategy than the one selected", async () => {
    const s = await setupBullishBearish("invalid-cross-strategy");
    const otherStrategy = await createStrategy(s.userId, { name: "Other Strategy", description: undefined });
    await expect(
      createTrade(
        s.userId,
        "2026-01-05",
        minimalTradeInput({ strategyId: otherStrategy.id, direction: "LONG", setupTypeId: s.setupTypeId }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("recomputes the validation state server-side rather than trusting a client-submitted value", async () => {
    const s = await setupBullishBearish("server-authoritative");
    const forged = minimalTradeInput({
      strategyId: s.strategyId,
      direction: "LONG",
      setupTypeId: s.setupTypeId,
      selectedSetupConditions: [], // mandatory NOT checked
    }) as TradeInput & { validationState: string };
    forged.validationState = "VALIDATED"; // no such field on TradeInput — a forged extra property

    const trade = await createTrade(s.userId, "2026-01-05", forged);
    expect(trade.validationState).toBe("NOT_VALIDATED");
  });
});
