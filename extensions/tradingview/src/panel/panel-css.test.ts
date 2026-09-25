/**
 * Traditorium TradingView Extension — release-gate regression. Live-confirmed
 * bug: `.card` (and other classes) declare `display: flex/block/grid`, which
 * has the SAME CSS specificity as the browser's default `[hidden] { display:
 * none }` UA-stylesheet rule — and an author rule always wins over a UA one
 * regardless of specificity. Every conditionally-shown `.card` section
 * (disconnected/connect-form/connecting/error/connected, chart-card,
 * strategy-card, screenshot-card, ...) was therefore still visually
 * rendered even while its `hidden` DOM property was `true` —
 * `getComputedStyle(el).display` returned `"flex"` regardless — which is
 * what let the connect-form/connecting/error sections render on top of an
 * already-connected panel.
 *
 * This can't be exercised as a real computed-style test: panel tests run in
 * plain Node (see vitest.config.ts's `environmentMatchGlobs` — only
 * `src/content/**` gets jsdom), matching this codebase's "extract pure,
 * DOM-free logic" testing philosophy; panel.ts itself has no direct test
 * file. This is a static guard instead (mirrors manifest.test.ts's pattern):
 * it fails loudly if a future edit ever removes the fix, rather than
 * silently reintroducing the bug.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "panel.css"), "utf8");

describe("panel.css — [hidden] must win over every display rule (release-gate regression)", () => {
  it("declares `[hidden] { display: none !important; }`", () => {
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  it("the [hidden] override appears before .card's own display rule (defense in depth — !important makes order irrelevant, but keep the intent legible)", () => {
    const hiddenRuleIndex = css.indexOf("[hidden]");
    const cardRuleIndex = css.indexOf(".card {");
    expect(hiddenRuleIndex).toBeGreaterThan(-1);
    expect(cardRuleIndex).toBeGreaterThan(-1);
    expect(hiddenRuleIndex).toBeLessThan(cardRuleIndex);
  });
});
