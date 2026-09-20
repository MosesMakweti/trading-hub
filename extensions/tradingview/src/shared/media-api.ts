/**
 * Traditorium TradingView Extension — Step 8. Hand-typed mirror of
 * `POST /api/v1/media`'s exact wire contract — verified against
 * `src/app/api/v1/media/route.ts` and `docs/extension-api.md`'s
 * "Screenshot handling" section. Same "no shared npm package, so no
 * automatic drift protection beyond a documented fixture" caveat as
 * @shared/strategy.ts and @shared/trade-api.ts.
 */

/** The exact 201 response shape. */
export interface UploadedMedia {
  id: string;
  url: string;
  mimeType: string;
  fileSize: number;
}

/**
 * One variant per distinct failure `POST /api/v1/media` can produce
 * (§25) — mirrors CreateTradeResult's shape in @shared/trade-api.ts for
 * consistency, even though this endpoint doesn't have a "replay"/conflict
 * case (it has no idempotency key — see README.md's "Idempotent upload
 * behavior" section for why client-side in-flight protection alone is
 * sufficient here).
 */
export type UploadMediaResult =
  | { ok: true; media: UploadedMedia }
  | { ok: false; kind: "unauthorized"; message: string }
  | { ok: false; kind: "unsupported_type"; message: string }
  | { ok: false; kind: "too_large"; message: string }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "network"; message: string }
  | { ok: false; kind: "server"; message: string };
