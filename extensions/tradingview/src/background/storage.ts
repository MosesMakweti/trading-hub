/**
 * Traditorium TradingView Extension — Step 4. The ONLY module that touches
 * `chrome.storage.local`, and the ONLY place the raw API token is ever
 * written to disk. Deliberately NOT localStorage (§6): localStorage is
 * page-scoped, readable by anything running in that page's JS context, and
 * for a content-script-adjacent extension that's a real risk surface;
 * `chrome.storage.local` is extension-owned, isolated from every web page
 * (including TradingView itself) and from every other extension, and is
 * the storage area Chrome documents for exactly this use case. It is NOT
 * OS-keychain-encrypted, so this is "as safe as the browser's own
 * extension sandboxing," not "cryptographically sealed" — documented
 * precisely rather than overclaimed (see README.md's security section).
 *
 * This module never runs in the content-script or page context — only the
 * background service worker (and, transitively, nothing else) ever calls
 * it, which is what keeps the raw token out of TradingView's page context
 * entirely (§6's core requirement).
 */
import type { ConnectionState } from "@shared/messages";
import type { StrategySummary } from "@shared/strategy";

export interface StoredData {
  apiToken: string | null;
  cachedUser: Extract<ConnectionState, { status: "connected" }>["user"] | null;
  /** Step 6 — the full list, not just a count: the strategy picker needs
   *  real id/name/status to populate itself, not a number. */
  cachedStrategies: StrategySummary[] | null;
}

const STORAGE_KEY = "traditorium";

const EMPTY: StoredData = { apiToken: null, cachedUser: null, cachedStrategies: null };

export async function getStored(): Promise<StoredData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as StoredData | undefined) ?? EMPTY;
}

export async function setStored(patch: Partial<StoredData>): Promise<void> {
  const current = await getStored();
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...patch } });
}

/** Disconnect (§16): removes the token AND every cached derived value —
 *  never leaves a stale user/strategy count behind for a disconnected panel
 *  to accidentally render. */
export async function clearStored(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
