/* eslint-disable @typescript-eslint/no-require-imports -- plain Node (CommonJS) benchmark script */
/**
 * Browser benchmark for the simulation terminal's Next Candle (the "Candle"
 * button). Measures, inside the page, click → replay clock updated and
 * click → chart legend shows the new candle. Usage:
 *   node scripts/bench/replay-browser.bench.cjs <baseUrl> <accountId> [steps] [indicators=1]
 * Seed first with scripts/bench/seed-replay-account.ts (TEST database).
 */
const { chromium } = require("playwright");

(async () => {
  const [base, accountId, stepsArg, indArg] = process.argv.slice(2);
  const steps = Number(stepsArg || 20);
  const withIndicators = indArg !== "0";
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/login`, { waitUntil: "networkidle" });
  await p.fill("#email", "replay-bench@example.test");
  await p.fill("input[type=password]", "bench-password-1");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  await p.goto(`${base}/backtesting/terminal/${accountId}`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1500);
  if (process.env.BENCH_SHOT) await p.screenshot({ path: process.env.BENCH_SHOT });
  if (withIndicators && !(await p.locator('button[aria-label^="Remove "]').count())) {
    for (const q of ["Simple moving", "Bollinger", "Relative Strength", "MACD"]) {
      await p.click('button[aria-label="Indicators and scripts"]');
      await p.fill('input[aria-label="Search indicators"]', q.split(" ")[0]);
      await p.locator("li button", { hasText: q }).first().click();
      await p.waitForTimeout(300);
    }
  }
  await p.mouse.move(5, 5);
  await p.waitForTimeout(1500);
  const results = [];
  for (let i = 0; i < steps; i++) {
    const r = await p.evaluate(async () => {
      const btn = [...document.querySelectorAll("header button")].find((x) => x.textContent.trim() === "Candle");
      const clock = document.querySelector('[title="Replay time (broker server clock)"]');
      const legend = document.querySelector('main[aria-label="Charts"] .pointer-events-none.absolute');
      const clock0 = clock.textContent;
      const legend0 = legend ? legend.textContent : "";
      const t0 = performance.now();
      btn.click();
      let tClock = null;
      let tChart = null;
      await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now();
          if (tClock == null && clock.textContent !== clock0) tClock = now - t0;
          const l = document.querySelector('main[aria-label="Charts"] .pointer-events-none.absolute');
          if (tChart == null && l && l.textContent !== legend0 && !/Loading/.test(l.innerHTML)) tChart = now - t0;
          if ((tClock != null && tChart != null) || now - t0 > 10000) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Wait until the button is usable again (the step fully finished).
      const t1 = performance.now();
      while (btn.disabled && performance.now() - t1 < 10000) await new Promise((r) => setTimeout(r, 5));
      const lEnd = document.querySelector('main[aria-label="Charts"] .pointer-events-none.absolute');
      return { clock: tClock, chart: tChart, done: performance.now() - t0, debug: [legend0.slice(0, 80), lEnd ? lEnd.textContent.slice(0, 80) : null] };
    });
    results.push(r);
    if (process.env.BENCH_DEBUG) console.log(JSON.stringify(r));
    await p.waitForTimeout(150);
  }
  const stat = (k) => {
    const v = results.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? `median ${v[Math.floor(v.length / 2)].toFixed(0)} ms  p90 ${v[Math.floor(v.length * 0.9)].toFixed(0)} ms  (n=${v.length})` : "n/a";
  };
  console.log(`indicators: ${withIndicators ? "SMA, Bollinger, RSI, MACD" : "none"}`);
  console.log(`click → clock updated : ${stat("clock")}`);
  console.log(`click → chart updated : ${stat("chart")}`);
  console.log(`click → step finished : ${stat("done")}`);
  const perf = await p.evaluate(() => (window.__replayPerf ? window.__replayPerf.summary() : null));
  if (perf) {
    console.log("in-app instrumentation (window.__replayPerf):");
    for (const [k, v] of Object.entries(perf)) console.log(`  ${k.padEnd(20)} median ${String(v.median).padStart(6)} ms  p90 ${String(v.p90).padStart(6)} ms  (n=${v.n})`);
  }
  if (errors.length) console.log("page errors:", errors);
  await b.close();
})().catch(async (e) => {
  console.error("FAIL", e.message.split("\n")[0]);
  process.exit(1);
});
