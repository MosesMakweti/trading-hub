/**
 * Traditorium TradingView Extension — Step 6. `TradeDraftContext` — an
 * extension-owned, UNSAVED form draft. Deliberately NOT the Traditorium
 * `Trade` database model, and never treated as one (§3): nothing here is a
 * calculated score, an authoritative RR, a PnL, or a userId. It exists only
 * to remember what the trader has clicked in the side panel so far, using
 * the exact id/name shapes the real API contract uses for each field (see
 * @shared/strategy.ts's doc comment for the id-vs-name mapping).
 *
 * Every function here is a pure reducer: `(draft, ...) => draft`, no
 * chrome.* calls, no fetch, no Date.now() side effect the caller can't
 * control (a `now` param defaults to Date.now but tests can pin it) — so
 * every business rule in this file (§7's direction-change eligibility
 * pruning, §15's strategy-change reset) is unit-testable without mocking
 * anything. `src/background/draft-storage.ts` only persists whatever object
 * these functions produce; it contains no business rules of its own.
 */
import { isConfluenceEligible } from "./confluence-eligibility";
import type { StrategyConfluence, TradeDirection } from "./strategy";

/** Step 7 — a single planned target row. `id` is a client-only stable key
 *  (for the add/remove/reorder UI) — it is NEVER sent to the server; the
 *  server only ever sees `targetOrder` (the array's own position) and
 *  `label`/`targetPrice` (see @shared/trade-payload.ts). */
export interface PlannedTargetDraft {
  id: string;
  label: string;
  /** Raw text, exactly as typed — `""` means "not entered yet." Parsed and
   *  validated only at submission time (@shared/trade-payload.ts), never
   *  coerced while the trader is still typing. */
  targetPrice: string;
}

export interface TradeDraftContext {
  strategyId: string | null;
  direction: TradeDirection | null;
  /** A NAME, or null — see @shared/strategy.ts's doc comment (no session id
   *  exists in the API contract; this matches `tradeSchema.selectedSession`
   *  exactly). */
  selectedSession: string | null;
  /** A NAME, or null — same reasoning, matches
   *  `tradeSchema.selectedEntryModel`. */
  selectedEntryModel: string | null;
  /** Real `ChecklistItem` ids (confluences DO have ids in the API contract —
   *  see @shared/strategy.ts). Resolved to names against the loaded
   *  StrategyReference at submission time (@shared/trade-payload.ts) — never
   *  duplicated as a second name array here (§12). */
  selectedConfluenceIds: string[];
  selectedExecutionIds: string[];
  /** Step 7, §3/§6/§7 — PLANNED prices only, raw text (see PlannedTargetDraft).
   *  Never actual entry/exit/stop, never a result — this remains planning
   *  only (§24). */
  plannedEntry: string;
  plannedStopLoss: string;
  plannedTargets: PlannedTargetDraft[];
  /** Step 7, §11 — map directly to `apiTradeNotesSchema`'s three fields,
   *  nothing more. Raw text; `""` means "not entered." */
  marketContext: string;
  areasOfInterest: string;
  reasonForTrade: string;
  /** Step 8, §21 — set once a captured chart screenshot has been
   *  successfully UPLOADED (a real, existing `MediaAsset.id`). The
   *  screenshot's own bytes/preview are never persisted here or anywhere
   *  else in the draft (see panel/screenshot.ts's doc comment on why) —
   *  only this small id, which flows straight into
   *  `@shared/trade-payload.ts`'s built `CreateTradeRequest.mediaAssetId`
   *  (a top-level field, per `apiCreateTradeSchema` — not nested under
   *  `trade`) unchanged. Never set from anything other than a confirmed upload
   *  response — never optimistically from a local capture alone (§18: "do
   *  not treat a local screenshot as successfully persisted until the API
   *  confirms it"). */
  mediaAssetId: string | null;
  /** Step 9, Part 8 — the chart's display symbol (e.g. "XAUUSD") at the
   *  moment this draft first had any real content, "locked in" so a later
   *  symbol change on the TradingView tab can never silently relabel an
   *  in-progress idea. `null` until `ensureOriginSymbol` sets it (see
   *  below); once set, it — not the live chart context — is what
   *  `@shared/trade-payload.ts` uses as `trade.assetSymbol`. */
  originSymbol: string | null;
  /** The current chart symbol the trader has explicitly said "keep my
   *  {originSymbol} draft" against, via the "Chart changed" warning
   *  (`acknowledgeSymbolMismatch`). Suppresses that SAME warning on
   *  re-render; a further change to a THIRD symbol re-triggers it (this
   *  value won't match the new one either). */
  acknowledgedSymbolMismatch: string | null;
  updatedAt: number;
}

