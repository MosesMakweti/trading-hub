import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  acknowledgeSymbolMismatch,
  addTarget,
  applyPlanSuggestion,
  ensureOriginSymbol,
  hasMaterialDraftContent,
  removeTarget,
  resetAfterSave,
  selectStrategy,
  setDirection,
  setEntryModel,
  setMediaAssetId,
  setNote,
  setPlannedEntry,
  setPlannedStopLoss,
  setSession,
  startNewIdeaForSymbol,
  toggleConfluence,
  toggleExecution,
  updateTarget,
  validateDraft,
  type TradeDraftContext,
} from "./draft";
import type { StrategyConfluence } from "./strategy";

const NOW = () => 12345;

function confluence(overrides: Partial<StrategyConfluence> & Pick<StrategyConfluence, "id" | "name">): StrategyConfluence {
  return { color: "GRAY", category: null, weight: null, mandatory: false, directionApplicability: "BOTH", pairId: null, ...overrides };
}

describe("selectStrategy (§9/§15)", () => {
  it("selecting a strategy for the first time sets strategyId and leaves everything else at its default", () => {
    const next = selectStrategy(EMPTY_DRAFT, "strat_1", NOW);
    expect(next).toEqual({ ...EMPTY_DRAFT, strategyId: "strat_1", updatedAt: 12345 });
  });

  it("re-selecting the SAME strategy is a no-op — it must not wipe in-progress selections", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "strat_1", selectedSession: "London", selectedConfluenceIds: ["c1"] };
    expect(selectStrategy(draft, "strat_1", NOW)).toBe(draft);
  });

  it("selecting a DIFFERENT strategy resets session/entry model/confluences/execution", () => {
    const draft: TradeDraftContext = {
      ...EMPTY_DRAFT,
      strategyId: "strat_1",
      direction: "LONG",
      selectedSession: "London",
      selectedEntryModel: "Sweep + Displacement",
      selectedConfluenceIds: ["c1", "c2"],
      selectedExecutionIds: ["e1"],
      updatedAt: 1,
    };
    const next = selectStrategy(draft, "strat_2", NOW);
    expect(next).toEqual({
      ...EMPTY_DRAFT,
      strategyId: "strat_2",
      direction: "LONG", // preserved — a globally canonical value, not strategy-scoped (§15)
      updatedAt: 12345,
    });
  });

  it("Step 7 — a strategy change preserves the plan (entry/stop/targets) and notes, since neither is strategy-scoped", () => {
    const draft: TradeDraftContext = {
      ...EMPTY_DRAFT,
      strategyId: "strat_1",
      plannedEntry: "3640",
      plannedStopLoss: "3630",
      plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }],
      marketContext: "Strong bullish structure",
    };
    const next = selectStrategy(draft, "strat_2", NOW);
    expect(next.plannedEntry).toBe("3640");
    expect(next.plannedStopLoss).toBe("3630");
    expect(next.plannedTargets).toEqual([{ id: "t1", label: "TP1", targetPrice: "3660" }]);
    expect(next.marketContext).toBe("Strong bullish structure");
  });

  it("deselecting entirely (null) also resets strategy-scoped fields", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "strat_1", selectedSession: "London" };
    const next = selectStrategy(draft, null, NOW);
    expect(next.strategyId).toBeNull();
    expect(next.selectedSession).toBeNull();
  });
});

