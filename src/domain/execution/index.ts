/**
 * Quantity-ledger execution engine (Phase 1) — pure domain, no persistence.
 * See docs/EXECUTION_ENGINE.md.
 *
 *   Risk % determines the budget.
 *   Initial stop + instrument economics determine executable quantity.
 *   Quantity + actual price movement determine PnL.
 *   Realized PnL / frozen intended risk determines realized R.
 */
export * from "./precision";
export * from "./instrument-spec";
export * from "./value-per-unit";
export * from "./sizing";
export * from "./partial-close";
export * from "./fill-reducer";