export const EMPTY_DRAFT: TradeDraftContext = {
  strategyId: null,
  direction: null,
  selectedSession: null,
  selectedEntryModel: null,
  selectedConfluenceIds: [],
  selectedExecutionIds: [],
  plannedEntry: "",
  plannedStopLoss: "",
  plannedTargets: [],
  marketContext: "",
  areasOfInterest: "",
  reasonForTrade: "",
  mediaAssetId: null,
  originSymbol: null,
  acknowledgedSymbolMismatch: null,
  updatedAt: 0,
};

type Now = () => number;

/**
 * §9/§15 — selecting a DIFFERENT strategy resets every strategy-scoped
 * selection (session/entry model/confluences/execution), since a name or id
 * that belonged to the previous strategy must never be silently carried into
 * a new one. Direction is intentionally preserved — it's a globally
 * canonical LONG/SHORT value, not strategy-scoped (§15: "Direction may
 * remain if it is globally canonical"). Re-selecting the SAME strategy is a
 * no-op — it must not wipe in-progress selections just because the trader
 * clicked the same option again.
 *
 * Step 7's plan (entry/stop/targets) and notes are DELIBERATELY preserved
 * across a strategy change — unlike session/entry-model/confluences, they
 * aren't strategy-scoped at all (a planned entry price has no relationship
 * to which strategy frames the idea), so there's nothing about them that a
 * different strategy could invalidate.
 */
export function selectStrategy(draft: TradeDraftContext, strategyId: string | null, now: Now = Date.now): TradeDraftContext {
  if (draft.strategyId === strategyId) return draft;
  return {
    ...draft,
    strategyId,
    selectedSession: null,
    selectedEntryModel: null,
    selectedConfluenceIds: [],
    selectedExecutionIds: [],
    updatedAt: now(),
  };
}

/**
 * §7 — changing direction removes any selected confluence no longer
 * eligible for the new direction (a BULLISH-only pick surviving a switch to
 * SHORT, left invisible in the UI, would be exactly the "hidden
 * incompatible selection" the spec forbids). BOTH/neutral selections, and
 * any id `confluencesById` doesn't recognize (e.g. the reference hasn't
 * loaded yet), are left untouched — this function only ever REMOVES a
 * selection it can positively confirm is now ineligible, never guesses.
 * Execution confirmations are never filtered here — the server itself never
 * direction-filters execution confirmations (§6 only covers confluences).
 */
export function setDirection(
  draft: TradeDraftContext,
  direction: TradeDirection | null,
  confluencesById: ReadonlyMap<string, Pick<StrategyConfluence, "directionApplicability">>,
  now: Now = Date.now,
): TradeDraftContext {
  const selectedConfluenceIds = draft.selectedConfluenceIds.filter((id) => {
    const confluence = confluencesById.get(id);
    if (!confluence) return true; // unknown id — leave it, never guess
    return isConfluenceEligible(confluence.directionApplicability, direction);
  });
  return { ...draft, direction, selectedConfluenceIds, updatedAt: now() };
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

export function toggleConfluence(draft: TradeDraftContext, confluenceId: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, selectedConfluenceIds: toggle(draft.selectedConfluenceIds, confluenceId), updatedAt: now() };
}

