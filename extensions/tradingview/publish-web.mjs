// Private-beta distribution: copies the freshly packaged release ZIP into
// the web app's deliberate download location, `public/downloads/`, where
// Next.js/Vercel serves it as a versioned static file
// (https://traditorium.com/downloads/traditorium-tradingview-<version>.zip).
// Settings → Integrations links to it via src/lib/extension-distribution.ts.
//
// `npm run release:web` = `npm run package` (fresh production build + zip +
// entry inspection) followed by this script. Older traditorium-tradingview-*
// ZIPs in public/downloads/ are removed so only the current version ships.
// After bumping the version, update EXTENSION_VERSION in
// src/lib/extension-distribution.ts — its test fails until the two agree.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = path.resolve(ROOT, "../../public/downloads");

const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const zipName = `traditorium-tradingview-${version}.zip`;
const source = path.join(ROOT, "releases", zipName);

if (!existsSync(source)) {
  console.error(`✖ releases/${zipName} not found — run \`npm run package\` first.`);
  process.exit(1);
}

mkdirSync(DOWNLOADS, { recursive: true });
for (const file of readdirSync(DOWNLOADS)) {
  if (/^traditorium-tradingview-.*\.zip$/.test(file) && file !== zipName) {
    rmSync(path.join(DOWNLOADS, file));
    console.log(`  removed old public/downloads/${file}`);
  }
}
copyFileSync(source, path.join(DOWNLOADS, zipName));
console.log(`✓ Published → public/downloads/${zipName}`);