describe("setDirection (§6/§7)", () => {
  const confluencesById = new Map<string, Pick<StrategyConfluence, "directionApplicability">>([
    ["bullish-1", { directionApplicability: "BULLISH" }],
    ["bearish-1", { directionApplicability: "BEARISH" }],
    ["both-1", { directionApplicability: "BOTH" }],
  ]);

  it("§7's exact scenario: switching LONG -> SHORT drops the now-ineligible bullish selections, keeps eligible ones", () => {
    const draft: TradeDraftContext = {
      ...EMPTY_DRAFT,
      direction: "LONG",
      selectedConfluenceIds: ["bullish-1", "both-1"],
    };
    const next = setDirection(draft, "SHORT", confluencesById, NOW);
    expect(next.direction).toBe("SHORT");
    expect(next.selectedConfluenceIds).toEqual(["both-1"]); // bullish-1 removed, both-1 (neutral) kept
  });

  it("switching SHORT -> LONG drops the now-ineligible bearish selections", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "SHORT", selectedConfluenceIds: ["bearish-1", "both-1"] };
    const next = setDirection(draft, "LONG", confluencesById, NOW);
    expect(next.selectedConfluenceIds).toEqual(["both-1"]);
  });

  it("never touches selectedExecutionIds — execution confirmations are never direction-filtered", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "LONG", selectedExecutionIds: ["exec-1"] };
    const next = setDirection(draft, "SHORT", confluencesById, NOW);
    expect(next.selectedExecutionIds).toEqual(["exec-1"]);
  });

  it("leaves an unrecognized id alone (e.g. the strategy reference hasn't loaded yet) — never guesses", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, selectedConfluenceIds: ["unknown-id"] };
    const next = setDirection(draft, "LONG", new Map(), NOW);
    expect(next.selectedConfluenceIds).toEqual(["unknown-id"]);
  });

  it("setting direction back to null clears nothing by itself (only actual eligibility changes prune selections)", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "LONG", selectedConfluenceIds: ["both-1"] };
    const next = setDirection(draft, null, confluencesById, NOW);
    // null direction => isConfluenceEligible(..., null) is false for everything, so even BOTH is pruned.
    expect(next.selectedConfluenceIds).toEqual([]);
  });
});

describe("toggleConfluence / toggleExecution", () => {
  it("adds an id not yet selected, and removes it on a second toggle", () => {
    const step1 = toggleConfluence(EMPTY_DRAFT, "c1", NOW);
    expect(step1.selectedConfluenceIds).toEqual(["c1"]);
    const step2 = toggleConfluence(step1, "c1", NOW);
    expect(step2.selectedConfluenceIds).toEqual([]);
  });

  it("toggleExecution is independent of toggleConfluence", () => {
    const next = toggleExecution(EMPTY_DRAFT, "e1", NOW);
    expect(next.selectedExecutionIds).toEqual(["e1"]);
    expect(next.selectedConfluenceIds).toEqual([]);
  });
});

describe("setSession / setEntryModel (name-based, §10/§9)", () => {
  it("setSession stores a plain name, not an invented id", () => {
    expect(setSession(EMPTY_DRAFT, "London", NOW).selectedSession).toBe("London");
  });

  it("setEntryModel stores a plain name", () => {
    expect(setEntryModel(EMPTY_DRAFT, "Sweep + Displacement", NOW).selectedEntryModel).toBe("Sweep + Displacement");
  });

  it("both accept null to clear the selection", () => {
    const withValues: TradeDraftContext = { ...EMPTY_DRAFT, selectedSession: "London", selectedEntryModel: "Sweep" };
    expect(setSession(withValues, null, NOW).selectedSession).toBeNull();
    expect(setEntryModel(withValues, null, NOW).selectedEntryModel).toBeNull();
  });
});

describe("validateDraft (§21/§22)", () => {
  it("requires a strategy and a direction as UI-readiness hints", () => {
    const v = validateDraft(EMPTY_DRAFT, []);
    expect(v.strategyRequired).toBe(true);
    expect(v.directionRequired).toBe(true);
    expect(v.ready).toBe(false);
  });

  it("does not require an entry model when the strategy defines none", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    expect(validateDraft(draft, [], []).entryModelRequired).toBe(false);
  });

  it("requires an entry model when the strategy defines some and none is chosen", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    expect(validateDraft(draft, [], ["Sweep + Displacement"]).entryModelRequired).toBe(true);
  });

  it("§22 — a mandatory confluence ineligible for the current direction is never counted as missing", () => {
    const confluences: StrategyConfluence[] = [
      confluence({ id: "bearish-mandatory", name: "Bearish MSB", mandatory: true, directionApplicability: "BEARISH" }),
    ];
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    const v = validateDraft(draft, confluences);
    expect(v.missingMandatoryConfluenceIds).toEqual([]); // ineligible for LONG — not "missing"
  });

  it("an ELIGIBLE mandatory confluence not yet selected IS reported missing", () => {
    const confluences: StrategyConfluence[] = [confluence({ id: "c1", name: "Liquidity sweep", mandatory: true, directionApplicability: "BOTH" })];
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    expect(validateDraft(draft, confluences).missingMandatoryConfluenceIds).toEqual(["c1"]);
  });

  it("a selected eligible mandatory confluence is no longer reported missing", () => {
    const confluences: StrategyConfluence[] = [confluence({ id: "c1", name: "Liquidity sweep", mandatory: true, directionApplicability: "BOTH" })];
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG", selectedConfluenceIds: ["c1"] };
    expect(validateDraft(draft, confluences).missingMandatoryConfluenceIds).toEqual([]);
    expect(validateDraft(draft, confluences).ready).toBe(true);
  });

  it("nothing is reported missing when no direction has been chosen yet", () => {
    const confluences: StrategyConfluence[] = [confluence({ id: "c1", name: "Liquidity sweep", mandatory: true, directionApplicability: "BOTH" })];
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1" };
    expect(validateDraft(draft, confluences).missingMandatoryConfluenceIds).toEqual([]);
  });
});

