/**
 * Replay Setup Validation (Stage 14 §5-7) — reuses the EXACT Stage 3/4
 * scoring engine (`buildSetupValidationSnapshot`/`resolveValidationState`,
 * domain/trades/setup-validation.ts) rather than a second implementation.
 * The only Replay-specific work here is adapting the FROZEN historical
 * `StrategyVersionSnapshot` shape into that engine's existing input shape —
 * the scoring math itself is untouched and identical to a real Trade's.
 *
 * The result is written to `ReplayTrade.replayValidationSnapshot` — the
 * SAME `SetupValidationSnapshot` shape a real Trade uses, but never the same
 * ROW. This is what the trader WOULD have checked, not a rewrite of what
 * they actually did.
 */
import type { ResolvedSetupCondition } from "@/domain/strategies/setup-type-scoring";
import type {
  StrategyVersionSetupScenarioSnapshot,
  StrategyVersionSetupTypeSnapshot,
} from "@/types/strategies";

/** LONG -> Bullish scenario, SHORT -> Bearish scenario (§5) — the trader
 *  never separately picks a scenario direction. */
export function scenarioDirectionForTradeDirection(direction: "LONG" | "SHORT"): "BULLISH" | "BEARISH" {
  return direction === "LONG" ? "BULLISH" : "BEARISH";
}

/** Finds the historically-frozen scenario for a Setup Type + trade direction. */
export function findHistoricalScenario(
  setupTypes: StrategyVersionSetupTypeSnapshot[],
  setupTypeName: string,
  direction: "LONG" | "SHORT",
): { setupType: StrategyVersionSetupTypeSnapshot; scenario: StrategyVersionSetupScenarioSnapshot } | null {
  const setupType = setupTypes.find((s) => s.name === setupTypeName);
  if (!setupType) return null;
  const scenario = setupType.scenarios.find((s) => s.direction === scenarioDirectionForTradeDirection(direction));
  if (!scenario) return null;
  return { setupType, scenario };
}

/** Adapts the frozen historical condition shape into `ResolvedSetupCondition`
 *  — the live-resolution shape `buildSetupValidationSnapshot` expects.
 *  `id`/`color`/`kind` are synthesized placeholders: the scoring engine
 *  never reads them (see toScorableConfluences), they exist only to satisfy
 *  the shared type. */
export function toReplayResolvedConditions(
  scenario: StrategyVersionSetupScenarioSnapshot,
): ResolvedSetupCondition[] {
  return scenario.conditions.map((c) => ({
    id: c.checklistItemId,
    checklistItemId: c.checklistItemId,
    name: c.name,
    color: "GRAY",
    kind: "CONFLUENCE",
    directionApplicability: c.directionApplicability,
    weight: c.weight,
    mandatory: c.mandatory,
    sortOrder: c.sortOrder,
  }));
}
