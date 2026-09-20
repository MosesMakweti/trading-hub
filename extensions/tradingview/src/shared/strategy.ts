/**
 * Traditorium TradingView Extension — Step 6. Typed representations of the
 * EXISTING `GET /api/v1/strategies` / `GET /api/v1/strategies/:id` response
 * shapes (docs/extension-api.md, backed by
 * `server/services/strategies.service.ts::listStrategies`/`getStrategyReference`
 * — the same function the web app's own Add Trade form already calls). This
 * module defines no new fields and no scoring logic — it's purely a typed
 * mirror of the documented wire contract, so the extension never has to use
 * `unknown`/`any` for a strategy response.
 *
 * IMPORTANT — id vs. name (§1/§10, documented precisely because it's easy to
 * get wrong): `getStrategyReference` gives CONFLUENCES and EXECUTION
 * CONFIRMATIONS real, stable `id`s (they're `ChecklistItem` rows), but gives
 * SESSIONS and ENTRY MODELS only a `name` — no id at all. This isn't an
 * oversight to work around; it exactly matches Traditorium's own canonical
 * `tradeSchema` (src/lib/validation/trades.ts), which stores
 * `selectedSession`/`selectedEntryModel` as plain strings matched BY NAME
 * against the strategy (see `trades.service.ts::buildTradeSnapshots`), while
 * `selectedConfluences`/`selectedExecution` are also stored as NAME arrays,
 * even though real confluence/execution ids exist server-side (scoring
 * matches by name too — see `domain/trades/strategy-adherence.ts::ratio`).
 * The extension's own draft (`@shared/draft.ts`) keeps confluence/execution
 * SELECTIONS by id internally (real ids exist, and ids are safer identity
 * for UI state than a possibly-renamed name), but session/entry-model
 * selections are plain name strings, because there is no id to hold. A
 * future Step 7 that submits `POST /api/v1/trades` will need to resolve the
 * confluence/execution ids back to names against this same StrategyReference
 * before sending — not by inventing a new id-carrying wire format.
 *
 * Contract-drift protection (§20): there is no shared npm package or
 * generated types between the Next.js app and this extension package (by
 * design — see README.md's "Why this lives outside src/"). If the server's
 * `getStrategyReference`/`listStrategies` response shape ever changes, this
 * file will NOT be updated automatically — the only current safeguard is the
 * fixture in `strategy.contract.test.ts`, whose JSON literally matches
 * docs/extension-api.md's documented example response. If a future backend
 * change updates that doc's example without a human also updating this file,
 * this file will silently drift. A more robust guard (e.g. Zod-parsing a
 * real response in a live integration test, or publishing generated types
 * from the Next.js app) is future work, out of scope for Step 6 — see
 * README.md's "Strategy contract drift" section.
 */

export type StrategyStatus = "DRAFT" | "TESTING" | "LIVE" | "ARCHIVED";

export type TagColor = "GRAY" | "BLUE" | "GREEN" | "AMBER" | "RED" | "PURPLE" | "YELLOW" | "TEAL";

/** Matches Prisma's `ConfluenceDirection` enum exactly (prisma/schema.prisma). */
export type ConfluenceDirection = "BULLISH" | "BEARISH" | "BOTH";

/** Matches Prisma's `Direction` enum and `lib/validation/trades.ts`'s
 *  `directionSchema` exactly — this IS the canonical value the eventual
 *  Step 7 `POST /api/v1/trades` body's `trade.direction` field requires. */
export type TradeDirection = "LONG" | "SHORT";

/** `GET /api/v1/strategies` list entry. */
export interface StrategySummary {
  id: string;
  name: string;
  version: number;
  status: StrategyStatus;
}

export interface StrategiesResponse {
  strategies: StrategySummary[];
}

/** No id — see this module's doc comment. */
export interface StrategySessionRef {
  name: string;
  color: TagColor;
}

export interface StrategyConfluence {
  id: string;
  name: string;
  color: TagColor;
  category: string | null;
  weight: number | null;
  mandatory: boolean;
  directionApplicability: ConfluenceDirection;
  pairId: string | null;
}

/** Same underlying `ChecklistItem` shape as `StrategyConfluence` (the server
 *  selects the same fields for both kinds) — kept as a distinct exported
 *  type anyway because the two are semantically different lists and Step 6
 *  never direction-filters this one (§6: only confluences are direction-
 *  filtered; execution confirmations are not, matching
 *  `domain/trades/strategy-adherence.ts::scoreStrategyAdherence`, which
 *  never filters `execution` by direction). */
export type StrategyExecutionConfirmation = StrategyConfluence;

export interface StrategyPartialTakeProfit {
  trigger: string;
  percentToClose: number | null;
}

export interface StrategyTradeManagement {
  maxRiskPercent: number | null;
  maxHoldingTime: string | null;
  customRules: string[];
  partialTakeProfits: StrategyPartialTakeProfit[];
}

export interface StrategySetupTypeRef {
  id: string;
  name: string;
}

/** `GET /api/v1/strategies/:id` — the exact `{ strategy: ... }` payload. */
export interface StrategyReference {
  id: string;
  name: string;
  version: number;
  applicableAssets: string[];
  /** Names only — see this module's doc comment. */
  entryModels: string[];
  frameworkSteps: string[];
  sessions: StrategySessionRef[];
  confluences: StrategyConfluence[];
  execution: StrategyExecutionConfirmation[];
  tradeManagement: StrategyTradeManagement | null;
  setupTypes: StrategySetupTypeRef[];
}

export interface StrategyReferenceResponse {
  strategy: StrategyReference;
}

/** The GET_STRATEGY_REFERENCE message's response shape — mirrors
 *  api-client.ts's ApiResult<T>, plus a "disconnected" reason for when
 *  there's no stored token to even attempt the call with (a state
 *  api-client.ts itself never needs to represent, since it always requires
 *  a token argument). Defined here, not imported from the background's
 *  api-client.ts, so @shared/messages.ts (used by the content script and
 *  panel too) never has a build-time path to background-only code. */
export type StrategyReferenceFailureReason = "unauthorized" | "network" | "server" | "malformed" | "disconnected";

export type StrategyReferenceResult =
  | { ok: true; strategy: StrategyReference }
  | { ok: false; reason: StrategyReferenceFailureReason; message: string };