export function toggleExecution(draft: TradeDraftContext, executionId: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, selectedExecutionIds: toggle(draft.selectedExecutionIds, executionId), updatedAt: now() };
}

export function setSession(draft: TradeDraftContext, sessionName: string | null, now: Now = Date.now): TradeDraftContext {
  return { ...draft, selectedSession: sessionName, updatedAt: now() };
}

export function setEntryModel(draft: TradeDraftContext, entryModelName: string | null, now: Now = Date.now): TradeDraftContext {
  return { ...draft, selectedEntryModel: entryModelName, updatedAt: now() };
}

// --- Step 7 — trade plan (§6/§7/§8) ---------------------------------------

export function setPlannedEntry(draft: TradeDraftContext, value: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, plannedEntry: value, updatedAt: now() };
}

export function setPlannedStopLoss(draft: TradeDraftContext, value: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, plannedStopLoss: value, updatedAt: now() };
}

type IdGen = () => string;
const defaultIdGen: IdGen = () => crypto.randomUUID();

/** §8 — appends one target row, auto-labeled TP1/TP2/… by position. The
 *  label is only a starting suggestion; `updateTarget` can rename it. */
export function addTarget(draft: TradeDraftContext, now: Now = Date.now, idGen: IdGen = defaultIdGen): TradeDraftContext {
  const target: PlannedTargetDraft = { id: idGen(), label: `TP${draft.plannedTargets.length + 1}`, targetPrice: "" };
  return { ...draft, plannedTargets: [...draft.plannedTargets, target], updatedAt: now() };
}

export function removeTarget(draft: TradeDraftContext, targetId: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, plannedTargets: draft.plannedTargets.filter((t) => t.id !== targetId), updatedAt: now() };
}

export function updateTarget(
  draft: TradeDraftContext,
  targetId: string,
  patch: Partial<Pick<PlannedTargetDraft, "label" | "targetPrice">>,
  now: Now = Date.now,
): TradeDraftContext {
  return {
    ...draft,
    plannedTargets: draft.plannedTargets.map((t) => (t.id === targetId ? { ...t, ...patch } : t)),
    updatedAt: now(),
  };
}

// --- Step 7 — notes (§11) --------------------------------------------------

export type TradeNoteField = "marketContext" | "areasOfInterest" | "reasonForTrade";

export function setNote(draft: TradeDraftContext, field: TradeNoteField, value: string, now: Now = Date.now): TradeDraftContext {
  return { ...draft, [field]: value, updatedAt: now() };
}

// --- Step 9, Part 3 — applying a recognition suggestion --------------------

/** Kept structurally identical to `@shared/recognition-suggestions.ts`'s
 *  `PlanSuggestion` (imported as a type only, no runtime dependency) so
 *  draft.ts doesn't need to import that module just for this one shape. */
export interface PlanSuggestionForApply {
  entry: string | null;
  stopLoss: string | null;
  targets: { order: number; price: string }[];
}

type IdGenForTargets = () => string;

/**
 * §3 — "Recognition is advisory. The extension must never silently
 * overwrite the active draft." This function is the ONLY path that turns a
 * suggestion into draft state, and it only runs when the trader explicitly
 * clicks "Apply Suggestions" (panel.ts) — never automatically after
 * analysis completes. Only fields the suggestion actually has are applied;
 * a `null` field in the suggestion leaves whatever the trader already
 * typed untouched (§2: never fabricate a missing value by clearing a real
 * one). Targets are the one field applied as a full replacement rather
 * than a merge — deliberate, since a partial merge of "detected 2 targets"
 * into "trader already had 3 rows, one manually added" would produce a
 * confusing mixed result; a full target-list replacement is unambiguous,
 * and the trader can always undo it by re-typing (nothing here is
 * destructive at the SERVER level — this is still just a local draft).
 */
