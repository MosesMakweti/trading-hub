/**
 * Deploy-time feature flags (env, read at call time so a flip takes effect
 * without a rebuild and tests can toggle them).
 *
 * QUANTITY_LEDGER — Phase 2 quantity ledger. Default OFF. Controls ONLY which
 * execution model Today V3 selects at a trade's FIRST actual entry; a trade
 * that already has executionModel = QUANTITY_LEDGER keeps settling through the
 * ledger whatever this flag says later. Never enable in production until the
 * quantity-execution UI exists.
 */
export function isQuantityLedgerEnabled(): boolean {
  return process.env.QUANTITY_LEDGER === "on";
}
