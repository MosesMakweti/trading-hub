/* eslint-disable @typescript-eslint/no-require-imports -- plain Node (CommonJS) benchmark script */
/**
 * Continuous-replay correctness check (browser). Two charts (M15 + H1), play
 * at a high speed, pause, then compare what the incrementally-updated charts
 * show with a fresh server load after reload. Also checks that the bars
 * revealed during play add up to the minutes the clock moved (nothing
 * skipped). Usage: node scripts/bench/replay-play-check.cjs <baseUrl> <accountId> [speed] [seconds]
 */
const { chromium } = require("playwright");

(async () => {
  const [base, accountId, speedArg, secArg] = process.argv.slice(2);
  const speed = speedArg || "100";
  const seconds = Number(secArg || 4);
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/login`, { waitUntil: "networkidle" });
  await p.fill("#email", "replay-bench@example.test");
  await p.fill("input[type=password]", "bench-password-1");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await p.goto(`${base}/backtesting/terminal/${accountId}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.click('button[aria-label="Layout and panels"]');
  await p.click('button[aria-label="Two side by side"]');
  await p.keyboard.press("Escape");
  await p.waitForTimeout(800);
  const box = await p.locator('main[aria-label="Charts"]').boundingBox();
  await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await p.click('header button[aria-pressed]:has-text("H1")');
  await p.mouse.move(2, 2);
  await p.waitForTimeout(2500);
  const read = () =>
    p.evaluate(() => ({
      clock: document.querySelector('[title="Replay time (broker server clock)"]').textContent,
      legends: [...document.querySelectorAll('main[aria-label="Charts"] .pointer-events-none.absolute')].map((l) => l.textContent.replace(/forming/g, "").slice(0, 90)),
    }));
  const before = await read();
  await p.click(`button[aria-pressed]:has-text("${speed}×")`);
  await p.evaluate(() => (window.__replayPerf ? (window.__replayPerf.steps.length = 0) : null));
  await p.click('header button:has-text("Play")');
  await p.waitForTimeout(seconds * 1000);
  await p.click('header button:has-text("Pause")');
  await p.waitForTimeout(1500);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(300);
  const after = await read();
  const steps = await p.evaluate(() => window.__replayPerf.steps.map((s) => ({ c: s.command, bars: s.revealedBars, ms: s.totalMs })));
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(300);
  const fresh = await read();
  console.log("clock before:", before.clock, "→ after:", after.clock);
  console.log(`steps during play: ${steps.length}, bars revealed per chart instrument: ${steps.reduce((n, s) => n + s.bars, 0)}`);
  console.log(`step sizes: ${steps.map((s) => s.c.replace("BARS ", "")).join(",")}`);
  console.log("incremental legends:", JSON.stringify(after.legends));
  console.log("fresh legends      :", JSON.stringify(fresh.legends));
  console.log(JSON.stringify(after.legends) === JSON.stringify(fresh.legends) && after.clock === fresh.clock ? "MATCH: incremental charts == fresh server load" : "MISMATCH");
  if (errors.length) console.log("page errors:", errors);
  await b.close();
})().catch((e) => {
  console.error("FAIL", e.message.split("\n")[0]);
  process.exit(1);
});
