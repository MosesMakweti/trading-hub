/**
 * Traditorium TradingView Extension — Step 7, §16/§17. Submission-state
 * machine + idempotency-key lifecycle for one "Save Trade Idea" click.
 * Mirrors strategy-loader.ts's shape on purpose (pure orchestration, an
 * injected async function, an onChange callback) — the same pattern that
 * already made race protection trivially unit-testable in Step 6 works
 * just as well here for the idempotency lifecycle.
 *
 * IDEMPOTENCY-KEY LIFECYCLE (§17), the exact rule implemented below:
 *   - The first `submit()` call generates ONE key and keeps using it.
 *   - A repeat `submit()` call while a submission is already in flight is
 *     IGNORED outright (§16: "disable duplicate submission... do not let
 *     repeated clicks generate new idempotency keys") — not just debounced,
 *     structurally impossible to double-fire.
 *   - A NETWORK or SERVER (500) failure keeps the SAME key — the trader can
 *     retry and it's treated as the same logical attempt (§21: "network
 *     failure -> preserve the idempotency key... allow safe retry").
 *   - A DEFINITIVE failure (401/409/422) also keeps the key by itself —
 *     retrying immediately with the same, already-rejected payload would
 *     just fail the same way again. The key only rotates once
 *     `notifyDraftEdited()` is called AFTER a definitive failure (§17:
 *     "the trader materially edits the draft after a definitive failure" —
 *     panel.ts calls this from every draft-mutating action).
 *   - A SUCCESS clears the key entirely — a future save (e.g. "Add
 *     Another") is a new logical submission and must get its own key.
 *
 * This module holds ONLY that lifecycle — it has no knowledge of chrome.*,
 * the token, or HTTP; `createTrade` is injected exactly the way
 * strategy-loader.ts injects its fetcher.
 */
import type { CreateTradeRequest, CreateTradeResult } from "@shared/trade-api";

export type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; result: Extract<CreateTradeResult, { ok: true }> }
  | { status: "error"; result: Extract<CreateTradeResult, { ok: false }> };

export type CreateTradeFn = (payload: CreateTradeRequest, idempotencyKey: string) => Promise<CreateTradeResult>;

export interface TradeSubmitter {
  submit(payload: CreateTradeRequest): Promise<void>;
  /** Call after ANY draft-mutating action. A no-op unless the last outcome
   *  was a definitive failure — see this module's doc comment. */
  notifyDraftEdited(): void;
  /** Returns to idle and forgets any pending key — used for "Add Another"
   *  after a success, or if the trader backs out of a failed attempt. */
  reset(): void;
}

export function createTradeSubmitter(createTrade: CreateTradeFn, onChange: (state: SubmissionState) => void): TradeSubmitter {
  let pendingKey: string | null = null;
  let inFlight = false;
  let awaitingEditToRotateKey = false;

  return {
    async submit(payload: CreateTradeRequest) {
      if (inFlight) return; // §16 — a duplicate click while submitting is ignored, not queued

      if (pendingKey == null) pendingKey = crypto.randomUUID();
      const key = pendingKey;

      inFlight = true;
      onChange({ status: "submitting" });

      const result = await createTrade(payload, key);

      inFlight = false;
      if (result.ok) {
        pendingKey = null;
        awaitingEditToRotateKey = false;
        onChange({ status: "success", result });
        return;
      }

      // Only a definitive failure becomes eligible for key rotation, and
      // only once the draft is actually edited afterward — a network/500
      // failure's key is never rotated by an edit (§17 lists success or
      // edit-after-DEFINITIVE-failure as the only two ways a new key is
      // used; retrying a transient failure must stay the same attempt).
      awaitingEditToRotateKey = result.kind === "unauthorized" || result.kind === "conflict" || result.kind === "validation";
      onChange({ status: "error", result });
    },

    notifyDraftEdited() {
      if (awaitingEditToRotateKey) {
        pendingKey = null;
        awaitingEditToRotateKey = false;
      }
    },

    reset() {
      pendingKey = null;
      awaitingEditToRotateKey = false;
      inFlight = false;
      onChange({ status: "idle" });
    },
  };
}
