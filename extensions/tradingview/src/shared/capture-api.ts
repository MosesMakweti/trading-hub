/**
 * Traditorium TradingView Extension — Step 8. The `CAPTURE_CHART` message's
 * response shape — shared so both `background/state.ts` (which produces it)
 * and `panel.ts` (which consumes it, wiring it into `panel/screenshot.ts`'s
 * controller) agree on the exact type without panel.ts importing anything
 * from `background/*` directly (the established panel/background boundary
 * — panel code only ever depends on `@shared/*` types).
 */
export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: "no_tab" | "capture_failed"; message: string };
