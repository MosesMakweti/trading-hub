import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
  // Mirrors build.mjs's esbuild `define` — Vite (which vitest runs on)
  // supports the same mechanism, so src/shared/config.ts resolves under
  // test exactly the way it does in a real build, just pinned to a fixed
  // test value instead of a build target.
  define: {
    __TRADITORIUM_API_BASE_URL__: JSON.stringify("http://localhost:3000"),
  },
  test: {
    environment: "node",
    // Step 5 — content scripts run in a real page (window/document/history)
    // and are tested against jsdom fixtures rather than live TradingView;
    // everything else (background/panel/shared) stays "node" — no DOM.
    environmentMatchGlobs: [["src/content/**", "jsdom"]],
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
