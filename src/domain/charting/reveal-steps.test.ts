import { describe, expect, it } from "vitest";

import type { SimRevealedDTO } from "@/types/simulation";
import { splitRevealed } from "./reveal-steps";

const bar = (minute: number) => ({ minute, open: 1, high: 1, low: 1, close: 1, tickVolume: 1, realVolume: null, spread: null, barCount: 1, state: "COMPLETED" as const });
const rev = (symbol: string, minutes: number[]): SimRevealedDTO => ({ symbol, priceScale: 5, bars: minutes.map(bar) });

describe("splitRevealed", () => {
  it("M1 playback: one step per 1-minute bar, chained exactly, each with only its own bar", () => {
    const steps = splitRevealed([rev("EURUSD", [101, 102, 103, 104])], 100, 104, "M1");
    expect(steps.map((s) => [s.from, s.to])).toEqual([[100, 101], [101, 102], [102, 103], [103, 104]]);
    expect(steps.map((s) => s.revealed[0].bars!.map((b) => b.minute))).toEqual([[101], [102], [103], [104]]);
  });

  it("M5 playback: one step per 5-minute bucket", () => {
    const steps = splitRevealed([rev("EURUSD", [101, 102, 103, 104, 105, 106, 107, 108, 109])], 100, 109, "M5");
    expect(steps.map((s) => [s.from, s.to])).toEqual([[100, 104], [104, 109]]);
    expect(steps[1].revealed[0].bars!.map((b) => b.minute)).toEqual([105, 106, 107, 108, 109]);
  });

  it("gaps (weekend) and several instruments: steps follow the union of bars, nothing lost or repeated", () => {
    const steps = splitRevealed([rev("EURUSD", [101, 500]), rev("GBPUSD", [101, 102, 500])], 100, 500, "M1");
    expect(steps.map((s) => [s.from, s.to])).toEqual([[100, 101], [101, 499], [499, 500]]);
    const eur = steps.flatMap((s) => s.revealed[0].bars!.map((b) => b.minute));
    const gbp = steps.flatMap((s) => s.revealed[1].bars!.map((b) => b.minute));
    expect(eur).toEqual([101, 500]);
    expect(gbp).toEqual([101, 102, 500]);
  });

  it("single bar or unsendable payload: one step", () => {
    expect(splitRevealed([rev("EURUSD", [101])], 100, 101, "M1")).toHaveLength(1);
    expect(splitRevealed([{ symbol: "EURUSD", priceScale: 5, bars: null }], 100, 900, "M1")).toEqual([{ from: 100, to: 900, revealed: [{ symbol: "EURUSD", priceScale: 5, bars: null }] }]);
  });
});