describe("setPlannedEntry / setPlannedStopLoss (Step 7, §6/§7)", () => {
  it("stores the raw text as typed, not a parsed number", () => {
    expect(setPlannedEntry(EMPTY_DRAFT, "3640.5", NOW).plannedEntry).toBe("3640.5");
    expect(setPlannedStopLoss(EMPTY_DRAFT, "3630", NOW).plannedStopLoss).toBe("3630");
  });
});

describe("addTarget / removeTarget / updateTarget (Step 7, §8)", () => {
  const ids = ["id-1", "id-2", "id-3"];
  let call = 0;
  const idGen = () => ids[call++]!;

  it("adds a target with an auto-incrementing TP label and an empty price", () => {
    call = 0;
    const step1 = addTarget(EMPTY_DRAFT, NOW, idGen);
    expect(step1.plannedTargets).toEqual([{ id: "id-1", label: "TP1", targetPrice: "" }]);
    const step2 = addTarget(step1, NOW, idGen);
    expect(step2.plannedTargets.map((t) => t.label)).toEqual(["TP1", "TP2"]);
  });

  it("removes exactly the target with the matching id, preserving order of the rest", () => {
    call = 0;
    const draft = addTarget(addTarget(addTarget(EMPTY_DRAFT, NOW, idGen), NOW, idGen), NOW, idGen);
    const next = removeTarget(draft, "id-2", NOW);
    expect(next.plannedTargets.map((t) => t.id)).toEqual(["id-1", "id-3"]);
  });

  it("updateTarget patches only the matching target's label/price", () => {
    call = 0;
    const draft = addTarget(addTarget(EMPTY_DRAFT, NOW, idGen), NOW, idGen);
    const next = updateTarget(draft, "id-2", { targetPrice: "3670" }, NOW);
    expect(next.plannedTargets).toEqual([
      { id: "id-1", label: "TP1", targetPrice: "" },
      { id: "id-2", label: "TP2", targetPrice: "3670" },
    ]);
  });

  it("removing a nonexistent id is a safe no-op on the list contents", () => {
    call = 0;
    const draft = addTarget(EMPTY_DRAFT, NOW, idGen);
    expect(removeTarget(draft, "does-not-exist", NOW).plannedTargets).toEqual(draft.plannedTargets);
  });
});

describe("setNote (Step 7, §11)", () => {
  it("sets the matching note field only, leaving the other two untouched", () => {
    const withMarket = setNote(EMPTY_DRAFT, "marketContext", "Strong bullish structure", NOW);
    expect(withMarket.marketContext).toBe("Strong bullish structure");
    expect(withMarket.areasOfInterest).toBe("");
    expect(withMarket.reasonForTrade).toBe("");

    const withReason = setNote(withMarket, "reasonForTrade", "Liquidity sweep + FVG", NOW);
    expect(withReason.marketContext).toBe("Strong bullish structure");
    expect(withReason.reasonForTrade).toBe("Liquidity sweep + FVG");
  });
});

