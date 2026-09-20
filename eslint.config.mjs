import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Traditorium TradingView Extension (Step 4) — an isolated package with
    // its own lint/typecheck (extensions/tradingview/package.json); not the
    // web app's code, must not be linted against the web app's rules/globals.
    "extensions/**",
  ]),
]);

export default eslintConfig;
