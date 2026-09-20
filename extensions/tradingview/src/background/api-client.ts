/**
 * Traditorium TradingView Extension — Step 4. The ONE place that calls the
 * Traditorium API (docs/extension-api.md). Centralizes base URL, the
 * `Authorization: Bearer` header, JSON parsing, and error classification —
 * §7: "do not scatter fetch() calls throughout UI components." Only
 * GET /api/v1/me and GET /api/v1/strategies(/:id) exist here; POST
 * /api/v1/trades is deliberately absent (§7/§21 — that's a later step).
 *
 * Runs ONLY in the background service worker. This is what makes the CORS
 * finding in README.md true: an MV3 background fetch to an origin listed
 * in the manifest's `host_permissions` is exempt from CORS enforcement
 * entirely — the browser trusts the extension's declared permission rather
 * than requiring the server to answer with Access-Control-Allow-Origin.
 * Traditorium's `EXTENSION_ALLOWED_ORIGINS` (docs/extension-api.md) matters
 * only for a fetch made from a `chrome-extension://` PAGE context (e.g. a
 * side panel calling fetch directly); since the side panel here never does
 * that — it only ever messages the background — that CORS allowlist does
 * not need an entry for this extension at all. See README.md.
 */
import { API_BASE_URL } from "@shared/config";
import type { StrategiesResponse, StrategyReferenceResponse } from "@shared/strategy";
import type { ApiTradeDTO, CreateTradeRequest, CreateTradeResult, CreateTradeValidationIssue } from "@shared/trade-api";
import type { DeleteMediaResult, UploadedMedia, UploadMediaResult } from "@shared/media-api";
import type { AnalyzeScreenshotResult, ScreenshotRecognitionOutcome } from "@shared/recognition-api";

export interface ApiUser {
  id: string;
  name: string | null;
}

export interface MeResponse {
  user: ApiUser;
}

// Step 6 — StrategySummary/StrategiesResponse now live in @shared/strategy
// (re-exported here for callers that only imported this module before).
export type { StrategySummary, StrategiesResponse } from "@shared/strategy";

export type ApiFailureReason = "unauthorized" | "network" | "server" | "malformed";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: ApiFailureReason; message: string };

async function request<T>(path: string, token: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Traditorium offline, localhost unavailable, no network, etc. — never
    // surface the raw fetch error (could contain the URL/token in some
    // environments' error strings); always this one generic message.
    return { ok: false, reason: "network", message: "Could not reach Traditorium." };
  }

  if (res.status === 401) {
    return { ok: false, reason: "unauthorized", message: "The Traditorium token is invalid or has been revoked." };
  }
  if (!res.ok) {
    return { ok: false, reason: "server", message: `Traditorium returned an unexpected error (${res.status}).` };
  }

  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "malformed", message: "Traditorium sent an unexpected response." };
  }
}

export function getMe(token: string): Promise<ApiResult<MeResponse>> {
  return request<MeResponse>("/api/v1/me", token);
}

export function getStrategies(token: string): Promise<ApiResult<StrategiesResponse>> {
  return request<StrategiesResponse>("/api/v1/strategies", token);
}

export function getStrategy(token: string, id: string): Promise<ApiResult<StrategyReferenceResponse>> {
  return request<StrategyReferenceResponse>(`/api/v1/strategies/${encodeURIComponent(id)}`, token);
}

/**
 * Step 7, §2. `POST /api/v1/trades` — a dedicated function rather than a
 * `request<T>()` call, since this endpoint's failure modes are richer than
 * a plain GET's (409 conflict, 422 with structured field issues) and a 200
 * "replay" response is a SUCCESS, not merely "not an error" (§17 — the
 * idempotency-key replay path). Still the ONE place that builds this
 * request: same base URL, same Authorization header pattern as `request<T>`
 * above, plus the `Idempotency-Key` header (§17) and a JSON body.
 */
