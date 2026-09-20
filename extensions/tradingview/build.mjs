// Traditorium TradingView Extension — Step 4 build script.
//
// Small and deliberate rather than pulling in a full extension-bundler
// framework: esbuild does the TS→JS bundling; this script's own job is
// templating manifest.json per target (§8 — "production builds must not
// accidentally point at localhost") and copying static assets. There is no
// third, silent default: --env is required, and an unrecognized value is a
// hard error, so a bare `node build.mjs` can never produce a build at all,
// let alone a wrong one.
import { build } from "esbuild";
import { mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");

const envArg = process.argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);

const TARGETS = {
  development: {
    apiBaseUrl: "http://localhost:3000",
    apiHostPermission: "http://localhost:3000/*",
    nameSuffix: " (Dev)",
  },
  production: {
    apiBaseUrl: "https://traditorium.com",
    apiHostPermission: "https://traditorium.com/*",
    nameSuffix: "",
  },
};

if (!envArg || !(envArg in TARGETS)) {
  console.error(`Usage: node build.mjs --env=development|production (got: ${envArg ?? "<none>"})`);
  process.exit(1);
}
const target = TARGETS[envArg];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(path.join(DIST, "panel"), { recursive: true });

// 1. Manifest — templated per target. Committed manifest.template.json has
//    NO working default for __API_HOST_PERMISSION__/__NAME_SUFFIX__, so a
//    stray `cp manifest.template.json dist/manifest.json` (skipping this
//    script) produces an obviously-broken manifest Chrome will refuse to
//    load, rather than a silently-wrong one.
const manifestSrc = readFileSync(path.join(ROOT, "manifest.template.json"), "utf8");
const manifest = manifestSrc
  .replaceAll("__API_HOST_PERMISSION__", target.apiHostPermission)
  .replaceAll("__NAME_SUFFIX__", target.nameSuffix);
writeFileSync(path.join(DIST, "manifest.json"), manifest);

// 2. Static assets.
cpSync(path.join(ROOT, "icons"), path.join(DIST, "icons"), { recursive: true });
copyFileSync(path.join(ROOT, "src/panel/panel.html"), path.join(DIST, "panel/panel.html"));
copyFileSync(path.join(ROOT, "src/panel/panel.css"), path.join(DIST, "panel/panel.css"));

// 3. JS bundles. API_BASE_URL is baked in here (esbuild `define`) — see
//    src/shared/config.ts's doc comment for why this is a build-time
//    constant, not a runtime-read secret.
const define = { __TRADITORIUM_API_BASE_URL__: JSON.stringify(target.apiBaseUrl) };
const common = { bundle: true, target: "chrome114", define, logLevel: "info" };

await Promise.all([
  // "type": "module" in manifest.background lets the service worker use
  // native ESM import/export.
  build({ ...common, format: "esm", entryPoints: [path.join(ROOT, "src/background/index.ts")], outfile: path.join(DIST, "background.js") }),
  // Content scripts are injected as classic scripts (no `"type": "module"`
  // declared on the manifest's content_scripts entry, deliberately, for
  // maximum Chromium-version compatibility) — bundle as an IIFE so no
  // top-level `export` syntax reaches the page.
  build({ ...common, format: "iife", entryPoints: [path.join(ROOT, "src/content/tradingview-detect.ts")], outfile: path.join(DIST, "content.js") }),
  // panel.html loads this via <script type="module">.
  build({ ...common, format: "esm", entryPoints: [path.join(ROOT, "src/panel/panel.ts")], outfile: path.join(DIST, "panel/panel.js") }),
]);

console.log(`\nBuilt ${envArg} extension → ${path.relative(process.cwd(), DIST)}`);
console.log(`  API base URL: ${target.apiBaseUrl}`);
