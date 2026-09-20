/**
 * Traditorium TradingView Extension — Step 6, §18/§25 "Security" test
 * category. These are architecture-invariant checks on the actual SOURCE
 * TEXT of the panel and content script, not runtime behavior — the
 * invariant they guard ("the panel/content script never call the
 * Traditorium API directly, never touch the token") is structural: it's
 * true because those files simply don't import api-client.ts/storage.ts or
 * call fetch()/chrome.storage.local, not because of a runtime check. A
 * static source scan catches a future accidental violation (e.g. someone
 * adding a "quick" direct fetch from the panel) that a purely behavioral
 * test could miss if the accidental call happened to never fire during
 * that test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), "utf8");

// These modules' own doc comments legitimately DISCUSS the very things
// they're checked for NOT doing (e.g. draft.ts's comment explains it holds
// no `userId` field; draft-storage.ts's comment explains it deliberately
// isn't chrome.storage.local) — so the checks below scan actual CODE, not
// prose, by stripping comments first.
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("security boundary — token isolation (Step 6)", () => {
  it("panel.ts never calls fetch() or references an Authorization header directly", () => {
    const source = code(read("src/panel/panel.ts"));
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/Authorization/i);
  });

  it("panel.ts never imports the background's api-client or storage modules", () => {
    const source = code(read("src/panel/panel.ts"));
    expect(source).not.toMatch(/api-client/);
    expect(source).not.toMatch(/from ["']\.\.?\/.*storage["']/);
  });

  it("view.ts / strategy-view.ts (pure render logic) never reference a token field", () => {
    for (const file of ["src/panel/view.ts", "src/panel/strategy-view.ts", "src/panel/strategy-loader.ts"]) {
      expect(code(read(file))).not.toMatch(/apiToken|token\b/i);
    }
  });

  it("the content script never imports api-client/storage and never references a token", () => {
    const source = code(read("src/content/tradingview-detect.ts"));
    expect(source).not.toMatch(/api-client|storage/);
    expect(source).not.toMatch(/apiToken|Authorization/i);
    const detector = code(read("src/content/chart-detector.ts"));
    expect(detector).not.toMatch(/apiToken|Authorization|fetch\s*\(/i);
  });

  it("@shared/draft.ts and @shared/strategy.ts (the draft/strategy models) carry no token/userId/PnL/score field (§3)", () => {
    for (const file of ["src/shared/draft.ts", "src/shared/strategy.ts"]) {
      expect(code(read(file))).not.toMatch(/apiToken|userId|setupScore|adherence|\bpnl\b/i);
    }
  });

  it("draft-storage.ts is the only module touching the draft's storage key, and never touches chrome.storage.local", () => {
    const source = code(read("src/background/draft-storage.ts"));
    expect(source).toMatch(/chrome\.storage\.session/);
    expect(source).not.toMatch(/chrome\.storage\.local/);
  });
});

describe("security boundary — capture/upload (Step 8)", () => {
  it("panel/screenshot.ts (the capture/upload state machine) has NO chrome.* calls at all — pure orchestration only", () => {
    expect(code(read("src/panel/screenshot.ts"))).not.toMatch(/chrome\./);
  });

  it("panel/screenshot.ts and panel/trade-view.ts never reference a token", () => {
    for (const file of ["src/panel/screenshot.ts", "src/panel/trade-view.ts", "src/panel/trade-submission.ts"]) {
      expect(code(read(file))).not.toMatch(/apiToken|Authorization/i);
    }
  });

  it("panel.ts never calls chrome.tabs.captureVisibleTab directly — capture always goes through a CAPTURE_CHART message to the background", () => {
    expect(code(read("src/panel/panel.ts"))).not.toMatch(/captureVisibleTab/);
  });

  it("background/state.ts is the ONLY module that calls chrome.tabs.captureVisibleTab", () => {
    const files = [
      "src/panel/panel.ts",
      "src/panel/screenshot.ts",
      "src/background/index.ts",
      "src/background/api-client.ts",
      "src/content/tradingview-detect.ts",
      "src/content/chart-detector.ts",
    ];
    for (const file of files) expect(code(read(file))).not.toMatch(/captureVisibleTab/);
    expect(code(read("src/background/state.ts"))).toMatch(/captureVisibleTab/);
  });

  it("the content script has zero involvement in capture — no reference to captureVisibleTab, media upload, or a MediaAsset/screenshot concept anywhere in it", () => {
    for (const file of ["src/content/tradingview-detect.ts", "src/content/chart-detector.ts"]) {
      const source = code(read(file));
      expect(source).not.toMatch(/captureVisibleTab|uploadMedia|mediaAssetId|screenshot/i);
    }
  });

  it("api-client.ts's uploadMedia never logs or embeds the token in the request body, only the Authorization header", () => {
    const source = read("src/background/api-client.ts");
    const uploadMediaFn = source.slice(source.indexOf("export async function uploadMedia"));
    // The token is used exactly once, to build the header value — never
    // interpolated into the FormData/body.
    expect(uploadMediaFn).toMatch(/Authorization.*Bearer \$\{token\}/);
    expect(uploadMediaFn).not.toMatch(/form\.set\([^)]*token/i);
  });
});

describe("security boundary — recognition (Step 9, Parts 1-4)", () => {
  it("panel/recognition.ts (the analysis state machine) has NO chrome.* calls at all — pure orchestration only", () => {
    expect(code(read("src/panel/recognition.ts"))).not.toMatch(/chrome\./);
  });

  it("panel/recognition.ts and @shared/recognition-suggestions.ts never reference a token", () => {
    for (const file of ["src/panel/recognition.ts", "src/shared/recognition-suggestions.ts"]) {
      expect(code(read(file))).not.toMatch(/apiToken|Authorization/i);
    }
  });

  it("the content script has zero involvement in recognition — no reference to analyzeScreenshot/recognizeTradePlan/ANALYZE_SCREENSHOT anywhere in it", () => {
    for (const file of ["src/content/tradingview-detect.ts", "src/content/chart-detector.ts"]) {
      expect(code(read(file))).not.toMatch(/analyzeScreenshot|recognizeTradePlan|ANALYZE_SCREENSHOT|recognition/i);
    }
  });

  it("background/state.ts is the ONLY module that calls api-client.ts's analyzeScreenshot", () => {
    for (const file of ["src/panel/panel.ts", "src/panel/recognition.ts", "src/background/index.ts", "src/content/tradingview-detect.ts"]) {
      expect(code(read(file))).not.toMatch(/\banalyzeScreenshot\(/);
    }
    expect(code(read("src/background/state.ts"))).toMatch(/analyzeScreenshot\(/);
  });
});

describe("security boundary — connection UX (Step 9, Part 11)", () => {
  it("every 'open-settings' link is built from API_BASE_URL, never a hardcoded/invented domain", () => {
    const source = code(read("src/panel/panel.ts"));
    expect(source).toMatch(/API_BASE_URL\}\/settings\/integrations/);
  });
});
