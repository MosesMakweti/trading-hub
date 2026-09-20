// Traditorium TradingView Extension — Step 10, §19. Deterministic
// production packaging: `npm run package` always builds a FRESH production
// bundle first (never packages whatever happens to already be in dist/,
// which could be stale or a development build), zips exactly that output,
// and inspects the result. Small and deliberate, like build.mjs: the
// system `zip` binary rather than a new npm dependency, since this is a
// one-shot developer/release command, not application code.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const RELEASES = path.join(ROOT, "releases");

const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const zipName = `traditorium-tradingview-${version}.zip`;
const zipPath = path.join(RELEASES, zipName);

// 1. Always a fresh production build — see build.mjs's own §12 validation
//    (no "localhost" host string may survive into these bytes).
console.log("Building production extension...");
execFileSync("node", [path.join(ROOT, "build.mjs"), "--env=production"], { stdio: "inherit" });

// 2. Zip exactly dist/'s contents (not the dist/ folder itself) — dist/ is
//    ALREADY the minimal runtime output (build.mjs copies only manifest.json,
//    icons/, panel.html, panel.css, and the 3 esbuild bundles); nothing
//    under src/, test/, node_modules/, or any dotfile is ever written there,
//    so there is no separate "runtime files only" filter to maintain here —
//    dist/'s own contents ARE that filter, by construction.
mkdirSync(RELEASES, { recursive: true });
rmSync(zipPath, { force: true });
if (!existsSync(path.join(DIST, "manifest.json"))) {
  console.error("✖ dist/manifest.json missing after build — refusing to package an empty/broken dist/.");
  process.exit(1);
}

console.log(`\nZipping dist/ → releases/${zipName}`);
execFileSync("zip", ["-r", "-X", zipPath, "."], { cwd: DIST, stdio: "inherit" });

// 3. Inspect the produced ZIP — §19/§20. Lists every entry and fails loudly
//    if anything outside the known runtime set snuck in (defense in depth;
//    step 2's reasoning already makes this structurally unlikely, but a
//    packaging bug should be caught here, not discovered after upload).
const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const allowedTopLevel = new Set(["manifest.json", "background.js", "content.js", "icons/", "panel/"]);
const forbiddenPatterns = [/(^|\/)\.env/i, /node_modules/i, /\.test\.[jt]s$/i, /\.map$/i, /(^|\/)\.git/i];

console.log(`\nContents (${listing.length} entries):`);
for (const entry of listing) console.log(`  ${entry}`);

const forbidden = listing.filter((entry) => forbiddenPatterns.some((p) => p.test(entry)));
const topLevel = new Set(listing.map((e) => e.split("/")[0] + (e.includes("/") ? "/" : "")));
const unexpectedTopLevel = [...topLevel].filter((t) => t && !allowedTopLevel.has(t) && t !== "");

if (forbidden.length > 0 || unexpectedTopLevel.length > 0) {
  console.error("\n✖ Package inspection failed:");
  if (forbidden.length > 0) console.error(`  Forbidden entries: ${forbidden.join(", ")}`);
  if (unexpectedTopLevel.length > 0) console.error(`  Unexpected top-level entries: ${unexpectedTopLevel.join(", ")}`);
  process.exit(1);
}

console.log(`\n✓ Package OK → ${path.relative(process.cwd(), zipPath)}`);
