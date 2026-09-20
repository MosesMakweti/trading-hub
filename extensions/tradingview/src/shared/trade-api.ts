/**
 * Traditorium TradingView Extension — Step 7. Hand-typed mirrors of
 * `POST /api/v1/trades`'s exact wire contract (§1) — verified against
 * `src/lib/validation/api-trades.ts::apiCreateTradeSchema` (which itself
 * reuses `tradeSchema`/`confirmPlanSchema` VERBATIM — see that file's own
 * doc comment) and `src/server/services/api-trade-dto.ts::toApiTradeDTO`
 * for the response. No `any`/`unknown` (§20) — same "no shared npm package,
 * so no automatic drift protection beyond a documented fixture" caveat as
 * @shared/strategy.ts.
 *
 * ONLY the fields this extension actually sends/reads are typed here — a
 * few `tradeSchema` fields with no Step 7 UI (psychology, allocations, prop
 * firm executions, setup types, pre-trade mood) are simply omitted from
 * `CreateTradeRequest["trade"]`; the server fills its own defaults for
 * anything omitted (every one of those fields has a Zod `.default(...)` —
 * verified by reading tradeSchema directly, not assumed).
 */
import type { TradeDirection } from "./strategy";

export interface CreateTradePlannedTarget {
  targetOrder: number;
  label: string;
  targetPrice: number;
}

export interface CreateTradeRequest {
  /** Always sent explicitly — see @shared/date-key.ts's doc comment on why
   *  the server's own "omit it" default is wrong for a browser-side caller. */
  dateKey: string;
  trade: {
    assetSymbol: string;
    executionMinutes: number;
    direction: TradeDirection;
    higherTimeframeBias: "BULLISH" | "BEARISH";
    biasConfidencePercent: number;
    strategyId?: string;
    selectedSession?: string;
    selectedEntryModel?: string;
    selectedConfluences?: string[];
    selectedExecution?: string[];
  };
  /** Required by THIS extension's own flow (Step 7 always builds a full
   *  plan) even though `confirmPlanSchema`/`apiCreateTradeSchema.plan`
   *  itself is optional server-side — see trade-payload.ts's doc comment. */
  plan: {
    /** The chart's detected timeframe — this is the ONLY place it goes.
     *  `tradeSchema` (the trade itself) has NO timeframe field at all; the
     *  `Trade.timeframe` DB column (prisma/schema.prisma, ~line 619) is
     *  written exclusively by `trade-plan.service.ts::savePlan` from
     *  `confirmPlanSchema.timeframe` — confirmed by reading both files
     *  directly, not assumed from the Step 7 brief's mockup. */
    timeframe?: string | null;
    entry: number;
    stopLoss: number;
    targets: CreateTradePlannedTarget[];
  };
  notes?: {
    marketContext?: string;
    areasOfInterest?: string;
    reasonForTrade?: string;
  };
  /** Step 8, §21 — a TOP-LEVEL field on `apiCreateTradeSchema` (NOT nested
   *  under `trade`, despite living conceptually "with" the trade) — a real,
   *  already-uploaded `MediaAsset.id` this user owns. Resolved server-side
   *  via `attachPlanScreenshot` (trade-plan.service.ts, unmodified) — see
   *  docs/extension-api.md's "Screenshot handling" section. */
  mediaAssetId?: string;
}

export interface ApiTradePlannedTarget {
  targetOrder: number;
  label: string;
  targetPrice: number;
  rMultiple: number | null;
  plannedClosePercent: number | null;
}

/** Mirrors `toApiTradeDTO` exactly (server/services/api-trade-dto.ts) —
 *  the ONLY fields the extension is ever allowed to render as "what was
 *  actually saved" (§18: "use the actual returned trade data... do not
 *  fabricate persisted values from the draft"). */
export interface ApiTradeDTO {
  id: string;
  tradeNumber: number;
  dateKey: string;
  assetSymbol: string;
  direction: TradeDirection;
  timeframe: string | null;
  selectedSession: string | null;
  strategyId: string | null;
  strategyName: string | null;
  selectedEntryModel: string | null;
  selectedConfluences: string[];
  selectedExecution: string[];
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTargets: ApiTradePlannedTarget[];
  expectedRR: number | null;
  setupScore: number | null;
  setupRating: string | null;
  setupValid: boolean | null;
  confluencePercent: number | null;
  executionPercent: number | null;
  hasPlanScreenshot: boolean;
  createdAt: string;
}

export interface CreateTradeValidationIssue {
  path: string;
  message: string;
}

/**
 * §21 — one variant per distinct failure the route can produce, so the UI
 * can react correctly to each (401 -> disconnect, 409 -> don't rotate the
 * idempotency key, 422 -> show field errors, network/500 -> preserve the
 * draft and the key for a safe retry). A 200 "replay" response (the
 * idempotency key already produced a trade) is folded into the SAME success
 * variant as a fresh 201 — functionally, the trade already exists either
 * way; `replayed` just says which happened.
 */
export type CreateTradeResult =
  | { ok: true; trade: ApiTradeDTO; warnings: string[]; replayed: boolean }
  | { ok: false; kind: "unauthorized"; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "validation"; message: string; issues: CreateTradeValidationIssue[] }
  | { ok: false; kind: "network"; message: string }
  | { ok: false; kind: "server"; message: string };