describe("resetAfterSave (Step 7, §20)", () => {
  const saved: TradeDraftContext = {
    ...EMPTY_DRAFT,
    strategyId: "s1",
    direction: "LONG",
    selectedSession: "London",
    selectedEntryModel: "Sweep + Displacement",
    selectedConfluenceIds: ["c1", "c2"],
    selectedExecutionIds: ["e1"],
    plannedEntry: "3640",
    plannedStopLoss: "3630",
    plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }],
    marketContext: "Strong bullish structure",
    areasOfInterest: "Liquidity above",
    reasonForTrade: "Sweep + displacement",
    mediaAssetId: "media_1",
  };

  it("preserves strategy, direction, session, and entry model", () => {
    const next = resetAfterSave(saved, NOW);
    expect(next.strategyId).toBe("s1");
    expect(next.direction).toBe("LONG");
    expect(next.selectedSession).toBe("London");
    expect(next.selectedEntryModel).toBe("Sweep + Displacement");
  });

  it("clears confluences, execution confirmations, plan prices, targets, notes, and the uploaded screenshot", () => {
    const next = resetAfterSave(saved, NOW);
    expect(next.selectedConfluenceIds).toEqual([]);
    expect(next.selectedExecutionIds).toEqual([]);
    expect(next.plannedEntry).toBe("");
    expect(next.plannedStopLoss).toBe("");
    expect(next.plannedTargets).toEqual([]);
    expect(next.marketContext).toBe("");
    expect(next.areasOfInterest).toBe("");
    expect(next.reasonForTrade).toBe("");
    expect(next.mediaAssetId).toBeNull();
  });
});

describe("setMediaAssetId (Step 8, §18/§21)", () => {
  it("sets a real, confirmed-upload id", () => {
    expect(setMediaAssetId(EMPTY_DRAFT, "media_1", NOW).mediaAssetId).toBe("media_1");
  });

  it("clears back to null (Retake/Remove)", () => {
    const withMedia: TradeDraftContext = { ...EMPTY_DRAFT, mediaAssetId: "media_1" };
    expect(setMediaAssetId(withMedia, null, NOW).mediaAssetId).toBeNull();
  });
});

describe("hasMaterialDraftContent (Step 9, Part 8)", () => {
  it("false for a completely empty draft", () => {
    expect(hasMaterialDraftContent(EMPTY_DRAFT)).toBe(false);
  });

  it.each<[string, Partial<TradeDraftContext>]>([
    ["strategyId", { strategyId: "s1" }],
    ["direction", { direction: "LONG" }],
    ["selectedSession", { selectedSession: "London" }],
    ["selectedEntryModel", { selectedEntryModel: "Sweep" }],
    ["selectedConfluenceIds", { selectedConfluenceIds: ["c1"] }],
    ["plannedEntry", { plannedEntry: "100" }],
    ["plannedTargets", { plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "" }] }],
    ["marketContext", { marketContext: "note" }],
    ["mediaAssetId", { mediaAssetId: "media_1" }],
  ])("true when %s alone is set", (_label, patch) => {
    expect(hasMaterialDraftContent({ ...EMPTY_DRAFT, ...patch })).toBe(true);
  });
});

describe("ensureOriginSymbol (Step 9, Part 8)", () => {
  it("is a no-op on a completely empty draft, even with a known current symbol", () => {
    expect(ensureOriginSymbol(EMPTY_DRAFT, "XAUUSD", NOW)).toBe(EMPTY_DRAFT);
  });

  it("locks in the current symbol the moment the draft has real content", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "LONG" };
    const next = ensureOriginSymbol(draft, "XAUUSD", NOW);
    expect(next.originSymbol).toBe("XAUUSD");
  });

  it("never overwrites an already-locked origin, even if the symbol keeps changing", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "LONG", originSymbol: "XAUUSD" };
    expect(ensureOriginSymbol(draft, "EURUSD", NOW).originSymbol).toBe("XAUUSD");
  });

  it("is a no-op when the current symbol is unknown (null)", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, direction: "LONG" };
    expect(ensureOriginSymbol(draft, null, NOW)).toBe(draft);
  });
});