export function applyPlanSuggestion(
  draft: TradeDraftContext,
  suggestion: PlanSuggestionForApply,
  now: Now = Date.now,
  idGen: IdGenForTargets = () => crypto.randomUUID(),
): TradeDraftContext {
  let next = draft;
  if (suggestion.entry != null) next = setPlannedEntry(next, suggestion.entry, now);
  if (suggestion.stopLoss != null) next = setPlannedStopLoss(next, suggestion.stopLoss, now);
  if (suggestion.targets.length > 0) {
    const targets: PlannedTargetDraft[] = [...suggestion.targets]
      .sort((a, b) => a.order - b.order)
      .map((t, i) => ({ id: idGen(), label: `TP${i + 1}`, targetPrice: t.price }));
    next = { ...next, plannedTargets: targets, updatedAt: now() };
  }
  return next;
}

// --- Step 8 — screenshot (§18/§21) -----------------------------------------

/** Set once an upload confirms; also the ONLY way to clear it (Retake/Remove
 *  — see panel/screenshot.ts — set it back to `null` through this same
 *  function). */
export function setMediaAssetId(draft: TradeDraftContext, mediaAssetId: string | null, now: Now = Date.now): TradeDraftContext {
  return { ...draft, mediaAssetId, updatedAt: now() };
}

/**
 * Step 7, §20 (extended by Step 8) — after a successful save, clears
 * everything specific to the ONE trade idea that was just created (plan
 * prices, targets, confluence/execution selections, notes, and — Step 8 —
 * the uploaded screenshot's mediaAssetId) while PRESERVING strategy,
 * direction, session, and entry model.
 *
 * Deliberate choice, documented because the brief leaves it open ("inspect
 * the actual workflow and choose the safest UX"): a trader logging several
 * setups in a row from the same TradingView session is very likely still
 * trading the SAME strategy/session/entry-model context for the next one —
 * but the price levels, the specific confluences that lined up, and the
 * free-text notes describe THIS one setup and would be actively wrong if
 * silently carried into the next trade. Clearing the setup-specific half
 * and keeping the context half is the safer of the two failure directions:
 * accidentally re-submitting a stale price/confluence set is a real data
 * quality bug, while re-picking an already-correct strategy/session/entry
 * model is at most a minor inconvenience.
 */
export function resetAfterSave(draft: TradeDraftContext, now: Now = Date.now): TradeDraftContext {
  return {
    ...draft,
    selectedConfluenceIds: [],
    selectedExecutionIds: [],
    plannedEntry: "",
    plannedStopLoss: "",
    plannedTargets: [],
    marketContext: "",
    areasOfInterest: "",
    reasonForTrade: "",
    mediaAssetId: null,
    // Step 9, Part 8 — the just-saved idea is done; the NEXT idea should
    // re-lock onto whatever the chart shows THEN, not carry forward a
    // now-irrelevant origin/acknowledgment pair.
    originSymbol: null,
    acknowledgedSymbolMismatch: null,
    updatedAt: now(),
  };
}

// --- Step 9, Part 8 — symbol-change safety ---------------------------------

/** True once the draft has ANY real content worth protecting — mirrors
 *  exactly the fields `resetAfterSave` clears, plus the strategy-scoped
 *  ones `selectStrategy` clears, since a stray strategy pick alone (no
 *  plan yet) is still "a draft in progress" worth locking a symbol for. */
export function hasMaterialDraftContent(draft: TradeDraftContext): boolean {
  return (
    draft.strategyId != null ||
    draft.direction != null ||
    draft.selectedSession != null ||
    draft.selectedEntryModel != null ||
    draft.selectedConfluenceIds.length > 0 ||
    draft.selectedExecutionIds.length > 0 ||
    draft.plannedEntry.trim().length > 0 ||
    draft.plannedStopLoss.trim().length > 0 ||
    draft.plannedTargets.length > 0 ||
    draft.marketContext.trim().length > 0 ||
    draft.areasOfInterest.trim().length > 0 ||
    draft.reasonForTrade.trim().length > 0 ||
    draft.mediaAssetId != null
  );
}

