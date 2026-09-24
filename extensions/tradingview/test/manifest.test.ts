/**
 * Traditorium TradingView Extension — release-gate regression (Failure 2:
 * image upload). `chrome.tabs.captureVisibleTab` (the "Capture Chart"
 * button in the side panel) only ever succeeds with the literal `<all_urls>`
 * host permission or a currently-valid `activeTab` grant — and `activeTab`
 * is never granted for a click on a button already inside an open side
 * panel (confirmed against Chrome's own docs and reproduced live: it threw
 * "Either the '<all_urls>' or 'activeTab' permission is required." even
 * when the toolbar icon was clicked immediately beforehand on the same
 * tab — see README.md's "Screenshot capture permission" section). This
 * guards against a future "permissions cleanup" silently removing
 * `<all_urls>` and reintroducing that failure.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const manifestTemplate = JSON.parse(readFileSync(path.join(ROOT, "manifest.template.json"), "utf8")) as {
  host_permissions: string[];
  permissions: string[];
};

describe("manifest.template.json — capture permission (release-gate regression)", () => {
  it("declares <all_urls> in host_permissions, required by chrome.tabs.captureVisibleTab from the side panel", () => {
    expect(manifestTemplate.host_permissions).toContain("<all_urls>");
  });

  it("still declares the scoped TradingView and API host permissions (the <all_urls> grant doesn't replace them)", () => {
    expect(manifestTemplate.host_permissions).toContain("https://www.tradingview.com/*");
    expect(manifestTemplate.host_permissions).toContain("__API_HOST_PERMISSION__");
  });

  it("still declares activeTab (harmless, covers a genuinely qualifying gesture)", () => {
    expect(manifestTemplate.permissions).toContain("activeTab");
  });
});
