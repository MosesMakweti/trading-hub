/**
 * Traditorium TradingView Extension — Step 8. Screenshot capture/upload
 * state machine (§18) — mirrors strategy-loader.ts's and
 * trade-submission.ts's shape (injected async functions, an `onChange`
 * callback, no chrome.* calls and no DOM access inside this file) so the
 * whole thing is unit-testable without a real capture API or network call.
 *
 * `idle → capturing → captured → uploading → uploaded`, with
 * `capture_error`/`upload_error` branches. `uploaded` is the ONLY state
 * that carries a `mediaAssetId` — never fabricated, never set optimistically
 * from a local capture alone (§18: "Do not treat a local screenshot as
 * successfully persisted until the API confirms it").
 *
 * The captured image itself (`dataUrl`) is held ONLY in this module's
 * closure — never persisted to `chrome.storage` (a PNG data URL can be
 * several hundred KB to a few MB; the draft's own storage area has no
 * business holding that). This means the local preview does not survive a
 * side-panel close before upload — documented in README.md as a known,
 * deliberate simplification, not a bug.
 *
 * RACE PROTECTION (§19/§26): a monotonically increasing `generation`
 * counter is bumped by every capture and by `remove()`. An in-flight
 * upload captures its own generation before awaiting; if a Retake or
 * Remove happens while that upload is still pending, the upload's eventual
 * result is silently discarded when it resolves — it can never overwrite a
 * NEWER capture's state (the exact class of bug strategy-loader.ts's own
 * generation check guards against in Step 6).
 */

export type ScreenshotState =
  | { status: "idle" }
  | { status: "capturing" }
  | { status: "captured"; dataUrl: string }
  | { status: "uploading"; dataUrl: string }
  | { status: "uploaded"; dataUrl: string; mediaAssetId: string }
  | { status: "capture_error"; message: string }
  | { status: "upload_error"; dataUrl: string; message: string };

export type CaptureFn = () => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
export type UploadFn = (dataUrl: string) => Promise<{ ok: true; mediaAssetId: string } | { ok: false; message: string }>;

export interface ScreenshotController {
  capture(): void;
  /** Same as `capture()` — a distinct name only for the UI's "Retake"
   *  button; the behavior (discard whatever's current, capture fresh) is
   *  identical either way. */
  retake(): void;
  upload(): void;
  /** Before upload: clears local state, no server call, no orphan (§19).
   *  After upload: clears the LOCAL reference only — the server-side
   *  MediaAsset is intentionally left in place (§20 — "do not invent a
   *  destructive media API in this step"). */
  remove(): void;
}

export function createScreenshotController(fns: { capture: CaptureFn; upload: UploadFn }, onChange: (state: ScreenshotState) => void): ScreenshotController {
  let state: ScreenshotState = { status: "idle" };
  let generation = 0;
  let captureInFlight = false;
  let uploadInFlight = false;

  function set(next: ScreenshotState) {
    state = next;
    onChange(next);
  }

  async function doCapture() {
    if (captureInFlight) return; // §19 — no duplicate concurrent capture
    captureInFlight = true;
    const myGeneration = ++generation; // supersedes any in-flight upload of the OLD image
    set({ status: "capturing" });

    const result = await fns.capture();
    captureInFlight = false;
    if (myGeneration !== generation) return; // superseded (e.g. Remove clicked meanwhile)

    set(result.ok ? { status: "captured", dataUrl: result.dataUrl } : { status: "capture_error", message: result.message });
  }

  async function doUpload() {
    if (uploadInFlight) return; // §26 — client-side in-flight protection: no duplicate concurrent upload
    if (state.status !== "captured" && state.status !== "upload_error") return; // nothing pending to upload
    const dataUrl = state.dataUrl;
    const myGeneration = generation; // NOT bumped — uploading doesn't start a new image generation
    uploadInFlight = true;
    set({ status: "uploading", dataUrl });

    const result = await fns.upload(dataUrl);
    uploadInFlight = false;
    if (myGeneration !== generation) return; // the image was retaken/removed while this upload was in flight — discard

    set(result.ok ? { status: "uploaded", dataUrl, mediaAssetId: result.mediaAssetId } : { status: "upload_error", dataUrl, message: result.message });
  }

  return {
    capture: () => void doCapture(),
    retake: () => void doCapture(),
    upload: () => void doUpload(),
    remove: () => {
      generation++; // supersedes any in-flight capture/upload
      set({ status: "idle" });
    },
  };
}