/**
 * Called on every render with the chart's CURRENT display symbol. A no-op
 * (returns the SAME object, so callers can skip persisting) unless the
 * draft has real content AND no origin has been locked in yet — the exact
 * moment a fresh, empty side panel starts turning into an actual Trade
 * Idea. Once locked, this never changes it again on its own; only
 * `startNewIdeaForSymbol` (an explicit trader action) can reset it.
 */
export function ensureOriginSymbol(draft: TradeDraftContext, currentSymbol: string | null, now: Now = Date.now): TradeDraftContext {
  if (draft.originSymbol != null || currentSymbol == null || !hasMaterialDraftContent(draft)) return draft;
  return { ...draft, originSymbol: currentSymbol, updatedAt: now() };
}

/** "Keep {origin} Draft" — dismisses the warning for THIS specific
 *  mismatch without touching anything else; `originSymbol` (and therefore
 *  what actually gets submitted) is untouched. A further change to a
 *  DIFFERENT symbol re-triggers the warning, since it won't match. */
export function acknowledgeSymbolMismatch(draft: TradeDraftContext, currentSymbol: string | null, now: Now = Date.now): TradeDraftContext {
  return { ...draft, acknowledgedSymbolMismatch: currentSymbol, updatedAt: now() };
}

/** "Start New {current} Idea" — the old draft's setup-specific content
 *  (same fields `resetAfterSave` clears) is discarded and the origin
 *  re-locks onto the new symbol immediately, so this new idea is
 *  protected too — the trader doesn't have to type anything before the
 *  guard applies again. */
export function startNewIdeaForSymbol(draft: TradeDraftContext, currentSymbol: string | null, now: Now = Date.now): TradeDraftContext {
  return { ...resetAfterSave(draft, now), originSymbol: currentSymbol, updatedAt: now() };
}

export interface DraftValidation {
  /** UI-readiness hints for THIS flow, not a mirror of `tradeSchema`'s
   *  actual server-required fields (§21). Of these, only `directionRequired`
   *  corresponds to a real schema requirement — `direction` has no default
   *  in `tradeSchema` (src/lib/validation/trades.ts). `strategyId` and
   *  `selectedEntryModel` both default to falsy/null there, so
   *  `strategyRequired`/`entryModelRequired` are Step 6's own UX judgment
   *  ("this flow is about building strategy-aware context, so treat these
   *  as not-ready-yet"), not things the server would reject without. The
   *  server re-validates everything again at Step 7's submission time
   *  regardless (§21). */
  strategyRequired: boolean;
  directionRequired: boolean;
  /** Only true when the selected strategy actually defines entry models —
   *  never demanded of a strategy that has none (§9). */
  entryModelRequired: boolean;
  /** Ids of ELIGIBLE mandatory confluences not yet selected. A mandatory
   *  confluence that's ineligible for the current direction is never
   *  included — mirrors the server's own rule exactly (§22, Step 3's
   *  report: "direction-ineligible mandatory confluences are not
   *  considered missing" — see `domain/trades/confluence-score.ts`). Empty
   *  when direction hasn't been chosen yet, since nothing is eligible yet. */
  missingMandatoryConfluenceIds: string[];
  ready: boolean;
}

export function validateDraft(
  draft: TradeDraftContext,
  confluences: readonly StrategyConfluence[],
  entryModels: readonly string[] = [],
): DraftValidation {
  const strategyRequired = draft.strategyId == null;
  const directionRequired = draft.direction == null;
  const entryModelRequired = entryModels.length > 0 && draft.selectedEntryModel == null;

  const missingMandatoryConfluenceIds =
    draft.direction == null
      ? []
      : confluences
          .filter((c) => c.mandatory && isConfluenceEligible(c.directionApplicability, draft.direction))
          .filter((c) => !draft.selectedConfluenceIds.includes(c.id))
          .map((c) => c.id);

  return {
    strategyRequired,
    directionRequired,
    entryModelRequired,
    missingMandatoryConfluenceIds,
    ready: !strategyRequired && !directionRequired && !entryModelRequired && missingMandatoryConfluenceIds.length === 0,
  };
}
