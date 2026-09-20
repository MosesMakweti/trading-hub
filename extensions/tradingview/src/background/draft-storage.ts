/**
 * Traditorium TradingView Extension — Step 6. The ONLY module that touches
 * `chrome.storage.session` for the trade draft (§4/§18).
 *
 * Deliberately `chrome.storage.session`, not `chrome.storage.local`: it's
 * in-memory, extension-owned, and — the property that actually matters here
 * — automatically cleared when the browser itself closes, never written to
 * disk. §4 asks for a DELIBERATE decision on how long the draft survives;
 * this one was chosen because it satisfies the stated minimum (surviving a
 * side-panel close/reopen, and a service-worker restart, both of which a
 * plain in-memory variable in panel.ts or background/index.ts could NOT do
 * — a side panel's page is torn down when closed, and a service worker's
 * module-level state is wiped on its own idle restart) while deliberately
 * NOT surviving a full browser restart. A strategy-in-progress draft from a
 * previous session persisting silently into a new browsing session, day, or
 * even a different chart entirely, felt like the wrong default for
 * something this ephemeral — better to start clean. `chrome.storage.local`
 * (survives a browser restart too) remains available if that decision is
 * ever revisited; this module is the one place that choice would change.
 *
 * The draft carries no token and no secret (see @shared/draft.ts) — this
 * module exists to keep ONE consistent "background owns all chrome.storage
 * access" boundary (matching storage.ts's token pattern), not because the
 * draft itself needs the same isolation guarantees the token does.
 *
 * Every business rule (what changes on a direction/strategy change, what's
 * "ready") lives in @shared/draft.ts's pure functions — this module only
 * persists whatever object it's given.
 */
import { EMPTY_DRAFT, type TradeDraftContext } from "@shared/draft";

const STORAGE_KEY = "traditorium_draft";

export async function getDraft(): Promise<TradeDraftContext> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as TradeDraftContext | undefined) ?? EMPTY_DRAFT;
}

export async function setDraft(draft: TradeDraftContext): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: draft });
}

export async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEY);
}