export async function createTrade(
  token: string,
  payload: CreateTradeRequest,
  idempotencyKey: string,
): Promise<CreateTradeResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/trades`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never surface the raw fetch error — see `request<T>`'s doc comment
    // for why (could contain the URL/token in some environments' text).
    return { ok: false, kind: "network", message: "Could not reach Traditorium." };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "server", message: "Traditorium sent an unexpected response." };
  }

  if (res.status === 200 || res.status === 201) {
    const parsed = body as { trade: ApiTradeDTO; warnings?: string[]; replayed?: boolean };
    return { ok: true, trade: parsed.trade, warnings: parsed.warnings ?? [], replayed: parsed.replayed ?? false };
  }
  if (res.status === 401) {
    return { ok: false, kind: "unauthorized", message: errorMessageOf(body, "The Traditorium token is invalid or has been revoked.") };
  }
  if (res.status === 409) {
    return { ok: false, kind: "conflict", message: errorMessageOf(body, "This request conflicts with a previous submission.") };
  }
  if (res.status === 422) {
    const parsed = body as { error?: string; issues?: CreateTradeValidationIssue[] };
    return { ok: false, kind: "validation", message: parsed.error ?? "Validation failed.", issues: parsed.issues ?? [] };
  }
  return { ok: false, kind: "server", message: `Traditorium returned an unexpected error (${res.status}).` };
}

/**
 * Step 8, §17/§27. `POST /api/v1/media` — multipart, not JSON, and no
 * Idempotency-Key header at all (there is no server-side upload
 * idempotency for this endpoint; see README.md's "Idempotent upload
 * behavior" section for why client-side in-flight protection, owned by
 * @shared's screenshot state machine, was judged sufficient for Step 8
 * rather than adding another database model).
 */
export async function uploadMedia(token: string, bytes: Uint8Array, mimeType: string, fileName: string): Promise<UploadMediaResult> {
  const form = new FormData();
  form.set("file", new Blob([bytes as BlobPart], { type: mimeType }), fileName);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }, // no Content-Type — fetch sets the multipart boundary itself
      body: form,
    });
  } catch {
    return { ok: false, kind: "network", message: "Could not reach Traditorium." };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "server", message: "Traditorium sent an unexpected response." };
  }

  if (res.status === 201) return { ok: true, media: body as UploadedMedia };
  if (res.status === 401) {
    return { ok: false, kind: "unauthorized", message: errorMessageOf(body, "The Traditorium token is invalid or has been revoked.") };
  }
  if (res.status === 415) return { ok: false, kind: "unsupported_type", message: errorMessageOf(body, "Unsupported image format.") };
  if (res.status === 413) return { ok: false, kind: "too_large", message: errorMessageOf(body, "Image is too large.") };
  if (res.status === 400 || res.status === 422) {
    return { ok: false, kind: "validation", message: errorMessageOf(body, "Could not upload the image.") };
  }
  return { ok: false, kind: "server", message: `Traditorium returned an unexpected error (${res.status}).` };
}

/**
 * Step 9, Part 1. `POST /api/v1/media/:mediaAssetId/recognize-trade-plan`.
 * A 200 always wraps a well-formed `ScreenshotRecognitionOutcome` (success
 * OR the recognition system's own "failed" body — both are `ok: true`
 * here, see @shared/recognition-api.ts's doc comment). Only a genuine
 * request-level problem — 401, 404, network, 500 — is `ok: false`.
 */
export async function analyzeScreenshot(token: string, mediaAssetId: string): Promise<AnalyzeScreenshotResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/media/${encodeURIComponent(mediaAssetId)}/recognize-trade-plan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, kind: "network", message: "Could not reach Traditorium." };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "server", message: "Traditorium sent an unexpected response." };
  }

  if (res.status === 200) return { ok: true, outcome: body as ScreenshotRecognitionOutcome };
  if (res.status === 401) {
    return { ok: false, kind: "unauthorized", message: errorMessageOf(body, "The Traditorium token is invalid or has been revoked.") };
  }
  if (res.status === 404) return { ok: false, kind: "not_found", message: errorMessageOf(body, "Image not found or access denied.") };
  return { ok: false, kind: "server", message: `Traditorium returned an unexpected error (${res.status}).` };
}

/**
 * Step 10. `DELETE /api/v1/media/:mediaAssetId` — completes the screenshot
 * lifecycle Step 9 left half-built (the endpoint existed; nothing called
 * it). A 204 has no body, so it's the one response here that never touches
 * `res.json()`. 409 ("already attached/in use") is a normal, expected
 * outcome for a caller that races an in-flight save against a cleanup —
 * classified distinctly (`kind: "protected"`) rather than folded into
 * `"server"`, so callers can treat it as "nothing to do" rather than a
 * failure worth surfacing.
 */
export async function deleteMedia(token: string, mediaAssetId: string): Promise<DeleteMediaResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/media/${encodeURIComponent(mediaAssetId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, kind: "network", message: "Could not reach Traditorium." };
  }

  if (res.status === 204) return { ok: true };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: "server", message: "Traditorium sent an unexpected response." };
  }

  if (res.status === 401) {
    return { ok: false, kind: "unauthorized", message: errorMessageOf(body, "The Traditorium token is invalid or has been revoked.") };
  }
  if (res.status === 404) return { ok: false, kind: "not_found", message: errorMessageOf(body, "Image not found or already deleted.") };
  if (res.status === 409) {
    return {
      ok: false,
      kind: "protected",
      message: errorMessageOf(body, "This image is already attached to a trade and can't be deleted here."),
    };
  }
  return { ok: false, kind: "server", message: `Traditorium returned an unexpected error (${res.status}).` };
}

function errorMessageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}