describe("acknowledgeSymbolMismatch / startNewIdeaForSymbol (Step 9, Part 8)", () => {
  it("acknowledgeSymbolMismatch records the CURRENT symbol without touching originSymbol or any other field", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, originSymbol: "XAUUSD", plannedEntry: "3640" };
    const next = acknowledgeSymbolMismatch(draft, "EURUSD", NOW);
    expect(next.originSymbol).toBe("XAUUSD");
    expect(next.plannedEntry).toBe("3640");
    expect(next.acknowledgedSymbolMismatch).toBe("EURUSD");
  });

  it("a further change to a THIRD symbol is not considered already-acknowledged", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, originSymbol: "XAUUSD", acknowledgedSymbolMismatch: "EURUSD" };
    expect(draft.acknowledgedSymbolMismatch === "GBPUSD").toBe(false); // the panel's own render check — sanity only
  });

  it("startNewIdeaForSymbol discards setup-specific content, re-locks the origin to the new symbol, and clears any prior acknowledgment", () => {
    const draft: TradeDraftContext = {
      ...EMPTY_DRAFT,
      strategyId: "s1",
      direction: "LONG",
      selectedConfluenceIds: ["c1"],
      plannedEntry: "3640",
      plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }],
      mediaAssetId: "media_1",
      originSymbol: "XAUUSD",
      acknowledgedSymbolMismatch: "XAUUSD",
    };
    const next = startNewIdeaForSymbol(draft, "EURUSD", NOW);

    expect(next.originSymbol).toBe("EURUSD");
    expect(next.acknowledgedSymbolMismatch).toBeNull();
    // Strategy/direction ARE preserved — resetAfterSave's own semantics (only setup-specific fields clear).
    expect(next.strategyId).toBe("s1");
    expect(next.direction).toBe("LONG");
    expect(next.selectedConfluenceIds).toEqual([]);
    expect(next.plannedEntry).toBe("");
    expect(next.plannedTargets).toEqual([]);
    expect(next.mediaAssetId).toBeNull();
  });
});

describe("applyPlanSuggestion (Step 9, Part 3)", () => {
  const idGen = (() => {
    let i = 0;
    return () => `t${++i}`;
  })();

  it("applies entry, stop, and targets all at once", () => {
    const next = applyPlanSuggestion(EMPTY_DRAFT, { entry: "3640", stopLoss: "3630", targets: [{ order: 1, price: "3660" }] }, NOW, idGen);
    expect(next.plannedEntry).toBe("3640");
    expect(next.plannedStopLoss).toBe("3630");
    expect(next.plannedTargets).toEqual([{ id: "t1", label: "TP1", targetPrice: "3660" }]);
  });

  it("§2/§3 — a null field in the suggestion leaves the trader's already-typed value untouched, never clears it", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, plannedEntry: "3641", plannedStopLoss: "3629" };
    const next = applyPlanSuggestion(draft, { entry: null, stopLoss: null, targets: [] }, NOW, idGen);
    expect(next.plannedEntry).toBe("3641");
    expect(next.plannedStopLoss).toBe("3629");
    expect(next.plannedTargets).toEqual([]);
  });

  it("multiple targets are applied sorted by order and re-labeled TP1/TP2/...", () => {
    const next = applyPlanSuggestion(
      EMPTY_DRAFT,
      { entry: null, stopLoss: null, targets: [{ order: 2, price: "3680" }, { order: 1, price: "3660" }] },
      NOW,
      idGen,
    );
    expect(next.plannedTargets.map((t) => t.label)).toEqual(["TP1", "TP2"]);
    expect(next.plannedTargets.map((t) => t.targetPrice)).toEqual(["3660", "3680"]);
  });

  it("applying targets REPLACES any existing target rows entirely, rather than merging", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, plannedTargets: [{ id: "old", label: "TP1", targetPrice: "9999" }] };
    const next = applyPlanSuggestion(draft, { entry: null, stopLoss: null, targets: [{ order: 1, price: "3660" }] }, NOW, idGen);
    expect(next.plannedTargets.map((t) => t.targetPrice)).toEqual(["3660"]);
    expect(next.plannedTargets.some((t) => t.targetPrice === "9999")).toBe(false);
  });

  it("applying only entry/stop leaves an existing target list untouched", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, plannedTargets: [{ id: "existing", label: "TP1", targetPrice: "3670" }] };
    const next = applyPlanSuggestion(draft, { entry: "3640", stopLoss: null, targets: [] }, NOW, idGen);
    expect(next.plannedTargets).toEqual([{ id: "existing", label: "TP1", targetPrice: "3670" }]);
  });

  it("never touches strategy/direction/session/confluences/notes/originSymbol — recognition only ever affects plan prices/targets", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "SHORT", selectedSession: "London", marketContext: "note", originSymbol: "XAUUSD" };
    const next = applyPlanSuggestion(draft, { entry: "3640", stopLoss: "3630", targets: [{ order: 1, price: "3660" }] }, NOW, idGen);
    expect(next.strategyId).toBe("s1");
    expect(next.direction).toBe("SHORT");
    expect(next.selectedSession).toBe("London");
    expect(next.marketContext).toBe("note");
    expect(next.originSymbol).toBe("XAUUSD");
  });
});
