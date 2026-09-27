import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { ExtensionInstallCard } from "@/components/settings/extension-install-card";
import {
  CONNECT_STEPS,
  DIRECT_INSTALL_STEPS,
  EXTENSION_DISTRIBUTION,
  EXTENSION_FILENAME,
  EXTENSION_VERSION,
  extensionCta,
} from "./extension-distribution";

const ROOT = path.resolve(__dirname, "../..");
const EXT = path.join(ROOT, "extensions/tradingview");
const DOWNLOADS = path.join(ROOT, "public/downloads");
const ZIP = path.join(DOWNLOADS, EXTENSION_FILENAME);

/** Minimal ZIP reader (stored + deflate entries via the central directory) —
 *  enough to inspect the shipped artifact without a zip dependency. */
function readZip(file: string): Map<string, Buffer> {
  const buf = readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe("extension distribution metadata", () => {
  it("version agrees with the extension's package.json and manifest template", () => {
    const pkg = JSON.parse(readFileSync(path.join(EXT, "package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.template.json"), "utf8"));
    expect(pkg.version).toBe(EXTENSION_VERSION);
    expect(manifest.version).toBe(EXTENSION_VERSION);
    expect(EXTENSION_FILENAME).toBe(`traditorium-tradingview-${EXTENSION_VERSION}.zip`);
  });

  it("is a direct download from the versioned public/downloads location", () => {
    expect(EXTENSION_DISTRIBUTION).toEqual({ channel: "direct-download", downloadPath: `/downloads/${EXTENSION_FILENAME}` });
    expect(extensionCta(EXTENSION_DISTRIBUTION)).toEqual({
      label: "Download Extension",
      href: `/downloads/${EXTENSION_FILENAME}`,
      download: EXTENSION_FILENAME,
      external: false,
    });
  });

  it("switches to a Chrome Web Store CTA by configuration alone", () => {
    const cta = extensionCta({ channel: "chrome-web-store", storeUrl: "https://example.test/listing" });
    expect(cta).toEqual({ label: "Install from Chrome Web Store", href: "https://example.test/listing", download: null, external: true });
  });

  it("has the 10 install steps and 5 connect steps", () => {
    expect(DIRECT_INSTALL_STEPS).toHaveLength(10);
    expect(DIRECT_INSTALL_STEPS[3]).toContain("chrome://extensions");
    expect(DIRECT_INSTALL_STEPS[5]).toContain("Load unpacked");
    expect(CONNECT_STEPS).toHaveLength(5);
  });

  it("serves ZIPs under /downloads as attachments, nosniff and noindex", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/downloads/:file*.zip");
    const headers = Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
    expect(headers).toMatchObject({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    });
  });
});

describe("published extension artifact", () => {
  it("exists at the download path and is the only extension ZIP there", () => {
    expect(existsSync(ZIP)).toBe(true);
    const zips = readdirSync(DOWNLOADS).filter((f) => f.startsWith("traditorium-tradingview-"));
    expect(zips).toEqual([EXTENSION_FILENAME]);
  });

  const entries = existsSync(ZIP) ? readZip(ZIP) : new Map<string, Buffer>();

  it("contains only runtime files", () => {
    const files = [...entries.keys()].filter((n) => !n.endsWith("/")).sort();
    expect(files).toEqual([
      "background.js",
      "content.js",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "manifest.json",
      "panel/panel.css",
      "panel/panel.html",
      "panel/panel.js",
    ]);
  });

  it("has a production manifest with the matching version", () => {
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(EXTENSION_VERSION);
    expect(manifest.name).toBe("Traditorium — TradingView Companion");
    expect(manifest.permissions).toEqual(["storage", "sidePanel", "activeTab"]);
    expect(manifest.host_permissions).toEqual(["https://www.tradingview.com/*", "https://traditorium.com/*", "<all_urls>"]);
    expect(manifest.content_scripts).toEqual([
      { matches: ["https://www.tradingview.com/*"], js: ["content.js"], run_at: "document_idle" },
    ]);
  });

  it("points at production and ships no dev hosts, source maps, logging or secrets", () => {
    for (const [name, data] of entries) {
      if (!/\.(js|json|html|css)$/.test(name)) continue;
      const text = data.toString("utf8");
      expect(text, name).not.toMatch(/localhost|127\.0\.0\.1|http:\/\//);
      expect(text, name).not.toMatch(/sourceMappingURL|console\.(log|debug)/);
      expect(text, name).not.toMatch(/sk-ant-|ANTHROPIC|process\.env|DATABASE_URL|AUTH_SECRET|R2_SECRET/);
      expect(text, name).not.toMatch(/td_live_[A-Za-z0-9]{8,}/);
    }
    for (const bundle of ["background.js", "panel/panel.js"]) {
      expect(entries.get(bundle)!.toString("utf8")).toContain('"https://traditorium.com"');
    }
  });
});

describe("ExtensionInstallCard", () => {
  it("renders the private-beta download, version, browser support and notices", () => {
    const html = renderToStaticMarkup(createElement(ExtensionInstallCard));
    expect(html).toContain("Traditorium for TradingView");
    expect(html).toContain("Analyze on TradingView and send Trade Ideas directly into Traditorium.");
    expect(html).toContain(`href="/downloads/${EXTENSION_FILENAME}"`);
    expect(html).toContain(`download="${EXTENSION_FILENAME}"`);
    expect(html).toContain("Download Extension");
    expect(html).toContain(`Version ${EXTENSION_VERSION} · Private Beta`);
    expect(html).toContain("Chromium 114+");
    expect(html).not.toMatch(/Firefox|Safari/);
    expect(html).toContain("How to install");
    expect(html).toContain("Developer mode");
    expect(html).toContain("private beta");
    expect(html).toContain("shown only once");
    expect(html).toContain("&lt;all_urls&gt;");
    expect(html).not.toContain("Chrome Web Store</a>");
  });

  it("drops the Developer-mode steps for a Chrome Web Store channel", () => {
    const html = renderToStaticMarkup(
      createElement(ExtensionInstallCard, { distribution: { channel: "chrome-web-store", storeUrl: "https://example.test/listing" } }),
    );
    expect(html).toContain("Install from Chrome Web Store");
    expect(html).toContain('href="https://example.test/listing"');
    expect(html).not.toContain("How to install");
    expect(html).not.toContain("download=");
    expect(html).toContain("How to connect");
  });
});
