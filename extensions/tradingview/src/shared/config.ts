/**
 * Traditorium TradingView Extension — Step 4. The ONE place the API base
 * URL is decided. `__TRADITORIUM_API_BASE_URL__` is a compile-time constant
 * injected by build.mjs via esbuild's `define` (see that file) — it does
 * NOT read `process.env` at runtime (a packed extension has no Node
 * process/env to read; and per the Step 4 brief, the base URL is a build
 * target choice, not a secret, so baking it in at build time — the same way
 * `next.config.ts`-free static values ship — is correct and simpler than a
 * runtime settings surface Step 4 explicitly doesn't ask for).
 *
 * `npm run build` (production) sets this to https://traditorium.com.
 * `npm run build:dev` sets this to http://localhost:3000.
 * There is no third, silent default inside this file — an unset define is a
 * build-time error (see build.mjs), so a production build can never
 * *accidentally* end up pointing at localhost by simply forgetting a flag.
 */
declare const __TRADITORIUM_API_BASE_URL__: string;

export const API_BASE_URL = __TRADITORIUM_API_BASE_URL__;
