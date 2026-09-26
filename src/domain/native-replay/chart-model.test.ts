import { afterAll, describe, expect, it } from "vitest";

import { aggregateCandles, type EngineCandle } from "./candle-engine";
import { applyRevealed, diffCandles, fromWire, wireToBars, type CandleWire } from "./chart-model";
import { formatCrosshairTime, formatPrice, formatReplayTime, formatTickMark, fromChartTime, TICK, toChartTime } from "./chart-time";
import { REPLAY_TIMEFRAMES } from "./timeframes";
import { barsOf, walk, wc } from "./testing/m1-fixtures";
import type { CanonicalM1Bars } from "./m1-dataset";

const SCALE = 5;
const toWire = (bars: CanonicalM1Bars, i: number): CandleWire => ({
  minute: bars.minute[i],
  open: bars.open[i] / 10 ** SCALE,
  high: bars.high[i] / 10 ** SCALE,
  low: bars.low[i] / 10 ** SCALE,
  close: bars.close[i] / 10 ** SCALE,
  tickVolume: bars.tickVolume?.[i] ?? null,
  realVolume: null,
  spread: bars.spread?.[i] ?? null,
  barCount: 1,
  state: "COMPLETED",
});

/** A day with gaps: 08:00–11:59 without 09:15–09:16, then 13:00–15:59. */
function dayBars(): CanonicalM1Bars {
  const list = [
    ...walk("2024-05-14T08:00", Array.from({ length: 240 }, (_, i) => 107843 + ((i * 37) % 29) - 14), { wick: 3, volume: 7 }),
    ...walk("2024-05-14T13:00", Array.from({ length: 180 }, (_, i) => 107900 + ((i * 19) % 23) - 11), { wick: 2, volume: 5 }),
  ].filter((b) => !["2024-05-14T09:15", "2024-05-14T09:16"].includes(b.t));
  return barsOf(list, { spread: true });
}

describe("client chart model ≡ server engine", () => {
  const bars = dayBars();

  it("stepping with random batch sizes gives the server's candles at every cutoff, for every timeframe", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 20) + 1;
    for (const timeframe of REPLAY_TIMEFRAMES) {
      // Start from the server's candles at the first bar, as the chart does on load.
      let i = 0;
      let cutoff = bars.minute[0];
      const client: EngineCandle[] = aggregateCandles(bars, { timeframe, cutoff });
      while (i < bars.count - 1) {
        const n = Math.min(rand(), bars.count - 1 - i);
        const revealed = Array.from({ length: n }, (_, k) => toWire(bars, i + 1 + k));
        i += n;
        // Sometimes the world clock moves past this asset's last bar (another
        // asset traded in a minute this one has no bar for).
        const gapAfter = i + 1 < bars.count && bars.minute[i + 1] > bars.minute[i] + 1;
        cutoff = bars.minute[i] + (gapAfter && i % 2 === 0 ? 1 : 0);
        applyRevealed(client, wireToBars(revealed, SCALE), timeframe, cutoff);
        const server = aggregateCandles(bars, { timeframe, cutoff });
        expect(diffCandles(client, server), `${timeframe} @ ${cutoff}`).toBe(0);
      }
    }
  });

  it("M30 prints through 09:00–09:30: one candle updated in place, completed at 09:29, a new one at 09:30", () => {
    const upTo = (t: string) => aggregateCandles(bars, { timeframe: "M30", cutoff: wc(t) });
    const client = upTo("2024-05-14T08:59");
    const updates: string[] = [];
    for (let i = 0; i < bars.count; i += 1) {
      const m = bars.minute[i];
      if (m <= wc("2024-05-14T08:59") || m > wc("2024-05-14T09:30")) continue;
      const { changed } = applyRevealed(client, wireToBars([toWire(bars, i)], SCALE), "M30", m);
      updates.push(changed.map((c) => `${new Date(c.time * 60000).toISOString().slice(11, 16)}:${c.state}`).join(","));
    }
    expect(updates[0]).toBe("09:00:FORMING"); // 09:00 opens (08:30 already completed at 08:59)
    expect(updates.filter((u) => u === "09:00:FORMING")).toHaveLength(27); // 09:00 + 09:01–09:28 minus the two missing minutes
    expect(updates.at(-2)).toBe("09:00:COMPLETED"); // 09:29
    expect(updates.at(-1)).toBe("09:30:FORMING");
    expect(client.map((c) => c.time).filter((t, k, a) => a.indexOf(t) !== k)).toEqual([]); // no duplicates
  });

  it("wire round trip is exact at the dataset precision", () => {
    const c = fromWire({ minute: 1, open: 1.07843, high: 2357.42, low: 1.26381, close: 0.00001, tickVolume: 3, realVolume: null, spread: 1, barCount: 1, state: "FORMING" }, 5);
    expect([c.open, c.high, c.low, c.close]).toEqual([107843, 235742000, 126381, 1]);
  });

  it("a replayed (duplicate) step is not folded twice", () => {
    const client = aggregateCandles(bars, { timeframe: "H1", cutoff: bars.minute[10] });
    const again = wireToBars([toWire(bars, 10)], SCALE);
    const before = JSON.stringify(client);
    applyRevealed(client, again, "H1", bars.minute[10]);
    expect(JSON.stringify(client)).toBe(before);
  });
});

describe("broker wall-clock time on the chart never depends on the machine's timezone", () => {
  const original = process.env.TZ;
  afterAll(() => {
    process.env.TZ = original;
  });

  it("labels are identical in Lusaka, London, New York, Tokyo and UTC", () => {
    const t = toChartTime(wc("2024-05-14T09:17"));
    const results = new Set<string>();
    for (const tz of ["Africa/Lusaka", "Europe/London", "America/New_York", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      results.add(
        JSON.stringify([
          formatTickMark(t, TICK.TIME),
          formatTickMark(t, TICK.DAY_OF_MONTH),
          formatTickMark(t, TICK.MONTH),
          formatTickMark(t, TICK.YEAR),
          formatCrosshairTime(t),
          formatReplayTime(wc("2024-05-14T09:17")),
          new Date(t * 1000).getTimezoneOffset() === 0 || tz !== "UTC", // sanity: TZ really changed
        ]),
      );
    }
    expect(results.size).toBe(1);
    expect(JSON.parse([...results][0]).slice(0, 6)).toEqual(["09:17", "14 May", "May", "2024", "Tue 14 May 2024 09:17", "14 May 2024 09:17"]);
  });

  it("chart time is the wall-clock minute × 60, round-tripping exactly", () => {
    expect(toChartTime(wc("2024-05-14T09:17"))).toBe(wc("2024-05-14T09:17") * 60);
    expect(fromChartTime(toChartTime(wc("2024-05-14T09:17")))).toBe(wc("2024-05-14T09:17"));
  });

  it("prices use the dataset's precision", () => {
    expect(formatPrice(1.0784, 5)).toBe("1.07840");
    expect(formatPrice(2357.4, 2)).toBe("2357.40");
  });
});
