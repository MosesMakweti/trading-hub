import { describe, expect, it } from "vitest";

import * as ta from "@/domain/indicators/ta";
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { run } from "@/domain/scripting/runtime";
import { barIndexAt, buildDisplay, buildStudies, studySignature, type ScriptState } from "./render-model";
import { chartConfigSchema } from "./workspace";

const candles: EngineCandle[] = Array.from({ length: 120 }, (_, i) => {
  const c = 108000 + Math.round(Math.sin(i / 7) * 300);
  return { time: 1000 + i, open: c - 20, high: c + 50, low: c - 50, close: c, tickVolume: 10 + i, realVolume: null, spread: null, barCount: 1, lastBarTime: 1000 + i, state: i === 119 ? "FORMING" : "COMPLETED" };
});

describe("render model", () => {
  it("plain candles: prices descaled, tick volume kept, forming flagged", () => {
    const d = buildDisplay(candles, 5, "candles", null);
    expect(d.bars[0]).toMatchObject({ time: 60_000, open: (108000 - 20) / 1e5, volume: 10, synthetic: false });
    expect(d.lastForming).toBe(true);
    expect(d.synthetic).toBe(false);
  });

  it("synthetic types are flagged and have no volume (except Heikin Ashi)", () => {
    expect(buildDisplay(candles, 5, "renko", 0.001).bars.every((b) => b.synthetic && b.volume === null)).toBe(true);
    expect(buildDisplay(candles, 5, "heikinashi", null).bars[5].volume).toBe(15);
  });

  it("indicators are computed on the displayed bars", () => {
    const d = buildDisplay(candles, 5, "candles", null);
    const cfg = chartConfigSchema.parse({ studies: [{ uid: "a", kind: "indicator", id: "sma", inputs: { length: 10 } }] });
    const [sma] = buildStudies(d, cfg, new Map());
    expect(sma.overlay).toBe(true);
    expect(sma.params).toBe("10, close");
    expect(sma.plots[0].values).toEqual(ta.sma(d.inputs.map((b) => b.close), 10));
  });

  it("maps script results (plots, hlines, shapes) and errors", () => {
    const d = buildDisplay(candles, 5, "candles", null);
    const result = run(`indicator("Osc", overlay = false)
hline(0.5)
plot(ta.rsi(close, 14) / 100, style = plot.style_histogram)
plotshape(ta.crossover(close, ta.sma(close, 5)), style = shape.triangleup, location = location.belowbar)`, d.inputs);
    const scripts = new Map<string, ScriptState>([["s", { status: "ok", result, name: "Osc" }], ["e", { status: "error", message: "boom", name: "Bad" }]]);
    const cfg = chartConfigSchema.parse({ studies: [{ uid: "s", kind: "script", scriptId: "x" }, { uid: "e", kind: "script", scriptId: "y" }] });
    const [osc, bad] = buildStudies(d, cfg, scripts);
    expect(osc).toMatchObject({ name: "Osc", overlay: false, levels: [{ price: 0.5 }] });
    expect(osc.plots[0].kind).toBe("histogram");
    expect(osc.markers.length).toBeGreaterThan(0);
    expect(osc.markers[0]).toMatchObject({ position: "belowBar", shape: "arrowUp" });
    expect(bad.error).toBe("boom");
    expect(studySignature([osc], false)).not.toBe(studySignature([osc], true));
  });

  it("finds the bar at or before a time", () => {
    const bars = [{ time: 10 }, { time: 20 }, { time: 30 }];
    expect([barIndexAt(bars, 5), barIndexAt(bars, 20), barIndexAt(bars, 29), barIndexAt(bars, 99)]).toEqual([-1, 1, 1, 2]);
  });
});

describe("study precision", () => {
  it("shows ~3 significant digits by magnitude", async () => {
    const { digitsFor } = await import("./render-model");
    expect(digitsFor([{ values: [61.6, 30] }])).toBe(2);
    expect(digitsFor([{ values: [0.00019, -0.0003] }])).toBe(6);
    expect(digitsFor([{ values: [NaN] }])).toBe(2);
  });
});
